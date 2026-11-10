# Build and run AURA

> **Last reviewed:** 2026-11-10.

Time: about 20 minutes for the first build, most of it downloads.

## What you need

| Tool | Version | Notes |
|---|---|---|
| **JDK 17** | 17 | Newer JDKs fail the Kotlin/AGP toolchain |
| **Android SDK** | API 36 | Android Studio installs it; or `sdkmanager "platforms;android-36" "build-tools;36.0.0"` |
| **Node.js** | 18+ | Only for the desktop bridge (`aura-mcp-connect`) |
| **A phone** | Android 8.0 (API 26) or newer | No root, no cable, no emulator required |

## 1. Get the code

```bash
git clone https://github.com/Dinesh210805/aura-android-use.git
cd aura-android-use
```

## 2. Point Gradle at your SDK

```bash
cd aura-android
cp local.properties.example local.properties
```

Edit `local.properties` and set `sdk.dir` to your SDK path (Android Studio writes this line for
you on first open). Release signing keys also live here; leave them out and you get an unsigned
release APK.

## 3. Firebase — optional for a debug build

AURA uses Firebase for Google sign-in, crash reports, analytics, and the owner's kill switch.

**Just want to try it?** Do nothing. The first debug build copies
`app/google-services.example.json` to `app/google-services.json` automatically and prints a note
when it does. The app compiles, runs, and lets you skip sign-in during setup; anything that needs
Firebase stays inactive.

**Want everything working?** Create a Firebase project, add two Android apps with the package names
`com.aura.aura_ui.feature` and `com.aura.aura_ui.feature.debug`, enable **Authentication** (Google
and Anonymous), **Firestore**, **Remote Config**, **Crashlytics** and **Analytics**, then download
its `google-services.json` into `aura-android/app/`.

> Release builds never use the placeholder. With no real file, `assembleRelease` fails loudly on
> purpose, because a release that looks configured while sending nothing is worse than a build
> error.

## 4. Build

```bash
cd aura-android
./gradlew :app:assembleDebug        # gradlew.bat on Windows
```

The first run downloads the wake-word engine (sherpa-onnx, about 28 MB) once.

### Wake word model (optional, but it is the accurate engine)

The wake word runs on sherpa-onnx until a LiveKit model is present. To use the LiveKit engine:

```bash
./scripts/fetch-wakeword-model.sh     # ~7.4 MB, SHA-256 verified, into app/src/main/assets/wakeword/
```

Then rebuild. See [verifying the wake word](../verifying-the-wake-word.md) for the log lines that
prove which engine is actually running — a successful build does **not** prove the model is bundled,
because the app falls back rather than failing.

The APK lands in `app/build/outputs/apk/debug/`. Its `applicationId` is
`com.aura.aura_ui.feature.debug`, so it installs beside a release build.

### Tests

```bash
./gradlew :app:testDebugUnitTest :mcp-server:test
```

`:mcp-server` also runs a tool bench against a mock phone (no emulator, no device) and writes
`mcp-server/build/toolbench/report.html`.

## 5. Install it

**No cable:** copy the APK to the phone, open it, and allow installing unknown apps for the app you
opened it from.

**With `adb`** (optional, still no root):

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 6. The desktop bridge (optional)

```bash
cd ../aura-mcp-connect
npm install
npm test
npm link          # puts `aura-mcp` on your PATH
```

Then follow [Connect a computer](../guides/connect-a-claude-code-or-cursor.md).

## Common build failures

| Symptom | Cause | Fix |
|---|---|---|
| `SDK location not found` | No `local.properties` | Step 2 |
| `File google-services.json is missing` on a **release** task | The placeholder is debug-only by design | Step 3, set up Firebase |
| `Unsupported class file major version` | Not JDK 17 | `JAVA_HOME` → a JDK 17 |
| `Could not resolve com.aura.aura_ui...` | Stale daemon after a version bump | `./gradlew --stop` and rebuild |
| sherpa download fails | No network, or the release asset moved | Retry; check the URL in `app/build.gradle.kts` |

Next: [run your first task](first-task.md).
