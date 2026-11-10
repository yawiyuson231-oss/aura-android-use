# Verifying the wake word on a phone

> **Last reviewed:** 2026-11-10.
>
> **Status of this guide:** written by someone who could not run it. The commands, log strings and
> failure meanings below are taken from the code (`voice/LiveKitWakeWordDetector.kt`,
> `voice/WakeWordDetector.kt`, `services/WakeWordListeningService.kt`), not from a successful run.
> If reality disagrees, the code wins — fix this page.

The wake word has two engines, chosen at startup:

| Engine | Chosen when | Log line (tag `WakeWordDetector`) |
|---|---|---|
| LiveKit WakeWord | a `.onnx` is in `assets/wakeword/` **and** loads | `✅ LiveKitWakeWordDetector created (Apache-2.0 weights, offline)` |
| sherpa-onnx | no LiveKit model, or it failed to load | `✅ SherpaKwsWakeWordDetector created (free, offline)` |
| Stub | both failed | `⚠️ Using StubWakeWordDetector — wake word will NOT work!` |

**The app never crashes if the model is missing or broken** — it falls back. So "it built and runs"
does not prove the LiveKit engine is active. The log line does.

## 1. Fetch the model

```bash
cd aura-android
./scripts/fetch-wakeword-model.sh
```

Expect:

```
Downloading hey_livekit.onnx from livekit/livekit-wakeword@v2.1.1 …
SHA-256: verified against the pinned digest.
Saved .../app/src/main/assets/wakeword/hey_livekit.onnx
Size:   7406178 bytes
```

The script exits non-zero rather than installing a bad file if the size is under 2 MB (a Git LFS
pointer or an error page) or the SHA-256 does not match the pinned digest.

## 2. Confirm it reached the APK

```bash
./gradlew :app:assembleDebug
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep wakeword
```

You want a line ending in `assets/wakeword/hey_livekit.onnx`. If that line is missing, the app will
silently run the sherpa engine no matter what the code says — check that the file is under
`app/src/main/assets/wakeword/` and that `androidResources` has not excluded `.onnx`
(`app/build.gradle.kts` already needs to keep `.onnx` uncompressed for other models, so this is
usually fine).

## 3. Watch the logs

```bash
adb logcat -c && adb logcat | grep -iE "WakeWordDetector|LiveKitWakeWord|WakeWordListeningService"
```

Enable the wake word in the app's settings first — the listener is a foreground service and does
nothing until it is switched on. On startup you should see, in order:

```
WakeWordDetector   ✅ LiveKitWakeWordDetector created (Apache-2.0 weights, offline)
LiveKitWakeWord    ✅ LiveKit wake word loaded: 'Hey LiveKit' (hey_livekit.onnx, N state tensors)
LiveKitWakeWord    🎤 Listening for "Hey LiveKit" (threshold 0.5)…
```

`N` is however many state tensors the model declares; do not expect a specific number.

Then say **"Hey LiveKit"** — clearly, about a metre away, at normal volume:

```
LiveKitWakeWord    🔊 Wake word detected: "Hey LiveKit" (score=0.8xx)
WakeWordListeningService 🔊 Wake word detected: Hey LiveKit
```

and the assistant should switch from passive to active listening.

After a detection the mic is released and the state is reset, so the next detection works the same
way. There is a deliberate ~2 s delay when listening (re)starts: that is the silence warm-up, and
removing it makes the model miss phrases spoken immediately after it starts.

## 4. When it does not fire — what each symptom means

| What you see | What it means |
|---|---|
| `⚠️ Using StubWakeWordDetector` | No model in the APK. Go back to step 2. |
| `✅ SherpaKwsWakeWordDetector created` | The `.onnx` is missing from the APK, or it failed to load; the log just above says why. |
| `❌ Could not load wake word model assets/wakeword/hey_livekit.onnx` | The file is there but ONNX Runtime rejected it — see the exception on the next lines. |
| `... is not a LiveKit streaming wake word model: no 'chunk' input` | You fetched a different (non-streaming) model. Only the v2 streaming exports work. |
| `❌ Cannot start — RECORD_AUDIO permission not granted` | Grant microphone permission, then toggle the wake word off and on. |
| Loads fine, never fires | The interesting case — see below. |
| `⚠️ This model scores silence at …` (debug builds) | The model fires on an empty room. Raise `THRESHOLD_VALUE`, or use a better model. |

When it loads but never fires, in order of likelihood:

1. **The phrase is wrong.** The bundled model is "Hey LiveKit", not "AURA". Say it exactly, and
   say it the way LiveKit's training data does.
2. **The microphone is being used elsewhere.** Only one consumer can hold `AudioRecord`; if STT or
   another app is recording, the detector gets nothing. `AudioRecord read error: …` in the log
   confirms it.
3. **The model is real but this phone's mic is not what it was trained on.** Record a sample and
   compare; this is the case fine-tuning fixes, and no threshold tweak will.
4. **A KleidiAI kernel problem.** The detector sets `mlas.disable_kleidiai=1` defensively. If the
   runtime silently ignored the key and the arm64 kernels are wrong, the model scores noise — which
   looks identical to (3). Distinguishing them needs a recording pushed through the same `.onnx`
   off-device.

## 5. Measure it properly, if you want a number

"Does it fire?" is not a measurement. For a real figure, count over a normal day of use:

- **Detections** — how many times it fired, and how many of those were you actually saying the phrase (false accepts).
- **Misses** — how many times you said it and it did not fire (false rejects).

Both numbers, with the phone and room named. Anything else — including the vendor figures quoted in
[the ADR](decisions/livekit-wakeword.md) — is somebody else's microphone.
