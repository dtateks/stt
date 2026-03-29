#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE_PATH="${1:-}"
ENTITLEMENTS_PATH="${2:-src/Entitlements.plist}"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"

sign_bundle_with_entitlements() {
	local bundle_path="$1"
	local entitlements_info
	local codesign_args=(--force --sign "$SIGNING_IDENTITY" --entitlements "$ENTITLEMENTS_PATH")

	if [ "$SIGNING_IDENTITY" != "-" ]; then
		codesign_args+=(--options runtime --timestamp)
	fi

	codesign "${codesign_args[@]}" "$bundle_path"
	codesign --verify --verbose=2 "$bundle_path" >/dev/null

	entitlements_info=$(codesign -d --entitlements - "$bundle_path" 2>&1 || true)

	case "$entitlements_info" in
	*"com.apple.security.device.audio-input"*) ;;
	*)
		echo "Error: signed app bundle is missing microphone entitlements" >&2
		echo "$entitlements_info" >&2
		exit 1
		;;
	esac

	case "$entitlements_info" in
	*"com.apple.security.automation.apple-events"*) ;;
	*)
		echo "Error: signed app bundle is missing Apple Events entitlements" >&2
		echo "$entitlements_info" >&2
		exit 1
		;;
	esac
}

if [ -z "$APP_BUNDLE_PATH" ]; then
	echo "Error: missing app bundle path argument" >&2
	exit 1
fi

if [ ! -d "$APP_BUNDLE_PATH" ]; then
	echo "Error: app bundle not found at $APP_BUNDLE_PATH" >&2
	exit 1
fi

if [ ! -f "$ENTITLEMENTS_PATH" ]; then
	echo "Error: entitlements file not found at $ENTITLEMENTS_PATH" >&2
	exit 1
fi

for nested_app_bundle in "$APP_BUNDLE_PATH"/Contents/Frameworks/*.app; do
	if [ -d "$nested_app_bundle" ]; then
		sign_bundle_with_entitlements "$nested_app_bundle"
	fi
done

sign_bundle_with_entitlements "$APP_BUNDLE_PATH"
