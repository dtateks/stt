#!/bin/bash
set -euo pipefail

APP_NAME="Voice to Text.app"
APP_BUNDLE_ID="com.voicetotext.stt"
APP_HELPER_PATH="Contents/Frameworks/Voice to Text Helper (Renderer).app"
GITHUB_REPO="dtateks/stt"
GITHUB_RELEASES_DOWNLOAD_BASE="https://github.com/$GITHUB_REPO/releases/latest/download"
RELEASE_ZIP_ARM64="Voice-to-Text-darwin-arm64.zip"
RELEASE_ZIP_X64="Voice-to-Text-darwin-x64.zip"
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
	local release_zip_name
	local release_zip_url

	if [ -n "$direct_url" ]; then
		printf '%s' "$direct_url"
		return 0
	fi

	case "$release_arch" in
	arm64)
		release_zip_name="$RELEASE_ZIP_ARM64"
		;;
	x64)
		release_zip_name="$RELEASE_ZIP_X64"
		;;
	*)
		echo "Error: unsupported release architecture $release_arch"
		exit 1
		;;
	esac

	release_zip_url="$GITHUB_RELEASES_DOWNLOAD_BASE/$release_zip_name"
	printf '%s' "$release_zip_url"
}

build_app_bundle_from_source() {
	local source_root
	local bundle_root
	local sign_script_path
	local entitlements_path

	if [ -f "package.json" ] && [ -f "scripts/sign-macos-app.sh" ] && [ -f "src/tauri.conf.json" ]; then
		source_root="$(pwd)"
		npm install --no-fund --no-audit
		npm run build
	else
		SOURCE_REPO_DIR=$(mktemp -d "/tmp/stt-source.XXXXXX")
		git clone "https://github.com/$GITHUB_REPO.git" "$SOURCE_REPO_DIR"
		(
			cd "$SOURCE_REPO_DIR"
			npm install --no-fund --no-audit
			npm run build
		)
		source_root="$SOURCE_REPO_DIR"
	fi

	bundle_root="$source_root/src/target/release/bundle"
	sign_script_path="$source_root/scripts/sign-macos-app.sh"
	entitlements_path="$source_root/src/Entitlements.plist"

	"$sign_script_path" "$bundle_root/macos/$APP_NAME" "$entitlements_path"
	printf '%s' "$bundle_root"
}

find_downloaded_app_bundle() {
	local search_root="$1"
	local app_path

	app_path=$(find "$search_root" -maxdepth 6 -name "$APP_NAME" -type d | head -n 1)
	if [ -z "$app_path" ]; then
		echo "Error: $APP_NAME not found in installer payload"
		return 1
	fi

	printf '%s' "$app_path"
}

verify_bundle_identity() {
	local bundle_path="$1"
	local info_plist_path="$bundle_path/Contents/Info.plist"
	local bundle_identifier

	bundle_identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist_path" 2>/dev/null || true)
	if [ "$bundle_identifier" != "$APP_BUNDLE_ID" ]; then
		echo "Error: installer payload does not have the expected macOS app identity."
		echo "Expected CFBundleIdentifier: $APP_BUNDLE_ID"
		echo "Actual CFBundleIdentifier: ${bundle_identifier:-<missing>}"
		return 1
	fi
}

ensure_required_entitlement() {
	local target_path="$1"
	local label="$2"
	local entitlement_key="$3"
	local failure_message="$4"
	local entitlements_info

	if [ ! -d "$target_path" ]; then
		echo "Error: $label not found at $target_path"
		return 1
	fi

	entitlements_info=$(codesign -d --entitlements - "$target_path" 2>&1 || true)
	case "$entitlements_info" in
	*"$entitlement_key"*) ;;
	*)
		echo "Error: $label $failure_message"
		echo "Entitlements output:"
		echo "$entitlements_info"
		return 1
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

validate_app_bundle() {
	local bundle_path="$1"

	verify_bundle_identity "$bundle_path" || return 1
	ensure_required_entitlement \
		"$bundle_path" \
		"$APP_NAME" \
		"com.apple.security.device.audio-input" \
		"is missing microphone entitlements required for macOS TCC registration." || return 1
	ensure_required_entitlement \
		"$bundle_path" \
		"$APP_NAME" \
		"com.apple.security.automation.apple-events" \
		"is missing Apple Events entitlements required for accessibility-driven paste automation." || return 1
	ensure_renderer_helper_entitlement_if_present "$bundle_path" || return 1
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
	if curl -fL "$ZIP_URL" -o "$ZIP_PATH"; then
		mkdir -p "$UNPACK_DIR"
		ditto -x -k "$ZIP_PATH" "$UNPACK_DIR"
		if APP_BUNDLE=$(find_downloaded_app_bundle "$UNPACK_DIR") && validate_app_bundle "$APP_BUNDLE"; then
			:
		else
			echo "Downloaded release failed validation. Building from source instead..."
			DIST_DIR=$(build_app_bundle_from_source)
			APP_BUNDLE=$(find_downloaded_app_bundle "$DIST_DIR")
		fi
	else
		echo "Release download failed. Building from source instead..."
		DIST_DIR=$(build_app_bundle_from_source)
		APP_BUNDLE=$(find_downloaded_app_bundle "$DIST_DIR")
	fi
else
	echo "No downloadable release zip found. Building from source instead..."
	DIST_DIR=$(build_app_bundle_from_source)
	APP_BUNDLE=$(find_downloaded_app_bundle "$DIST_DIR")
fi
validate_app_bundle "$APP_BUNDLE"
install_app_bundle "$APP_BUNDLE"

echo ""
echo "Voice to Text installed to /Applications!"
echo "Opening..."
open "$INSTALL_PATH"
