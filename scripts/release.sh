#!/usr/bin/env bash
set -euo pipefail

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
ASSET_NAME="Voice-to-Text-darwin-arm64.zip"
APP_BUNDLE="src/target/release/bundle/macos/Voice to Text.app"
ENTITLEMENTS="src/Entitlements.plist"

# ── Preflight ──────────────────────────────────────────────────────────────

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

# ── Build ──────────────────────────────────────────────────────────────────

echo "▸ Building macOS app bundle…"
npm run build

if [[ ! -d "$APP_BUNDLE" ]]; then
	echo "ERROR: app bundle not found at: $APP_BUNDLE" >&2
	exit 1
fi

# ── Sign (ad-hoc with entitlements) ────────────────────────────────────────

echo "▸ Ad-hoc codesigning with entitlements…"
codesign --force --sign - \
	--entitlements "$ENTITLEMENTS" \
	--deep \
	"$APP_BUNDLE"

codesign --verify --verbose=2 "$APP_BUNDLE"
echo "  ✓ Signature verified"

# ── Package ────────────────────────────────────────────────────────────────

echo "▸ Packaging zip…"
rm -f "$ASSET_NAME"
ditto -c -k --keepParent --sequesterRsrc "$APP_BUNDLE" "$ASSET_NAME"

# ── Push + Release ─────────────────────────────────────────────────────────

echo "▸ Pushing to origin/main…"
git push

SHORT_SHA="$(git rev-parse --short=7 HEAD)"
TAG="local-${SHORT_SHA}"
RELEASE_NAME="Voice to Text ${TAG}"

echo "▸ Creating release ${TAG}…"
gh release create "$TAG" \
	--repo "$REPO" \
	--title "$RELEASE_NAME" \
	--target "$(git rev-parse HEAD)" \
	--latest \
	--generate-notes \
	"$ASSET_NAME"

rm -f "$ASSET_NAME"

echo "✓ Release published: https://github.com/${REPO}/releases/tag/${TAG}"
