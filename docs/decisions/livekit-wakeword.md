# ADR: LiveKit WakeWord as the wake word engine, sherpa-onnx as fallback

> **Status:** accepted (in force). Recorded 2026-11-10.
>
> **Last reviewed:** 2026-11-10, against `voice/WakeWordDetector.kt`,
> `voice/LiveKitWakeWordDetector.kt`, `voice/SherpaKwsWakeWordDetector.kt`,
> `scripts/fetch-wakeword-model.sh` and `docs/decisions/sherpa-onnx-over-porcupine.md`.

## Context

[`sherpa-onnx-over-porcupine.md`](sherpa-onnx-over-porcupine.md) settled the *key* question: the
wake word must never depend on a credential, so Porcupine is out. It did not settle the *accuracy*
question, and the engine it chose is weak at exactly the phrase this app ships:

- sherpa-onnx's English keyword spotter (`sherpa-onnx-kws-zipformer-gigaspeech-3.3M`) is reported
  by upstream at **under 10 %** on English phrases, against >90 % for the Chinese model — a
  consequence of English training data for this model being much thinner. That is the model in
  `assets/kws/`. ([k2-fsa/sherpa-onnx#2678](https://github.com/k2-fsa/sherpa-onnx/issues/2678))
- A wake word that misses nine times in ten is worse than no wake word: the user stops trusting it
  and the feature is dead weight in the APK.

The requirement is still *free and unlimited* (no key, no per-device term, no quota) and still
offline. That rules out Porcupine again and it rules out shipping openWakeWord's published weights,
which are **CC BY-NC-SA 4.0** — non-commercial — while this repository is AGPL-3.0 with a paid
closed-source tier ([`COMMERCIAL-LICENSE.md`](../../COMMERCIAL-LICENSE.md)). Non-commercial weights
inside a commercially licensed product is not a grey area worth living in.

## Decision

**LiveKit WakeWord (`livekit/livekit-wakeword`) is the primary engine.** sherpa-onnx stays in the
tree as the fallback for builds that have not fetched a LiveKit model, and the stub detector stays
last so a bad model can never crash the pipeline.

`WakeWordDetector.create` resolves engines in that order; nothing else in the app knows which one
is running.

## Why LiveKit WakeWord

| | **livekit-wakeword** (chosen) | sherpa-onnx KWS (fallback) | openWakeWord (rejected) | Porcupine (excluded) |
|---|---|---|---|---|
| Code licence | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 SDK |
| **Model licence** | **Apache-2.0, weights included** (release `NOTICE`) | Apache-2.0 | **CC BY-NC-SA 4.0** — non-commercial | n/a |
| Key / quota | none | none | none | AccessKey, per device/plan |
| Network at runtime | none | none | none | key validation |
| English accuracy (vendor-reported) | ~89 % detection @ 0.5 FA/hr | <10 % (upstream report) | ~46 % detection @ 0.5 FA/hr | not compared here |
| Model size | ~7.4 MB per phrase | ~5.1 MB | ~2 MB + feature models | small |
| Interface | one stateful ONNX: `chunk` in, `score` + state out | sherpa JNI + a separate native ORT | mel → embedding → classifier, three models to keep in sync | `.ppn` blob |

The whole point is the third row: **the weights carry the same licence as the code**, which is what
lets the repository keep its commercial tier. Everything else is a bonus.

The streaming design is also a simplification. LiveKit exports one ONNX per phrase whose graph owns
the mel filterbank, the embeddings and the classifier, and carries its own recurrent state between
80 ms chunks (`chunk` (1, 1280) float32 in [-1, 1] plus state tensors `audio`, `sub0`, `sub1`,
`sub2`, `k`, `v`, `conv`, `ctx`, `step`). The app therefore keeps no feature pipeline of its own and
has no second contract to drift.

### The two things that make it work, and are easy to get wrong

1. **Warm-up.** Training windows always have ~2 s of real encoder frames in front of the phrase.
   Starting from zeroed state and feeding real audio immediately costs LiveKit about **-0.07** on
   "hey livekit" for a phrase spoken in the first ~1.3 s. So the detector feeds **25 silent chunks
   (2 s)** before the microphone opens, and does it again after every detection — which is why
   `runDetectionLoop` resets state on entry instead of only in the constructor.
2. **`mlas.disable_kleidiai=1`.** On onnxruntime 1.27.0 the arm64 KleidiAI conv kernels return
   wrong results; LiveKit's own client sets this flag unconditionally. The detector sets it too, and
   survives a runtime that does not know the key. Failure mode if skipped: a wake word that scores
   noise and never fires — silent, and indistinguishable from a bad microphone.

Threshold is **0.5**, LiveKit's documented default: scores are calibrated so 0.5 hits their target
false-accept rate. The detector logs a warning (debug builds) if a model scores *silence* at or
above that, because such a model fires on an empty room.

## Consequences

- **The model is not committed.** `scripts/fetch-wakeword-model.sh` downloads a pinned release
  asset into `assets/wakeword/`, rejects LFS pointers and HTML error pages (<2 MB), and **verifies
  the SHA-256 by default** against digests pinned in the script. Those digests come from GitHub's
  release API (`assets[].digest`, computed server-side), not from a local download:

  | Asset (`v2.1.1`) | Bytes | SHA-256 |
  |---|---|---|
  | `hey_livekit.onnx` | 7 406 178 | `6ca579367f62792a5e6d981a10751e6deedd7b2f7a00b08342b7fcd9bb867231` |
  | `hey_jarvis.onnx` | 7 406 177 | `8b554c50809888ac14f67fa21acc3bd85e58f5678ee4f2be5d0041f9a2e62843` |

  A build without the model still works — it just falls back to sherpa-onnx.
  `THIRD_PARTY_NOTICES.md` records the licence.
- **Custom phrases need a training run, not a text edit.** LiveKit's training pipeline wants cloud
  TTS for phrase audio and a GPU box; sherpa-onnx could be re-pointed by editing `keywords.txt`.
  For a *new* phrase, weigh that: fine-tuning on the actual phrase is the only real accuracy lever
  for any engine here (one third-party report on an entirely different corpus went from 0.5 false
  activations/hour to 0 on its target phrase), and custom LiveKit training needs cloud TTS quota.
- **Nothing here is measured by this project.** The accuracy numbers above are vendor- and
  upstream-reported, not reproduced. "Most accurate" is not a claim this repository can make about
  any engine, and this ADR does not make it. The only trustworthy number is one measured on the
  target phone and microphone.
- **One open upstream question.** livekit-wakeword bundles two feature/encoder models whose
  provenance is still being clarified upstream (livekit/livekit-wakeword#89). That does not affect
  the per-phrase `.onnx` files this app downloads, but it is recorded here rather than forgotten.
- **Cost of keeping both engines:** ~5.1 MB of sherpa assets for a fallback most builds will not
  use. Drop them once a release has shipped the LiveKit model and no fallback is wanted.
- **`assets/wakeword/` is empty in a fresh clone**, so CI (and anyone's first build) exercises the
  sherpa path, not the primary one. Treat first run on a phone as the real test.
