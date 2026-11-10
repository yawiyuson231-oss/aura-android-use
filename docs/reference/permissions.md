# Permissions reference

> **Last reviewed:** 2026-11-10, against `app/src/main/AndroidManifest.xml`.

Every permission the app declares, why it is there, and what degrades without it. The wizard in
`presentation/permissions/PermissionRegistry.kt` is the source of truth for what is *asked*; this
page explains the *why*.

## Essential

| Permission | Why | Without it |
|---|---|---|
| `BIND_ACCESSIBILITY_SERVICE` | The whole product: reading the screen tree and performing gestures | Nothing works. The single permission AURA cannot run without |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Calls your AI provider; the LAN link to a computer | No agent, no MCP |
| `SYSTEM_ALERT_WINDOW` | The assistant overlay, the pause pill, tap highlights | No visible run controls; AURA still works from the app |
| `RECORD_AUDIO` | Voice input and the wake word | Type only |
| `FOREGROUND_SERVICE` (+ `_MICROPHONE`, `_CONNECTED_DEVICE`, `_SPECIAL_USE`, `_MEDIA_PROJECTION`) | Keep a run alive while the screen is in another app | Runs get killed when you leave the app |
| `POST_NOTIFICATIONS` | Run progress and the "AURA is working" chip | No progress outside the app |
| `POST_PROMOTED_NOTIFICATIONS` | Android 16+ live-update chip | Falls back to a normal notification |
| `WAKE_LOCK`, `TURN_SCREEN_ON` | Finish a run with the screen off | A dark screen stalls the run |
| `RECEIVE_BOOT_COMPLETED` | Restore the wake word after a restart | Re-enable it by hand after each reboot |
| `VIBRATE` | Haptics on taps and the pause pill | Silent feedback |

### The accessibility grant on a normal phone

Android 13+ **restricts accessibility grants for sideloaded apps**. The Settings toggle is greyed
out until the user allows it:

1. Settings → Apps → AURA → the ⋮ menu → **Allow restricted settings**.
2. Settings → Accessibility → Installed apps → AURA → **On**.

The onboarding wizard shows these exact steps. This is a platform rule about distribution, not a
missing permission in the manifest.

**Android 17+ Advanced Protection:** when that mode is on, the system only grants accessibility to
apps that declare `isAccessibilityTool="true"`. AURA does (see
`res/xml/aura_accessibility_service.xml`), so it is unaffected. If a device still refuses, Advanced
Protection is the reason.

## Optional, asked when a feature needs them

| Permission | Feature | If declined |
|---|---|---|
| `READ_CONTACTS` | `resolve_contact` for "message Priya" | The model is told to ask for a number |
| `READ_MEDIA_*` / `READ_EXTERNAL_STORAGE` (≤ API 29) | `find_files`, `open_file` | Files tools return `permission_denied` |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Location-aware intents such as nearby search | Maps still opens; it asks for location itself |
| `CAMERA` | Scanning a QR code to pair | Code can be typed |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Long runs on aggressive OEMs | Background runs may be killed |
| `SCHEDULE_EXACT_ALARM`, `SET_ALARM` (declared as `com.android.alarm.permission.SET_ALARM`) | `system_intent` alarm/timer | Falls back to opening the clock app with the values filled in |
| `ACCESS_NOTIFICATION_POLICY` | Do-not-disturb changes | Refused, with a message |
| `WRITE_SETTINGS` | System settings such as brightness | Refused; AURA will try the Settings app instead |
| `DISABLE_KEYGUARD` | Acting after the screen unlocks | Runs wait for the user |
| `QUERY_ALL_PACKAGES` | Listing installed apps for `launch_app`, `lookup_app` | App discovery breaks on Android 11+ |

## Declared but rarely exercised

| Permission | Note |
|---|---|
| `WRITE_SECURE_SETTINGS` | Only works if granted over `adb` on a developer device. Never required; nothing in the product depends on it, and a normal phone simply does not have it |
| `CHANGE_WIFI_STATE`, `CHANGE_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `BLUETOOTH*` | Read network and device state for the LAN link and device status. No Wi-Fi or pairing changes are made on the user's behalf |

## Permissions AURA does not ask for

No `READ_SMS` (notifications and `system_intent` cover SMS), no `MANAGE_EXTERNAL_STORAGE`, no
`SYSTEM_ALERT_WINDOW` abuse beyond the assistant overlay, no root, no `adb`, and no device
administrator. The accessibility service is the only privileged path, and it is the one the user
sees and can revoke at any time.

## Checking a build

```bash
./gradlew :app:assembleDebug
$ANDROID_HOME/build-tools/36.0.0/aapt2 dump permissions app/build/outputs/apk/debug/app-debug.apk
```

Compare the output against this page; if they differ, this page is wrong.
