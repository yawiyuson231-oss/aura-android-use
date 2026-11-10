#!/usr/bin/env bash
# Fetch a LiveKit WakeWord streaming model into the app's assets, once.
#
# Why a script and not a committed binary:
#   The model is 7 MB. Git history is the wrong place for it (the same reason the 28 MB sherpa
#   AAR is fetched at build time). This script pins the release tag, rejects LFS pointers and
#   prints the SHA-256 so you can record it (or, with EXPECT_SHA256 set, verify it).
#
# Licence: livekit-wakeword is Apache-2.0, INCLUDING its pre-trained models (see the NOTICE asset
# on the same release). That is why this engine was chosen over openWakeWord, whose equivalent
# weights are CC BY-NC-SA 4.0 (non-commercial).
#
# Usage:
#   ./scripts/fetch-wakeword-model.sh                  # hey_livekit.onnx
#   ./scripts/fetch-wakeword-model.sh hey_jarvis.onnx
#   WAKE_WORD_TAG=v2.1.1 ./scripts/fetch-wakeword-model.sh
#   EXPECT_SHA256=<hex> ./scripts/fetch-wakeword-model.sh   # fail unless the hash matches
#
# The app picks up whatever .onnx is in assets/wakeword/ (see WakeWordDetector.create), so no
# code change is needed to switch phrases.

set -euo pipefail

TAG="${WAKE_WORD_TAG:-v2.1.1}"
MODEL="${1:-hey_livekit.onnx}"
REPO="livekit/livekit-wakeword"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HERE/../app/src/main/assets/wakeword"
DEST="$DEST_DIR/$MODEL"
URL="https://github.com/$REPO/releases/download/$TAG/$MODEL"

if [[ ! "$MODEL" =~ ^[a-z0-9_]+\.onnx$ ]]; then
  echo "Refusing '$MODEL': expected a model name like hey_livekit.onnx (the .tflite micro models" >&2
  echo "target ESP32 / TensorFlow Lite Micro and are not usable by this app)." >&2
  exit 2
fi

mkdir -p "$DEST_DIR"

if [[ -f "$DEST" && "${FORCE:-0}" != "1" ]]; then
  echo "Already present: $DEST ($(wc -c <"$DEST" | tr -d ' ') bytes). Set FORCE=1 to re-download."
  exit 0
fi

echo "Downloading $MODEL from $REPO@$TAG …"
TMP="$(mktemp "$DEST.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

if ! curl -fL --retry 3 --retry-delay 2 -o "$TMP" "$URL"; then
  echo "" >&2
  echo "Download failed. Check that:" >&2
  echo "  - you are online and GitHub is reachable" >&2
  echo "  - tag '$TAG' exists: https://github.com/$REPO/releases" >&2
  echo "  - the asset name is exactly '$MODEL'" >&2
  exit 1
fi

SIZE=$(wc -c <"$TMP" | tr -d ' ')
# A Git LFS pointer or an HTML error page is a few hundred bytes; a real model is ~7 MB.
if [[ "$SIZE" -lt 2000000 ]]; then
  echo "Downloaded only $SIZE bytes — that is not the model (LFS pointer or error page?)." >&2
  echo "First bytes:" >&2
  head -c 200 "$TMP" >&2 || true
  echo "" >&2
  exit 1
fi

SHA=$(if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$TMP"; else sha256sum "$TMP"; fi | cut -d' ' -f1)
if [[ -n "${EXPECT_SHA256:-}" && "$SHA" != "$EXPECT_SHA256" ]]; then
  echo "SHA-256 mismatch — refusing to install." >&2
  echo "  expected: $EXPECT_SHA256" >&2
  echo "  actual:   $SHA" >&2
  exit 1
fi

mv "$TMP" "$DEST"
echo "Saved $DEST"
echo "Size:   $SIZE bytes"
echo "SHA256: $SHA"
echo ""
echo "Next: rebuild. WakeWordDetector.create picks this up automatically and logs"
echo "'LiveKitWakeWordDetector created' — if you instead see the sherpa line, the asset did not make"
echo "it into the APK. Also record the model in THIRD_PARTY_NOTICES.md (Apache-2.0, LiveKit)."
