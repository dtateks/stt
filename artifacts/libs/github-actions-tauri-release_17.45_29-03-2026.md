# GitHub Actions Release Research: Tauri v2 macOS App

**Date**: 2026-03-29  
**Purpose**: Evidence-backed answers for implementing reliable GitHub Actions releases

---

## 1. macOS Runner Architecture Mapping

**Claim**: GitHub-hosted macOS runners map to specific architectures as follows:

| Architecture | Runner Labels | Notes |
|-------------|---------------|-------|
| **Intel / x64** | `macos-15-intel`, `macos-26-intel` | 4 vCPU, 14 GB RAM, 14 GB SSD |
| **Apple Silicon / arm64** | `macos-latest`, `macos-14`, `macos-15`, `macos-26` | 3 vCPU (M1), 7 GB RAM, 14 GB SSD |

**Evidence** ([GitHub docs — runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#supported-runners-and-hardware-resources)):

```
macOS  |  4 vCPU  |  14 GB  |  14 GB  |  Intel  |  macos-15-intel, macos-26-intel
macOS  |  3 vCPU (M1)  |  7 GB  |  14 GB  |  arm64  |  macos-latest, macos-14, macos-15, macos-26
```

**Gotcha**: `macos-latest` is being migrated from macOS 14 ARM64 to macOS 15 ARM64 between **August 4 – September 1, 2025**. If you use `macos-latest` in CI, be aware it will flip to macOS 15 mid-transition. Pin to `macos-14` or `macos-15-arm64` for stability.

**For Tauri builds**: You need **both** Intel and ARM64 runners to produce universal (or arch-separated) `.app` bundles:
- `macos-15-intel` for x64
- `macos-15` (ARM64) for Apple Silicon

---

## 2. Creating a GitHub Release on Every Push to Main with Stable `latest` Link

**Claim**: Use the `softprops/action-gh-release` action triggered on **tag pushes**, with `make_latest: true` (or `legacy`).

**Evidence** ([softprops/action-gh-release README](https://github.com/softprops/action-gh-release), [GitHub Releases API docs](https://docs.github.com/rest/releases/releases)):

### Recommended Workflow

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'        # semver tag pattern — only tags trigger releases

jobs:
  build-and-release:
    runs-on: ${{ matrix.runner }}
    strategy:
      matrix:
        include:
          - runner: macos-15-intel
            artifact: darwin-x64
          - runner: macos-15
            artifact: darwin-arm64

    steps:
      - uses: actions/checkout@v4

      - name: Build Tauri app
        run: |
          npm install
          npm run build
        env:
          # Auth for notarization if needed
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}

      - name: Package .app into .zip
        run: |
          ditto -c -k --keepParent \
            "path/to/YourApp.app" \
            "YourApp-${{ matrix.artifact }}.zip"

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: "YourApp-${{ matrix.artifact }}.zip"
          make_latest: true       # ← marks this as 'latest'
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### `make_latest` Options

| Value | Behavior |
|-------|----------|
| `true` | This release IS the `latest` (overrides previous `latest`) |
| `false` | This release is NOT `latest` |
| `legacy` | Uses semantic version ordering instead of creation date |

**Key insight**: The `make_latest` parameter maps to the API's `make_latest` body parameter. Drafts and prereleases **cannot** be set as latest — GitHub API rejects this with `422`.

### Stable Download Link Pattern

For install scripts that need a stable `latest` URL:

```
https://github.com/{owner}/{repo}/releases/latest/download/{asset-name}
```

This always resolves to the latest **non-prerelease, non-draft** release. No tag or release ID needed.

---

## 3. Does `latest` API Include Prereleases? Strategy for Install-Script 404s

**Claim**: `GET /repos/{owner}/{repo}/releases/latest` **explicitly excludes prereleases**.

**Evidence** ([GitHub REST API docs](https://docs.github.com/rest/releases/releases#get-the-latest-release)):

> "View the latest published full release for the repository.  
> The latest release is the most recent **non-prerelease**, non-draft release, sorted by the created_at attribute."

```json
{
  "tag_name": "v1.2.0",
  "prerelease": false,   // ← latest never returns prerelease: true
  "draft": false
}
```

### Strategies to Avoid Install-Script 404s

| Strategy | How | Trade-off |
|----------|-----|-----------|
| **Never mark as prerelease** | Release as `prerelease: false` so `latest` always includes it | All releases are "official" |
| **Use `make_latest: false`** | Explicitly exclude a prerelease from `latest` | You must update `latest` manually via `make_latest: true` on the next real release |
| **Use tag-based URLs** | `https://github.com/{owner}/{repo}/releases/download/{tag}/{asset}` | Requires tag to be known; `latest` doesn't always point to newest |
| **Use `generate_release_notes` with `previous_tag`** | Control exactly which release becomes `latest` | More complex workflow |

### Gotcha: `latest` is based on `created_at` of the **commit used for the release**, not the release creation date. If you backfill old commits with new tags, `latest` may point somewhere unexpected.

---

## 4. Preferred Asset Packaging for macOS App Bundles

**Claim**: Use **`ditto`** (not `zip`) to preserve macOS extended attributes, resource forks, and Finder metadata.

**Evidence** ([Apple Developer Forums — DTS engineer](https://developer.apple.com/forums/thread/690457)):

> "When creating a zip archive macOS supports two approaches for storing AppleDouble files. [...] By default it stores the AppleDouble file next to the original file."

### Why `zip` Fails for `.app` Bundles

Standard `zip -r` does **not** preserve:
- Resource forks (stored as `._` AppleDouble files)
- Extended attributes (`com.apple.metadata:*`, `com.apple.quarantine`, etc.)
- Finder comments and stamps

When a macOS `.app` bundle is zipped with plain `zip`, codesignature metadata can be lost, causing Gatekeeper rejection on download.

### Recommended Commands

**Basic (preserves metadata inline):**
```bash
ditto -c -k --keepParent "YourApp.app" "YourApp.zip"
```
- `--keepParent` keeps the `YourApp/` directory prefix inside the zip
- `-k` creates a ZIP-compatible archive
- `ditto` automatically includes `._` AppleDouble files alongside modified files

**Sequestered resource forks (for cross-platform compatibility):**
```bash
ditto -c -k --keepParent --sequesterRsrc "YourApp.app" "YourApp.zip"
```
- `--sequesterRsrc` moves all AppleDouble files into `__MACOSX/` subdirectory
- Recipients on non-macOS systems can strip `__MACOSX/` without affecting the app
- macOS users get full metadata when unzipped normally

### Batching Multiple Architectures

```bash
# Intel
ditto -c -k --keepParent "YourApp.app" "YourApp-darwin-x64.zip"
# ARM64  
ditto -c -k --keepParent "YourApp.app" "YourApp-darwin-arm64.zip"
```

Upload both to the same GitHub Release — install scripts can detect architecture via:
```bash
uname -m  # x86_64 vs arm64
```

---

## Summary Table

| Topic | Recommendation | Source |
|-------|---------------|--------|
| **Intel runner** | `macos-15-intel` or `macos-26-intel` | [Docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |
| **ARM64 runner** | `macos-15` or `macos-14` (both M1) | [Docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |
| **Release action** | `softprops/action-gh-release@v2` with `make_latest: true` | [README](https://github.com/softprops/action-gh-release) |
| **Stable latest URL** | `https://github.com/{owner}/{repo}/releases/latest/download/{asset}` | [API docs](https://docs.github.com/rest/releases/releases) |
| **`latest` excludes prerelease** | Yes — must use `prerelease: false` or `make_latest: false` | [API docs](https://docs.github.com/rest/releases/releases) |
| **macOS zip tool** | `ditto -c -k --keepParent` (NOT `zip`) | [Apple Forums](https://developer.apple.com/forums/thread/690457) |
| **Prerelease strategy** | Use `make_latest: false` to exclude prereleases from `latest` | [softprops/action-gh-release](https://github.com/softprops/action-gh-release) |

## Key Gotchas

1. **`macos-latest` migration**: Flips from macOS 14 ARM64 → macOS 15 ARM64 Aug–Sep 2025. Pin explicitly if stability matters.
2. **`make_latest` is rejected for drafts/prereleases**: API returns `422`. Use `make_latest: false` for prereleases.
3. **`zip` strips macOS metadata**: Codesigned `.app` bundles lose integrity when zipped with `zip`. Use `ditto`.
4. **`latest` is commit-date-based, not release-date-based**: Creating a release for an old commit shifts `latest` to that older point.
5. **`softprops/action-gh-release` needs `contents: write` permission**: Add `permissions: contents: write` to your job.
