#!/bin/bash
set -e

echo "Installing Voice to Text..."

TEMP_REPO_DIR=""

cleanup() {
	if [ -n "$TEMP_REPO_DIR" ] && [ -d "$TEMP_REPO_DIR" ]; then
		rm -rf "$TEMP_REPO_DIR"
	fi
}

trap cleanup EXIT

# Clone if not already in the repo
if [ ! -f "package.json" ] || ! grep -q '"voice-everywhere"' package.json 2>/dev/null; then
	TEMP_REPO_DIR=$(mktemp -d "/tmp/stt-install.XXXXXX")
	git clone https://github.com/dtateks/stt.git "$TEMP_REPO_DIR"
	cd "$TEMP_REPO_DIR"
fi

npm install --no-fund --no-audit
npm run build:dir
rm -rf /Applications/Voice\ to\ Text.app 2>/dev/null
APP_BUNDLE=""
for candidate in dist/mac*/Voice\ to\ Text.app; do
	if [ -d "$candidate" ]; then
		if [ -n "$APP_BUNDLE" ]; then
			echo "Error: multiple Voice to Text.app bundles found in dist/."
			exit 1
		fi
		APP_BUNDLE="$candidate"
	fi
done

if [ -z "$APP_BUNDLE" ]; then
	echo "Error: Voice to Text.app not found in dist/"
	exit 1
fi

SIGNATURE_INFO=$(codesign -dv --verbose=4 "$APP_BUNDLE" 2>&1 || true)
case "$SIGNATURE_INFO" in
*"Identifier=com.voiceeverywhere.app"*) ;;
*)
	echo "Error: built app does not have a usable macOS app identity for TCC permissions."
	echo "Build output:"
	echo "$SIGNATURE_INFO"
	echo "Run the packaged app from /Applications. Do not test macOS permissions via npm start/electron ."
	exit 1
	;;
esac

ensure_audio_input_entitlement() {
	local target_path="$1"
	local label="$2"
	local entitlements_info

	if [ ! -d "$target_path" ]; then
		echo "Error: $label not found at $target_path"
		exit 1
	fi

	entitlements_info=$(codesign -d --entitlements - "$target_path" 2>&1 || true)
	case "$entitlements_info" in
	*"com.apple.security.device.audio-input"*) ;;
	*)
		echo "Error: $label is missing microphone entitlements required for macOS TCC registration."
		echo "Entitlements output:"
		echo "$entitlements_info"
		exit 1
		;;
	esac
}

ensure_audio_input_entitlement "$APP_BUNDLE" "Voice to Text.app"
ensure_audio_input_entitlement "$APP_BUNDLE/Contents/Frameworks/Voice to Text Helper (Renderer).app" "Voice to Text Helper (Renderer).app"

cp -R "$APP_BUNDLE" /Applications/

echo ""
echo "Voice to Text installed to /Applications!"
echo "Opening..."
open /Applications/Voice\ to\ Text.app
