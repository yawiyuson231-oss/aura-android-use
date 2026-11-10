# ADR: sherpa-onnx over Porcupine for the wake word

> **Status:** accepted (in force). Recorded 2026-11-10 to replace a decision that was made in
> code and only ever noted in `TODO.md`; the code did not change.
>
> **Last reviewed:** 2026-11-10, against `voice/WakeWordDetector.kt`,
> `voice/SherpaKwsWakeWordDetector.kt`, `services/WakeWordListeningService.kt` and
> `app/build.gradle.kts`.
>
> **Partially superseded** by [`livekit-wakeword.md`](livekit-wakeword.md): LiveKit WakeWord is now
> the primary engine and sherpa-onnx is the fallback. This ADR **still stands on its own question**
> — "should the wake word depend on a credential?" the answer is no, and Porcupine remains excluded.
> Its accuracy row for sherpa-onnx was too generous; see the new ADR.

## Context

The wake word ("Wake up AURA") has to run **continuously, in the background, on battery, and
offline**, on a normal phone with no root. That is the hardest constraint in the product: the
listener is on all day, and it hears everything in the room.

Two engines were real candidates:

| | **sherpa-onnx** keyword spotting (chosen) | **Picovoice Porcupine** (rejected) |
|---|---|---|
| Licence | Apache-2.0 | Apache-2.0 SDK, but a **commercial AccessKey** is required per device/account |
| Key | none | AccessKey must be issued to the app and shipped or fetched |
| Cost | free | free tier limits; production volume needs a paid plan |
| Model | ~5.1 MB int8, bundled in `assets/kws/` | small, but custom words are trained in the Picovoice console |
| Custom phrase | edit `assets/kws/keywords.txt` (BPE tokens), no retraining, no network | create a wake word in the console → download `.ppn` (custom words need a paid tier for non-free keywords) |
| Network at runtime | none | the SDK validates the AccessKey; a key problem is a **silent** dead listener |
| Native | one JNI lib, ONNX Runtime statically linked (`libsherpa-onnx-static-link-onnxruntime`) | own native lib per ABI |
| iOS | separate story (see below) | first-class iOS support |

## Decision

**sherpa-onnx keyword spotting**, with a stub detector as the failure path so a broken engine is
visible rather than silently deaf.

> **Now the fallback, not the primary engine.** The key-less requirement this ADR establishes still
> holds; the engine choice moved to LiveKit WakeWord in
> [`livekit-wakeword.md`](livekit-wakeword.md) because sherpa-onnx's English accuracy on this phrase
> is poor and LiveKit's weights are Apache-2.0 like its code.

## Why

1. **No credential can break a shipped listener.** With Porcupine, an AccessKey is a runtime
   dependency on a third party's service. A revoked, misconfigured, or rate-limited key turns the
   wake word off with no error the user can see — `WakeWordListeningService` would look healthy and
   never fire. That is the worst failure mode a background feature can have. sherpa-onnx has no
   such input: it is model files on disk.
2. **Apache-2.0 with no per-device terms.** The project already carries one commercial licence
   exception (see `LICENSE-EXCEPTION.md`); the wake word should not be a second.
3. **The user can change the phrase without a vendor.** `keywords.txt` holds the BPE tokens for the
   phrase and its common mishearings (`▁WA KE ▁UP ▁A UR A`, `…▁OR A`, `…▁OUR A`), which is the
   cheap way to trade precision for recall on a wake word. Porcupine custom words are a console
   round trip.
4. **It was already paid for.** The same ONNX Runtime stack powers the rest of on-device perception
   (OmniParser). The static-link AAR exists specifically so its ONNX Runtime does not collide with
   that one.

## Consequences

- **Phrase changes live in the repo**, not in a vendor console: `assets/kws/keywords.txt`, one BPE
  token line per variant. Adding a variant is a data change, not a code change.
- **The engine can fail to load.** `WakeWordDetector.create` falls back to
  `StubWakeWordDetector`, which logs loudly ("wake word will not work"). This is deliberate: a
  stub that reports itself is better than a crash loop in a foreground service.
- **~5.1 MB of model ships in the APK** (`encoder.int8.onnx` is 4.8 MB of it). Committed
  intentionally — it is product runtime data, unlike the 28 MB AAR, which is fetched at build time.
- **iOS is a separate decision, not a port of this one.** Android's foreground service can hold a
  microphone indefinitely; iOS suspends the app and its audio session when backgrounded, so an
  always-on wake word is not available there without background-audio modes that App Review
  constrains. Nothing in this repo targets iOS.

## What would reopen this

- A requirement to ship on iOS with the same wake word — the cross-platform argument that lost here
  becomes the deciding one.
- sherpa-onnx failing on an OEM audio path that Porcupine survives (not observed; `AudioRecord`
  behaviour is the shared risk in both).
- The key cost, if a vendor ever made device-issued keys free and offline-validating with no
  server check.

## Change together

- `voice/WakeWordDetector.kt` — the interface and the stub fallback.
- `voice/SherpaKwsWakeWordDetector.kt` — the engine binding.
- `services/WakeWordListeningService.kt` — the foreground service, notification and lifecycle.
- `assets/kws/` — model and phrase.
- `app/build.gradle.kts` — the AAR fetch guard and the flatDir repo.
- `THIRD_PARTY_NOTICES.md` / `LICENSE-EXCEPTION.md` — must not mention Picovoice.
