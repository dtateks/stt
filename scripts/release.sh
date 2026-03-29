#!/usr/bin/env bash
set -euo pipefail

ASSET_NAME="Voice-to-Text-darwin-arm64.zip"
APP_BUNDLE="src/target/release/bundle/macos/Voice to Text.app"
SIGN_SCRIPT="scripts/sign-macos-app.sh"
DEFAULT_REMOTE="origin"

repo_name() {
	gh repo view --json nameWithOwner -q .nameWithOwner
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
	local repo
	local release_name="Voice to Text ${tag}"
	repo="$(repo_name)"

	if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
		echo "▸ Updating release ${tag}…"
		gh release upload "$tag" "$ASSET_NAME" --repo "$repo" --clobber
	else
		echo "▸ Creating release ${tag}…"
		gh release create "$tag" \
			--repo "$repo" \
			--title "$release_name" \
			--latest \
			--generate-notes \
			"$ASSET_NAME"
	fi

	echo "✓ Release published: https://github.com/${repo}/releases/tag/${tag}"
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

	ensure_prerequisites
	build_and_package_local_arm64_release
	tag="$(local_release_tag)"
	ensure_release_tag_points_at_head "$tag"
	push_refspecs_with_release_tag "$DEFAULT_REMOTE" "$tag"
	publish_local_arm64_release "$tag"
	rm -f "$ASSET_NAME"
}

run_pre_push_release() {
	local remote_name="$1"
	local remote_url="$2"
	local ref_file="$3"
	local tag
	mapfile -t refspecs < <(refspecs_from_pre_push_input "$ref_file")

	ensure_prerequisites
	build_and_package_local_arm64_release
	tag="$(local_release_tag)"
	ensure_release_tag_points_at_head "$tag"
	push_refspecs_with_release_tag "$remote_name" "$tag" "${refspecs[@]}"

	if ! publish_local_arm64_release "$tag"; then
		echo "WARN: local release publication failed after push; CI fallback will build both architectures." >&2
	fi

	rm -f "$ASSET_NAME"
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
