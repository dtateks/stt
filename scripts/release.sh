#!/usr/bin/env bash
set -euo pipefail

ASSET_NAME="Voice-to-Text-darwin-arm64.zip"
APP_BUNDLE="src/target/release/bundle/macos/Voice to Text.app"
UPDATER_ARCHIVE_ASSET="Voice-to-Text-darwin-arm64.app.tar.gz"
UPDATER_SIGNATURE_ASSET="${UPDATER_ARCHIVE_ASSET}.sig"
UPDATER_MANIFEST_NAME="latest.json"
SIGN_SCRIPT="scripts/sign-macos-app.sh"
DEFAULT_REMOTE="origin"
UPDATER_SIGNING_KEY_PATH="${HOME}/.tauri/stt-updater.key"

repo_slug_from_remote_url() {
	local remote_url="$1"
	local slug="$remote_url"

	slug="${slug#git@github.com:}"
	slug="${slug#https://github.com/}"
	slug="${slug%.git}"

	if [[ "$slug" == "$remote_url" ]]; then
		echo "ERROR: unsupported GitHub remote URL: $remote_url" >&2
		exit 1
	fi

	printf '%s' "$slug"
}

repo_slug_from_remote_name() {
	local remote_name="$1"
	local remote_url
	remote_url="$(git remote get-url "$remote_name")"
	repo_slug_from_remote_url "$remote_url"
}

ensure_prerequisites() {
	if ! command -v gh &>/dev/null; then
		echo "ERROR: gh CLI is required. Install via: brew install gh" >&2
		exit 1
	fi

	if ! gh auth status &>/dev/null; then
		echo "ERROR: gh not authenticated. Run: gh auth login" >&2
		exit 1
	fi

	if [[ "$(git branch --show-current)" != "main" ]]; then
		echo "ERROR: must be on main branch" >&2
		exit 1
	fi

	if [[ -n "$(git status --porcelain)" ]]; then
		echo "ERROR: working tree is dirty — commit or stash first" >&2
		exit 1
	fi

	if [[ ! -x "$SIGN_SCRIPT" ]]; then
		echo "ERROR: sign script not executable at: $SIGN_SCRIPT" >&2
		exit 1
	fi

	if [[ ! -f "$UPDATER_SIGNING_KEY_PATH" ]]; then
		echo "ERROR: updater signing key not found at: $UPDATER_SIGNING_KEY_PATH" >&2
		echo "Generate it with: npx tauri signer generate -w \"$UPDATER_SIGNING_KEY_PATH\" -p \"\"" >&2
		exit 1
	fi
}

build_and_package_local_arm64_release() {
	echo "▸ Building macOS app bundle…"
	npm run build

	if [[ ! -d "$APP_BUNDLE" ]]; then
		echo "ERROR: app bundle not found at: $APP_BUNDLE" >&2
		exit 1
	fi

	echo "▸ Signing macOS app bundle…"
	"./$SIGN_SCRIPT" "$APP_BUNDLE"

	echo "▸ Packaging updater archive…"
	rm -f "$UPDATER_ARCHIVE_ASSET" "$UPDATER_SIGNATURE_ASSET"
	COPYFILE_DISABLE=1 tar -czf "$UPDATER_ARCHIVE_ASSET" -C "$(dirname "$APP_BUNDLE")" "$(basename "$APP_BUNDLE")"

	echo "▸ Signing updater archive…"
	TAURI_SIGNING_PRIVATE_KEY_PATH="$UPDATER_SIGNING_KEY_PATH" \
		TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
		npx tauri signer sign "$UPDATER_ARCHIVE_ASSET"

	echo "▸ Packaging zip…"
	rm -f "$ASSET_NAME"
	ditto -c -k --keepParent --sequesterRsrc "$APP_BUNDLE" "$ASSET_NAME"
}

local_release_tag() {
	printf 'local-%s' "$(git rev-parse --short=7 HEAD)"
}

ensure_release_tag_points_at_head() {
	local tag="$1"
	local head_oid
	local tag_oid

	head_oid="$(git rev-parse HEAD)"

	if git rev-parse --verify --quiet "$tag" >/dev/null; then
		tag_oid="$(git rev-list -n 1 "$tag")"
		if [[ "$tag_oid" != "$head_oid" ]]; then
			echo "ERROR: existing tag $tag points to $tag_oid, not HEAD $head_oid" >&2
			exit 1
		fi
		return
	fi

	git tag "$tag"
}

publish_local_arm64_release() {
	local tag="$1"
	local repo_slug="$2"
	local release_name="Voice to Text ${tag}"
	local release_assets=("$ASSET_NAME")

	if [[ -f "$UPDATER_ARCHIVE_ASSET" ]]; then
		release_assets+=("$UPDATER_ARCHIVE_ASSET")
	fi

	if [[ -f "$UPDATER_SIGNATURE_ASSET" ]]; then
		release_assets+=("$UPDATER_SIGNATURE_ASSET")
	fi

	if [[ -f "$UPDATER_MANIFEST_NAME" ]]; then
		release_assets+=("$UPDATER_MANIFEST_NAME")
	fi

	if gh release view "$tag" --repo "$repo_slug" >/dev/null 2>&1; then
		echo "▸ Updating release ${tag}…"
		gh release upload "$tag" "${release_assets[@]}" --repo "$repo_slug" --clobber
	else
		echo "▸ Creating release ${tag}…"
		gh release create "$tag" \
			--repo "$repo_slug" \
			--title "$release_name" \
			--latest \
			--generate-notes \
			"${release_assets[@]}"
	fi

	echo "✓ Release published: https://github.com/${repo_slug}/releases/tag/${tag}"
}

tauri_app_version() {
	node -e 'const fs=require("node:fs"); const config=JSON.parse(fs.readFileSync("src/tauri.conf.json", "utf8")); process.stdout.write(String(config.version));'
}

generate_updater_manifest() {
	local tag="$1"
	local repo_slug="$2"

	if [[ ! -f "$UPDATER_ARCHIVE_ASSET" || ! -f "$UPDATER_SIGNATURE_ASSET" ]]; then
		echo "WARN: updater artifacts not found — skipping ${UPDATER_MANIFEST_NAME} generation" >&2
		rm -f "$UPDATER_MANIFEST_NAME"
		return 0
	fi

	local version
	local signature
	local pub_date
	local archive_url

	version="$(tauri_app_version)"
	signature="$(tr -d '\r\n' <"$UPDATER_SIGNATURE_ASSET")"
	pub_date="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
	archive_url="https://github.com/${repo_slug}/releases/download/${tag}/${UPDATER_ARCHIVE_ASSET}"

	cat >"$UPDATER_MANIFEST_NAME" <<EOF
{
  "version": "${version}",
  "notes": "",
  "pub_date": "${pub_date}",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${signature}",
      "url": "${archive_url}"
    }
  }
}
EOF

	echo "▸ Generated ${UPDATER_MANIFEST_NAME} for ${tag} (darwin-aarch64)"
}

push_refspecs_with_release_tag() {
	local remote_name="$1"
	shift
	local tag="$1"
	shift
	local refspecs=("$@")
	local push_command=(git push --no-verify "$remote_name")

	if [[ ${#refspecs[@]} -eq 0 ]]; then
		push_command+=("refs/heads/main:refs/heads/main")
	else
		push_command+=("${refspecs[@]}")
	fi

	push_command+=("refs/tags/${tag}:refs/tags/${tag}")

	echo "▸ Pushing branch and release tag…"
	"${push_command[@]}"
}

push_release_tag_only() {
	local remote_name="$1"
	local tag="$2"

	echo "▸ Pushing release tag…"
	git push --no-verify "$remote_name" "refs/tags/${tag}:refs/tags/${tag}"
}

refspecs_from_pre_push_input() {
	local ref_file="$1"
	local refspecs=()

	while read -r local_ref local_oid remote_ref remote_oid; do
		[[ -z "$local_ref" ]] && continue
		refspecs+=("${local_ref}:${remote_ref}")
	done <"$ref_file"

	printf '%s\n' "${refspecs[@]}"
}

run_manual_release() {
	local tag
	local repo_slug

	ensure_prerequisites
	build_and_package_local_arm64_release
	repo_slug="$(repo_slug_from_remote_name "$DEFAULT_REMOTE")"
	tag="$(local_release_tag)"
	ensure_release_tag_points_at_head "$tag"
	generate_updater_manifest "$tag" "$repo_slug"
	push_refspecs_with_release_tag "$DEFAULT_REMOTE" "$tag"
	publish_local_arm64_release "$tag" "$repo_slug"
	rm -f "$ASSET_NAME" "$UPDATER_ARCHIVE_ASSET" "$UPDATER_SIGNATURE_ASSET" "$UPDATER_MANIFEST_NAME"
}

run_pre_push_release() {
	local remote_name="$1"
	local remote_url="$2"
	local ref_file="$3"
	local repo_slug
	local tag
	local refspecs=()
	while IFS= read -r refspec; do
		[[ -z "$refspec" ]] && continue
		refspecs+=("$refspec")
	done < <(refspecs_from_pre_push_input "$ref_file")

	ensure_prerequisites
	build_and_package_local_arm64_release
	repo_slug="$(repo_slug_from_remote_url "$remote_url")"
	tag="$(local_release_tag)"
	ensure_release_tag_points_at_head "$tag"
	generate_updater_manifest "$tag" "$repo_slug"
	push_release_tag_only "$remote_name" "$tag"

	if ! publish_local_arm64_release "$tag" "$repo_slug"; then
		echo "WARN: local release publication failed after push; CI fallback will build both architectures." >&2
	fi

	rm -f "$ASSET_NAME" "$UPDATER_ARCHIVE_ASSET" "$UPDATER_SIGNATURE_ASSET" "$UPDATER_MANIFEST_NAME"
	echo "✓ pre-push release flow completed for $remote_url"
}

case "${1:-}" in
--hook)
	if [[ $# -ne 4 ]]; then
		echo "ERROR: expected --hook <remote-name> <remote-url> <ref-file>" >&2
		exit 1
	fi
	run_pre_push_release "$2" "$3" "$4"
	;;
"")
	run_manual_release
	;;
*)
	echo "ERROR: unsupported arguments: $*" >&2
	exit 1
	;;
esac
