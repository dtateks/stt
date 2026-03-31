#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE_PATH="${1:-}"
ENTITLEMENTS_PATH="${2:-src/Entitlements.plist}"
AD_HOC_SIGNING_IDENTITY="-"
LOCAL_REVIEW_SIGNING_IDENTITY_DEFAULT="Voice to Text Local Review Signing"
LOCAL_REVIEW_SIGNING_IDENTITY="${STT_LOCAL_REVIEW_SIGNING_IDENTITY:-$LOCAL_REVIEW_SIGNING_IDENTITY_DEFAULT}"
SIGNING_MODE_LOCAL_REVIEW="local-review"
SIGNING_MODE_SOURCE_FALLBACK="source-fallback"
SIGNING_MODE="${STT_SIGNING_MODE:-}"
SIGNING_SOURCE_EXPLICIT="explicit"
SIGNING_SOURCE_LOCAL_REVIEW="local-review"
SIGNING_SOURCE_AD_HOC="ad-hoc"
SIGNING_IDENTITY_ENV="${APPLE_SIGNING_IDENTITY:-}"
SIGNING_IDENTITY=""
SIGNING_SOURCE=""

can_codesign_bundle_with_identity() {
	local identity_name="$1"
	local bundle_path="$2"
	codesign --dryrun --force --sign "$identity_name" --entitlements "$ENTITLEMENTS_PATH" "$bundle_path" >/dev/null 2>&1
}

resolve_local_review_signing_identity() {
	if [ -n "$SIGNING_IDENTITY_ENV" ]; then
		if ! can_codesign_bundle_with_identity "$SIGNING_IDENTITY_ENV" "$APP_BUNDLE_PATH"; then
			echo "Error: explicit signing identity is unavailable for codesign: $SIGNING_IDENTITY_ENV" >&2
			exit 1
		fi

		SIGNING_IDENTITY="$SIGNING_IDENTITY_ENV"
		SIGNING_SOURCE="$SIGNING_SOURCE_EXPLICIT"
		return
	fi

	if can_codesign_bundle_with_identity "$LOCAL_REVIEW_SIGNING_IDENTITY" "$APP_BUNDLE_PATH"; then
		SIGNING_IDENTITY="$LOCAL_REVIEW_SIGNING_IDENTITY"
		SIGNING_SOURCE="$SIGNING_SOURCE_LOCAL_REVIEW"
		return
	fi

	SIGNING_IDENTITY="$AD_HOC_SIGNING_IDENTITY"
	SIGNING_SOURCE="$SIGNING_SOURCE_AD_HOC"
}

resolve_source_fallback_signing_identity() {
	if [ -n "$SIGNING_IDENTITY_ENV" ]; then
		if ! can_codesign_bundle_with_identity "$SIGNING_IDENTITY_ENV" "$APP_BUNDLE_PATH"; then
			echo "Error: explicit signing identity is unavailable for codesign: $SIGNING_IDENTITY_ENV" >&2
			exit 1
		fi

		SIGNING_IDENTITY="$SIGNING_IDENTITY_ENV"
		SIGNING_SOURCE="$SIGNING_SOURCE_EXPLICIT"
		return
	fi

	SIGNING_IDENTITY="$AD_HOC_SIGNING_IDENTITY"
	SIGNING_SOURCE="$SIGNING_SOURCE_AD_HOC"
}

resolve_signing_identity() {
	if [ -z "$SIGNING_MODE" ]; then
		echo "Error: STT_SIGNING_MODE is required. Use '$SIGNING_MODE_LOCAL_REVIEW' or '$SIGNING_MODE_SOURCE_FALLBACK'." >&2
		exit 1
	fi

	case "$SIGNING_MODE" in
	"$SIGNING_MODE_LOCAL_REVIEW")
		resolve_local_review_signing_identity
		;;
	"$SIGNING_MODE_SOURCE_FALLBACK")
		resolve_source_fallback_signing_identity
		;;
	*)
		echo "Error: unsupported signing mode '$SIGNING_MODE'" >&2
		exit 1
		;;
	esac
}

print_signing_mode_message() {
	case "$SIGNING_SOURCE" in
	"$SIGNING_SOURCE_EXPLICIT")
		echo "Signing mode: explicit identity ($SIGNING_IDENTITY)"
		;;
	"$SIGNING_SOURCE_LOCAL_REVIEW")
		echo "Signing mode: stable local-review identity ($SIGNING_IDENTITY)"
		echo "TCC note: repeated installs at /Applications/Voice to Text.app will retain permissions on this machine."
		;;
	"$SIGNING_SOURCE_AD_HOC")
		echo "WARNING: signing mode fell back to ad-hoc identity (-)."
		echo "WARNING: macOS TCC permissions may churn after each install/update until a stable signing identity is configured."
		;;
	*)
		echo "Error: unknown signing source '$SIGNING_SOURCE'" >&2
		exit 1
		;;
	esac
}

sign_bundle_with_entitlements() {
	local bundle_path="$1"
	local entitlements_info
	local codesign_args=(--force --sign "$SIGNING_IDENTITY" --entitlements "$ENTITLEMENTS_PATH")

	if [ "$SIGNING_SOURCE" = "$SIGNING_SOURCE_EXPLICIT" ] && [ "$SIGNING_IDENTITY" != "$AD_HOC_SIGNING_IDENTITY" ]; then
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

resolve_signing_identity
print_signing_mode_message

for nested_app_bundle in "$APP_BUNDLE_PATH"/Contents/Frameworks/*.app; do
	if [ -d "$nested_app_bundle" ]; then
		sign_bundle_with_entitlements "$nested_app_bundle"
	fi
done

sign_bundle_with_entitlements "$APP_BUNDLE_PATH"
