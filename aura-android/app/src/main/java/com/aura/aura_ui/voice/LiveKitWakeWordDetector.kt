package com.aura.aura_ui.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import androidx.core.content.ContextCompat
import com.aura.aura_ui.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.coroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.OnnxJavaType
import java.nio.FloatBuffer
import java.nio.LongBuffer

/**
 * Wake word detection with a LiveKit WakeWord model (v2 streaming `.onnx`), running fully on the
 * device with no key, no account and no network.
 *
 * - Contract: one call consumes [FRAME_SAMPLES] (80 ms at 16 kHz) of mono float PCM in [-1, 1] and
 *   returns the score for the newest window; [STREAMING] scores above [THRESHOLD] are a detection.
 *   Only one [AudioRecord] consumer may be active — stop this before STT starts.
 * - Fails: a missing/corrupt model or a model that is not a streaming one throws in the constructor,
 *   and [WakeWordDetector.create] turns that into [StubWakeWordDetector] rather than crashing the
 *   app. Missing microphone permission leaves the loop un-started and logs; it never prompts.
 * - Reads: `assets/wakeword/<model>.onnx`, and its `inputSchema` ([MODEL_FEATURES], not user state).
 * - Why a streaming model: v2 exports ONE stateful ONNX per phrase (`chunk` in, `score` + updated
 *   state out), so the app carries no mel/embedding pipeline of its own and there is no second
 *   feature contract to drift. The 7 MB file is the whole model.
 * - Change together: `docs/decisions/livekit-wakeword.md`, `THIRD_PARTY_NOTICES.md` (Apache-2.0,
 *   LiveKit), and `WakeWordDetector.create`'s selection between engines.
 * - Not verified here: this file has never been compiled or run against a real model in this
 *   repository's CI. The streaming contract is taken from LiveKit's `client/python` source and
 *   `wakeword_train/export.py`; the model itself must be fetched by the developer (see
 *   `scripts/fetch-wakeword-model.sh`). Treat first-run on a phone as the real test.
 */
class LiveKitWakeWordDetector(
    private val context: Context,
    /** Asset file name under `assets/wakeword/`, e.g. `hey_livekit.onnx`. */
    private val modelFile: String = DEFAULT_MODEL,
    /** Detection threshold. 0.5 is LiveKit's documented default. */
    private val threshold: Float = THRESHOLD_VALUE,
    /** The phrase this model detects, reported to [setOnWakeWordDetected] and used in logs. */
    private val phrase: String = phraseFor(modelFile),
) : WakeWordDetector {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var listeningJob: Job? = null
    private var onWakeWordCallback: ((String) -> Unit)? = null

    private val _isListening = MutableStateFlow(false)
    override val isListening: StateFlow<Boolean> = _isListening.asStateFlow()

    /**
     * Only [phrase]. This engine detects exactly what its model was trained on, so listing the
     * other AURA phrases here (as the stub does) would advertise wake words that never fire.
     */
    override val availableKeywords: List<String> = listOf(phrase)

    /** Shared with the other on-device ONNX users (SileroVadScorer, OnnxYoloRunner). */
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession

    /**
     * One state tensor's contract. Ours rather than ORT's `NodeInfo` because `NodeInfo` has no
     * public constructor — reading its public fields is the supported way to learn a shape.
     */
    private data class StateSpec(val name: String, val shape: LongArray, val type: OnnxJavaType)

    /** Inputs that carry state across frames, in a stable order. */
    private val stateInputs: List<StateSpec>
    private val stateOutputNames: List<String>
    private val stateTensors: MutableMap<String, OnnxTensor> = mutableMapOf()

    /** Scores of the last detection, so a log line can explain a miss. */
    @Volatile private var lastScore = 0f

    init {
        session = try {
            val modelBytes = context.assets.open("$ASSET_DIR/$modelFile").use { it.readBytes() }
            // `.use` because SessionOptions owns native memory; ORT copies it into the session.
            OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(1)
                // LiveKit's client sets mlas.disable_kleidiai=1 unconditionally: on onnxruntime
                // 1.27.0 the arm64 KleidiAI conv kernels return wrong results, which would show up
                // as a wake word that scores noise and never fires. ORT ignores an unknown key, so
                // this is safe on versions whose kernels are correct — it only costs a little
                // speed on arm64, and a 7 MB model at 12.5 steps/s has that to spare.
                runCatching { addSessionConfigEntry("mlas.disable_kleidiai", "1") }
                    .onFailure { Log.w(TAG, "Could not set mlas.disable_kleidiai: ${it.message}") }
            }.use { env.createSession(modelBytes, it) }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Could not load wake word model assets/$ASSET_DIR/$modelFile", e)
            throw IllegalStateException("wake word model '$modelFile' unavailable", e)
        }

        val inputs = session.inputInfo
        // A v1 classifier (openWakeWord-style 16×96 feature input) would silently score garbage
        // here, so refuse it by name rather than produce a detector that never fires.
        check(inputs.containsKey(CHUNK_INPUT)) {
            "'$modelFile' is not a LiveKit streaming wake word model: no '$CHUNK_INPUT' input. " +
                "v1 classifier models (e.g. openWakeWord) are not supported — retrain with " +
                "`livekit-wakeword train`."
        }
        stateInputs = inputs.entries
            .filter { it.key != CHUNK_INPUT }
            .map { (name, info) -> StateSpec(name, info.info.shape, info.info.type) }
        stateOutputNames = session.outputInfo.keys.filter { it != SCORE_OUTPUT && it.endsWith("_out") }

        // Zero every state tensor, then replay silence exactly as training does. Starting from
        // zeros makes a phrase spoken in the first ~1.3 s score badly (LiveKit measured -0.07),
        // because training windows always have real encoder frames in front of the phrase.
        resetStateToZero()
        warmUpOnSilence()
        Log.i(TAG, "✅ LiveKit wake word loaded: '$phrase' ($modelFile, ${stateInputs.size} state tensors)")
    }

    // ── state handling ────────────────────────────────────────────────────

    private fun resetStateToZero() {
        closeState()
        for (spec in stateInputs) {
            stateTensors[spec.name] = tensorFor(spec)
        }
    }

    /**
     * One 80 ms step. Returns the score for the newest window.
     *
     * - Contract: mutates [stateTensors] to the model's returned state, so calls are sequential by
     *   construction. Must never be called concurrently.
     */
    private fun step(samples: FloatArray): Float {
        // Must be OnnxTensor: OrtSession.run's overloads take Map<String, OnnxTensor>, not OnnxValue.
        val inputs = HashMap<String, OnnxTensor>(stateInputs.size + 1)
        val chunk = OnnxTensor.createTensor(
            env,
            FloatBuffer.wrap(samples),
            longArrayOf(1, FRAME_SAMPLES.toLong()),
        )
        try {
            inputs[CHUNK_INPUT] = chunk
            for ((name, tensor) in stateTensors) inputs[name] = tensor

            session.run(inputs).use { result ->
                val score = ((result.get(SCORE_OUTPUT).orElse(null) as? OnnxTensor)
                    ?.floatBuffer?.get(0)) ?: 0f
                // Replace each state tensor with the model's updated copy. The old ones are closed
                // here: ONNX Runtime owns its results, but the *previous* inputs are ours.
                for (i in stateOutputNames.indices) {
                    val stateName = stateOutputNames[i].removeSuffix("_out")
                    val updated = result.get(stateOutputNames[i]).orElse(null) as? OnnxTensor ?: continue
                    stateTensors.remove(stateName)?.close()
                    // Copy out of the result so closing `result` cannot invalidate our state.
                    stateTensors[stateName] = updated.copyToOwned()
                }
                lastScore = score
                return score
            }
        } finally {
            chunk.close()
        }
    }

    /** Copy a result tensor into a tensor we own, so it outlives the [OrtSession.Result]. */
    private fun OnnxTensor.copyToOwned(): OnnxTensor {
        val t = info
        val size = t.shape.fold(1L) { a, b -> a * b }.toInt()
        return when (t.type) {
            OnnxJavaType.FLOAT -> {
                val out = FloatArray(size)
                floatBuffer.get(out)
                OnnxTensor.createTensor(env, FloatBuffer.wrap(out), t.shape)
            }
            OnnxJavaType.INT64 -> {
                val out = LongArray(size)
                longBuffer.get(out)
                OnnxTensor.createTensor(env, LongBuffer.wrap(out), t.shape)
            }
            // No other element type appears in a streaming model's state today; a new one must be
            // handled explicitly rather than silently keeping a reference ORT will free.
            else -> throw IllegalStateException("unsupported state tensor type ${t.type}")
        }
    }

    /**
     * A zeroed tensor shaped for [spec]. `audio` keeps the tail of previous audio, `step` is an
     * int64 counter, and the rest are float caches — all start at zero.
     */
    private fun tensorFor(spec: StateSpec): OnnxTensor {
        val size = spec.shape.fold(1L) { a, b -> a * b }.toInt()
        return when (spec.type) {
            OnnxJavaType.FLOAT ->
                OnnxTensor.createTensor(env, FloatBuffer.wrap(FloatArray(size)), spec.shape)
            OnnxJavaType.INT64 ->
                OnnxTensor.createTensor(env, LongBuffer.wrap(LongArray(size)), spec.shape)
            else -> throw IllegalStateException("unsupported state type ${spec.type} for ${spec.name}")
        }
    }

    /**
     * 2 s of digital silence, matching `WARMUP_S` in LiveKit's exporter.
     *
     * - Read: the score that silence produces. A correctly calibrated model sits near 0; a model
     *   whose silence score is already at or above [threshold] will fire on an empty room, so that
     *   is reported loudly in debug builds rather than silently draining the battery with false
     *   wakes. This is a diagnostic, not a source of truth — only on-device measurement is.
     */
    private fun warmUpOnSilence() {
        val silence = FloatArray(FRAME_SAMPLES)
        var silenceScore = 0f
        repeat(WARMUP_FRAMES) { silenceScore = step(silence) }
        lastScore = 0f
        if (BuildConfig.DEBUG && silenceScore >= threshold) {
            Log.w(
                TAG,
                "⚠️ This model scores silence at ${"%.3f".format(silenceScore)}, at or above the " +
                    "threshold $threshold — it will fire with nobody speaking. Raise the threshold " +
                    "or use a model calibrated for this microphone.",
            )
        }
    }

    private fun closeState() {
        stateTensors.values.forEach { runCatching { it.close() } }
        stateTensors.clear()
    }

    // ── lifecycle ─────────────────────────────────────────────────────────

    override fun start() {
        if (_isListening.value) {
            if (listeningJob?.isActive == true) {
                Log.d(TAG, "Already listening (job active)")
                return
            }
            Log.w(TAG, "⚠️ isListening=true but job not active — resetting state")
            _isListening.value = false
        }

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Log.e(TAG, "❌ Cannot start — RECORD_AUDIO permission not granted")
            return
        }

        _isListening.value = true
        val previous = listeningJob
        listeningJob = scope.launch {
            previous?.join()
            try {
                runDetectionLoop()
            } catch (e: Exception) {
                Log.e(TAG, "❌ Wake word loop failed: ${e.message}", e)
            } finally {
                withContext(Dispatchers.Main) { _isListening.value = false }
            }
        }
    }

    private suspend fun runDetectionLoop() {
        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer == AudioRecord.ERROR || minBuffer == AudioRecord.ERROR_BAD_VALUE) {
            Log.e(TAG, "❌ Invalid AudioRecord buffer size: $minBuffer")
            return
        }

        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, FRAME_SAMPLES * 2) * 2,
        )
        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "❌ AudioRecord failed to initialize (state=${audioRecord.state})")
            audioRecord.release()
            return
        }

        // A fresh stream: the state carries what was heard before, so a detector that just fired
        // must not keep the phrase in its history.
        resetStateToZero()
        warmUpOnSilence()

        val shortBuf = ShortArray(FRAME_SAMPLES)
        var detected = false
        try {
            audioRecord.startRecording()
            Log.i(TAG, "🎤 Listening for \"$phrase\" (threshold $threshold)…")

            while (coroutineContext.isActive && _isListening.value) {
                val n = audioRecord.read(shortBuf, 0, FRAME_SAMPLES)
                if (n <= 0) {
                    if (n < 0) {
                        Log.e(TAG, "AudioRecord read error: $n")
                        break
                    }
                    continue
                }
                // The model needs exactly FRAME_SAMPLES per step; a short read is padded with
                // silence rather than dropped, which would shift every later window.
                val samples = FloatArray(FRAME_SAMPLES)
                for (i in 0 until n) samples[i] = shortBuf[i] / 32768.0f

                val score = step(samples)
                if (score >= threshold) {
                    Log.i(TAG, "🔊 Wake word detected: \"$phrase\" (score=${"%.3f".format(score)})")
                    detected = true
                    // Break rather than cancel: the `finally` below is what closes the mic, so
                    // cancelling here would both race that release and surface as a spurious
                    // "loop failed: JobCancellationException" in the caller's catch.
                    break
                }
            }
        } finally {
            audioRecord.stop()
            audioRecord.release()
            Log.d(TAG, "AudioRecord released")
        }

        if (detected) {
            // The mic is closed by now, so STT can open it: exactly one consumer at a time.
            _isListening.value = false
            withContext(Dispatchers.Main) { onWakeWordCallback?.invoke(phrase) }
        }
    }

    /** Score of the most recent 80 ms step — for the debug trace and diagnostics screens. */
    val lastStepScore: Float get() = lastScore

    override fun stop() {
        if (!_isListening.value) return
        Log.i(TAG, "⏹️ Stopping wake word detection…")
        stopInternal()
    }

    private fun stopInternal() {
        _isListening.value = false
        // Cancel only: release() and the next start() must still be able to join this job.
        listeningJob?.cancel()
    }

    override fun setOnWakeWordDetected(callback: (String) -> Unit) {
        onWakeWordCallback = callback
    }

    override fun release() {
        Log.i(TAG, "Releasing LiveKitWakeWordDetector")
        stop()
        closeState()
        runCatching { session.close() }
    }

    companion object {
        private const val TAG = "LiveKitWakeWord"

        /** Asset folder; both the model and nothing else lives here. */
        const val ASSET_DIR = "wakeword"

        /** Bundled phrase. Fetch with scripts/fetch-wakeword-model.sh (see that script). */
        const val DEFAULT_MODEL = "hey_livekit.onnx"

        private const val CHUNK_INPUT = "chunk"
        private const val SCORE_OUTPUT = "score"

        private const val SAMPLE_RATE = 16000

        /** LiveKit's streaming step: 80 ms at 16 kHz. One ONNX call consumes exactly this. */
        const val FRAME_SAMPLES = 1280

        /** `WARMUP_S = 2.0` in LiveKit's exporter — two seconds of silence before real audio. */
        private const val WARMUP_FRAMES = 25

        /** LiveKit's documented default threshold. */
        const val THRESHOLD_VALUE = 0.5f

        /** Display name for a model file, used in logs and the wake callback. */
        fun phraseFor(modelFile: String): String = when (modelFile) {
            "hey_livekit.onnx" -> "Hey LiveKit"
            "hey_jarvis.onnx" -> "Hey Jarvis"
            else -> modelFile.removeSuffix(".onnx").replace('_', ' ')
                .split(' ').joinToString(" ") { w ->
                    w.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
                }
        }
    }
}
