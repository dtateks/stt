#!/bin/bash
set -euo pipefail

APP_NAME="Voice to Text.app"
APP_BUNDLE_ID="com.voicetotext.stt"
APP_HELPER_PATH="Contents/Frameworks/Voice to Text Helper (Renderer).app"
GITHUB_REPO="dtateks/stt"
GITHUB_RELEASES_API="https://api.github.com/repos/$GITHUB_REPO/releases/latest"
INSTALL_PATH="/Applications/$APP_NAME"
TEMP_DIR=""
SOURCE_REPO_DIR=""

cleanup() {
	if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
		rm -rf "$TEMP_DIR"
	fi

	if [ -n "$SOURCE_REPO_DIR" ] && [ -d "$SOURCE_REPO_DIR" ]; then
		rm -rf "$SOURCE_REPO_DIR"
	fi
}

trap cleanup EXIT

detect_release_arch() {
	case "$(uname -m)" in
	arm64 | aarch64)
		printf '%s' "arm64"
		;;
	x86_64)
		printf '%s' "x64"
		;;
	*)
		echo "Error: unsupported macOS architecture $(uname -m)"
		exit 1
		;;
	esac
}

resolve_release_zip_url() {
	local release_arch="$1"
	local direct_url="${STT_APP_ZIP_URL:-}"
	local release_metadata
	local zip_urls
	local matched_url

	if [ -n "$direct_url" ]; then
		printf '%s' "$direct_url"
		return 0
	fi

	if ! release_metadata=$(curl -fsSL -H "Accept: application/vnd.github+json" "$GITHUB_RELEASES_API" 2>/dev/null); then
		return 1
	fi
	zip_urls=$(printf '%s' "$release_metadata" | sed -n 's/.*"browser_download_url":"\([^"]*\.zip\)".*/\1/p' | sed 's#\\/#/#g')

	if [ -z "$zip_urls" ]; then
		return 1
	fi

	matched_url=$(printf '%s\n' "$zip_urls" | grep "/.*${release_arch}.*\.zip$" | head -n 1 || true)
	if [ -n "$matched_url" ]; then
		printf '%s' "$matched_url"
		return
	fi

	matched_url=$(printf '%s\n' "$zip_urls" | grep "/.*universal.*\.zip$" | head -n 1 || true)
	if [ -n "$matched_url" ]; then
		printf '%s' "$matched_url"
		return
	fi

	printf '%s\n' "$zip_urls" | head -n 1
}

build_app_bundle_from_source() {
	if [ -f "package.json" ] && grep -q '"voice-to-text"' package.json 2>/dev/null; then
		npm install --no-fund --no-audit
		npm run build
		printf '%s' "src/target/release/bundle"
		return
	else
		SOURCE_REPO_DIR=$(mktemp -d "/tmp/stt-source.XXXXXX")
		git clone "https://github.com/$GITHUB_REPO.git" "$SOURCE_REPO_DIR"
		(
			cd "$SOURCE_REPO_DIR"
			npm install --no-fund --no-audit
			npm run build
		)
		printf '%s' "$SOURCE_REPO_DIR/src/target/release/bundle"
		return
	fi
}

find_downloaded_app_bundle() {
	local search_root="$1"
	local app_path

	app_path=$(find "$search_root" -maxdepth 6 -name "$APP_NAME" -type d | head -n 1)
	if [ -z "$app_path" ]; then
		echo "Error: $APP_NAME not found in installer payload"
		exit 1
	fi

	printf '%s' "$app_path"
}

verify_bundle_identity() {
	local bundle_path="$1"
	local signature_info

	signature_info=$(codesign -dv --verbose=4 "$bundle_path" 2>&1 || true)
	case "$signature_info" in
	*"Identifier=$APP_BUNDLE_ID"*) ;;
	*)
		echo "Error: installer payload does not have the expected macOS app identity."
		echo "codesign output:"
		echo "$signature_info"
		exit 1
		;;
	esac
}

ensure_required_entitlement() {
	local target_path="$1"
	local label="$2"
	local entitlement_key="$3"
	local failure_message="$4"
	local entitlements_info

	if [ ! -d "$target_path" ]; then
		echo "Error: $label not found at $target_path"
		exit 1
	fi

	entitlements_info=$(codesign -d --entitlements - "$target_path" 2>&1 || true)
	case "$entitlements_info" in
	*"$entitlement_key"*) ;;
	*)
		echo "Error: $label $failure_message"
		echo "Entitlements output:"
		echo "$entitlements_info"
		exit 1
		;;
	esac
}

ensure_renderer_helper_entitlement_if_present() {
	local bundle_path="$1"
	local helper_path="$bundle_path/$APP_HELPER_PATH"

	if [ ! -d "$helper_path" ]; then
		return
	fi

	ensure_required_entitlement \
		"$helper_path" \
		"Voice to Text Helper (Renderer).app" \
		"com.apple.security.device.audio-input" \
		"is missing microphone entitlements required for macOS TCC registration."
}

install_app_bundle() {
	local source_bundle="$1"

	if [ -w "/Applications" ]; then
		rm -rf "$INSTALL_PATH"
		ditto "$source_bundle" "$INSTALL_PATH"
		xattr -cr "$INSTALL_PATH" || true
	else
		sudo rm -rf "$INSTALL_PATH"
		sudo ditto "$source_bundle" "$INSTALL_PATH"
		sudo xattr -cr "$INSTALL_PATH" || true
	fi
}

echo "Installing Voice to Text..."

TEMP_DIR=$(mktemp -d "/tmp/stt-install.XXXXXX")
RELEASE_ARCH=$(detect_release_arch)
ZIP_PATH="$TEMP_DIR/release.zip"
UNPACK_DIR="$TEMP_DIR/unpacked"

ZIP_URL=""
if ZIP_URL=$(resolve_release_zip_url "$RELEASE_ARCH"); then
	echo "Downloading latest release for $RELEASE_ARCH..."
	curl -fL "$ZIP_URL" -o "$ZIP_PATH"
	mkdir -p "$UNPACK_DIR"
	ditto -x -k "$ZIP_PATH" "$UNPACK_DIR"
	APP_BUNDLE=$(find_downloaded_app_bundle "$UNPACK_DIR")
else
	echo "No downloadable release zip found. Building from source instead..."
	DIST_DIR=$(build_app_bundle_from_source)
	APP_BUNDLE=$(find_downloaded_app_bundle "$DIST_DIR")
fi

verify_bundle_identity "$APP_BUNDLE"
ensure_required_entitlement \
	"$APP_BUNDLE" \
	"$APP_NAME" \
	"com.apple.security.device.audio-input" \
	"is missing microphone entitlements required for macOS TCC registration."
ensure_required_entitlement \
	"$APP_BUNDLE" \
	"$APP_NAME" \
	"com.apple.security.automation.apple-events" \
	"is missing Apple Events entitlements required for accessibility-driven paste automation."
ensure_renderer_helper_entitlement_if_present "$APP_BUNDLE"
install_app_bundle "$APP_BUNDLE"

echo ""
echo "Voice to Text installed to /Applications!"
echo "Opening..."
open "$INSTALL_PATH"
