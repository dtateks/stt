---
name: macos-portable-app-installer
description: |
  PROACTIVE BECAUSE macOS install scripts often fail on clean machines when they depend on repo-local files, hidden signing assumptions, or impossible trust guarantees, MUST USE when generating or revising a one-line installer for a macOS .app bundle.

  Auto-trigger conditions (use without asking):
  - User asks for install.sh, curl | bash, bootstrap, setup script, or auto-install/open flow for a macOS app
  - Task involves GitHub release assets, zip extraction, /Applications or ~/Applications install, quarantine removal, relaunch, or bundle validation
  - Task mentions no Developer ID, no user action after running once, or works on any Mac

  Provides: A portable decision model and workflow for self-contained macOS app installer scripts that preserve valid release signatures, avoid local-only dependencies, and state trust-boundary limits honestly.
---

# macOS Portable App Installer

Generate self-contained macOS installer scripts for GUI apps distributed as `.app` bundles. Optimize for one-command install and immediate launch on other Macs without cloning the repo or requiring repo-local helper files.

## Critical Constraints (START Anchor)

BECAUSE macOS trust, Gatekeeper, and TCC behavior are OS boundaries rather than prompt-writing problems, MUST describe hard platform limits honestly before promising "works on any Mac" behavior.

BECAUSE repo-relative helpers break immediately on other machines, NEVER generate installers that depend on sibling scripts, local entitlements files, repo paths, or build-tree artifacts → INSTEAD: emit one self-contained script that uses only macOS system tools unless the user explicitly accepts extra dependencies.

BECAUSE file splits create hidden deployment requirements and break the promised one-liner UX, MUST default to a single `install.sh` file that contains all required logic.

BECAUSE zero-touch installs fail when the script always writes into `/Applications`, MUST default to a user-writable install target when admin access is unavailable or the task requires no extra prompts.

BECAUSE re-signing can change code identity and break permission continuity, MUST preserve a shipped release signature when a downloadable app bundle already has the required identity and entitlements.

BECAUSE source builds require toolchains and reduce portability, NEVER use source-build fallback in the default path → INSTEAD: require prebuilt release artifacts for portable installers, and mention source fallback only as an explicitly accepted non-portable mode.

BECAUSE hidden app mismatches produce dangerous installs, MUST validate the extracted app bundle identity before replacing any installed copy.

---

## Portability Model

"Reusable for any app" means the script structure is reusable after swapping app-specific constants. It does not mean one trust strategy bypasses every macOS security rule.

### Capability Matrix

| Scenario | Default stance | Why |
|---|---|---|
| Downloadable release bundle already signed as intended | Best path | Preserve the shipped identity; install and open without changing code identity |
| Downloadable unsigned or ad-hoc signed bundle | Acceptable for immediate launch if quarantine is removed, but do not promise stable permission continuity across future reinstalls or updates | Launch may work, but TCC-sensitive permissions may not persist without stable signing |
| Source-build-only app | Out of scope for the portable default path | Requires build tools and often local signing decisions, so it is not "run anywhere" |
| App needs microphone, camera, Apple Events, accessibility helpers, login items, or helper apps | Treat as identity-sensitive | Re-signing or rebuilding can invalidate permission continuity or helper trust |
| Task demands zero extra prompts | Prefer `~/Applications` fallback over `sudo /Applications` | Password prompts are user action |

### Honesty Rules

| Claim | Rule |
|---|---|
| "No Developer ID required" | Allowed only if the script preserves an already usable bundle or the user accepts unsigned/ad-hoc tradeoffs |
| "No user action after running once" | Allowed only when install path, permissions, and bundle trust model make that realistic; otherwise state the exact remaining prompts |
| "Works on any Mac" | Treat as "works on supported macOS machines that can run this bundle architecture and trust model" |

## Installer Contract

Every generated installer should expose app-specific values in one constant block at the top.

### Required constants

| Constant | Purpose |
|---|---|
| `APP_NAME` | Exact `.app` bundle name |
| `APP_BUNDLE_ID` | Expected `CFBundleIdentifier` for validation |
| `GITHUB_REPO` or release base URL | Where release assets are fetched |
| Per-arch asset names or resolver | `arm64` and `x64` release artifact selection |
| `PRIMARY_INSTALL_DIR` | Usually `/Applications` |
| `FALLBACK_INSTALL_DIR` | Usually `$HOME/Applications` for zero-touch portability |
| `APP_EXECUTABLE_RELATIVE_PATH` | Used to stop old instances safely before relaunch |

### Default system tools

Use only tools expected on a normal macOS install unless the user explicitly approves more:

| Tool | Use |
|---|---|
| `bash` | Entry shell |
| `curl` | Download release artifact |
| `ditto` | Extract zip and copy app bundle |
| `xattr` | Remove quarantine attributes after install |
| `uname` | Architecture detection |
| `mktemp` | Temporary workspace |
| `/usr/libexec/PlistBuddy` | Bundle identifier validation |
| `pgrep` / `pkill` | Stop running app before replacement |
| `osascript` | Graceful app quit by bundle id |
| `open` | Launch installed app |

### Default script shape

| Section | Required behavior |
|---|---|
| Strict mode | `set -euo pipefail` |
| Cleanup | `trap` removes temporary directories |
| Arch resolver | Map `arm64` and `x86_64` to asset names; fail clearly for unsupported machines |
| URL resolver | Support direct override env var and default release URL construction |
| Download and extract | Fetch asset, unzip into temp directory, locate `.app` bundle |
| Identity validation | Confirm extracted bundle id matches `APP_BUNDLE_ID` before install |
| Install target resolution | Prefer `/Applications` only when writable; otherwise use `$HOME/Applications` if zero-touch matters |
| Install copy | Replace existing bundle atomically enough for app installers: remove old copy, `ditto` new copy, clear quarantine |
| Running app replacement | Quit by bundle id, wait, force-stop only if needed |
| Relaunch | `open` the installed bundle path |
| Packaging | Keep everything in one `install.sh`; do not emit helper files in the default path |

## Project-Specific Logic to Remove When Generalizing

If you are adapting an existing installer like `install.sh`, strip any project-local assumptions that would fail on a different machine.

| Remove from generic output | Replace with |
|---|---|
| Repo-relative sign scripts | No signing step in the portable default path |
| Repo-local entitlements file reads | Optional entitlement validation only when the app contract explicitly requires it |
| Source clone + `npm install` + local build fallback | Prebuilt release asset requirement |
| Hardcoded app-specific helper checks | Parameterized optional checks only when the target app has helpers |
| Mandatory `sudo` install | Writable-target selection with `~/Applications` fallback |

## Optional Identity-Sensitive Checks

Apply these only when the app profile needs them.

| App profile | Additional check |
|---|---|
| TCC-sensitive app | Validate required entitlements on the downloaded bundle before install; do not re-sign unless the task explicitly accepts permission churn |
| App with helper bundles | Validate each shipped helper path only if the helper is part of the distributed app |
| Plain GUI app with no privileged features | Bundle-id validation is usually sufficient |

## High-Value Examples

Use examples to anchor output shape, not to copy app-specific assumptions. Default to one complete `install.sh`, not scattered snippets across multiple files.

### Example 1: Full single-file `install.sh`

Use this as the default non-obvious example for a portable release-first installer.

```bash
#!/bin/bash
set -euo pipefail

APP_NAME="Example App.app"
APP_BUNDLE_ID="com.example.app"
GITHUB_REPO="example/example-app"
RELEASE_ZIP_ARM64="Example-App-darwin-arm64.zip"
RELEASE_ZIP_X64="Example-App-darwin-x64.zip"
PRIMARY_INSTALL_DIR="/Applications"
FALLBACK_INSTALL_DIR="$HOME/Applications"
APP_EXECUTABLE_RELATIVE_PATH="Contents/MacOS/example-app"
TEMP_DIR=""

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64) printf '%s' "arm64" ;;
    x86_64) printf '%s' "x64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac
}

resolve_zip_url() {
  local arch="$1"
  local zip_name=""

  if [ -n "${APP_ZIP_URL:-}" ]; then
    printf '%s' "$APP_ZIP_URL"
    return 0
  fi

  case "$arch" in
    arm64) zip_name="$RELEASE_ZIP_ARM64" ;;
    x64) zip_name="$RELEASE_ZIP_X64" ;;
    *) echo "Unsupported release architecture: $arch" >&2; exit 1 ;;
  esac

  printf '%s' "https://github.com/$GITHUB_REPO/releases/latest/download/$zip_name"
}

find_app_bundle() {
  local search_root="$1"
  local app_path

  app_path=$(find "$search_root" -maxdepth 4 -name "$APP_NAME" -type d | while IFS= read -r path; do printf '%s\n' "$path"; break; done)
  if [ -z "$app_path" ]; then
    echo "Could not find $APP_NAME in extracted archive" >&2
    exit 1
  fi

  printf '%s' "$app_path"
}

verify_bundle_id() {
  local bundle_path="$1"
  local info_plist="$bundle_path/Contents/Info.plist"
  local actual_bundle_id

  actual_bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist" 2>/dev/null || true)
  if [ "$actual_bundle_id" != "$APP_BUNDLE_ID" ]; then
    echo "Unexpected bundle id: ${actual_bundle_id:-<missing>}" >&2
    exit 1
  fi
}

resolve_install_dir() {
  if [ -w "$PRIMARY_INSTALL_DIR" ]; then
    printf '%s' "$PRIMARY_INSTALL_DIR"
    return 0
  fi

  mkdir -p "$FALLBACK_INSTALL_DIR"
  printf '%s' "$FALLBACK_INSTALL_DIR"
}

terminate_running_app() {
  local installed_app_path="$1"
  local executable_pattern="${installed_app_path}/${APP_EXECUTABLE_RELATIVE_PATH}"

  if ! pgrep -f "$executable_pattern" >/dev/null 2>&1; then
    return 0
  fi

  osascript -e "tell application id \"$APP_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  sleep 2

  if pgrep -f "$executable_pattern" >/dev/null 2>&1; then
    pkill -TERM -f "$executable_pattern" >/dev/null 2>&1 || true
    sleep 1
  fi
}

install_bundle() {
  local source_bundle="$1"
  local install_dir="$2"
  local installed_app_path="$install_dir/$APP_NAME"

  mkdir -p "$install_dir"
  terminate_running_app "$installed_app_path"
  rm -rf "$installed_app_path"
  ditto "$source_bundle" "$installed_app_path"
  xattr -cr "$installed_app_path" || true
  open "$installed_app_path"
}

main() {
  local arch zip_url zip_path unpack_dir app_bundle install_dir

  if [ "$#" -ne 0 ]; then
    echo "This installer does not accept positional arguments" >&2
    exit 1
  fi

  TEMP_DIR=$(mktemp -d "/tmp/example-app-install.XXXXXX")
  arch=$(detect_arch)
  zip_url=$(resolve_zip_url "$arch")
  zip_path="$TEMP_DIR/app.zip"
  unpack_dir="$TEMP_DIR/unpacked"

  echo "Downloading $APP_NAME for $arch..."
  curl -fL "$zip_url" -o "$zip_path"

  mkdir -p "$unpack_dir"
  ditto -x -k "$zip_path" "$unpack_dir"

  app_bundle=$(find_app_bundle "$unpack_dir")
  verify_bundle_id "$app_bundle"

  install_dir=$(resolve_install_dir)
  install_bundle "$app_bundle" "$install_dir"

  echo "Installed: $install_dir/$APP_NAME"
}

main "$@"
```

### Example 2: Optional entitlement validation for TCC-sensitive apps

Append this into the same `install.sh` only when the app contract explicitly requires entitlement checks.

```bash
require_entitlement() {
  local bundle_path="$1"
  local entitlement_key="$2"
  local entitlements_dump

  entitlements_dump=$(codesign -d --entitlements - "$bundle_path" 2>&1 || true)
  case "$entitlements_dump" in
    *"$entitlement_key"*) ;;
    *) echo "Missing required entitlement: $entitlement_key" >&2; exit 1 ;;
  esac
}

# Example usage before install_bundle:
# require_entitlement "$app_bundle" "com.apple.security.device.audio-input"
```

### Example 3: Patterns to reject in generic output

| Reject | Why | Prefer |
|---|---|---|
| `./scripts/sign-macos-app.sh "$APP_BUNDLE"` | Repo-local dependency; fails on another machine | Preserve shipped release signature, or explicitly document non-portable mode |
| `git clone ... && npm install && npm run build` | Requires toolchain; not one-line portable install | Download prebuilt release artifact |
| `sudo ditto ... /Applications/...` as the only path | Triggers password prompt | Writable-target fallback |
| Multiple helper files beside `install.sh` | Breaks the promised single-command portability | One self-contained installer script |
| Hardcoded helper validation for one product | Not reusable across apps | Optional parameterized helper checks |

## Workflow

### Phase 1: Define the real portability target

Determine whether the request is for a portable macOS installer or for a local developer convenience script.

- If the app has no prebuilt release artifact, say the portable default path is not available yet.
- If the user demands zero prompts, choose a writable install destination strategy before writing the script.
- If the user wants silent trust for an app that will be rebuilt locally each install, explain that this conflicts with stable identity and permission continuity.

### Phase 2: Capture the app contract

Collect only the app-specific facts the script cannot guess:

- Bundle name
- Bundle identifier
- Release asset names or URL pattern per architecture
- Bundle path inside the extracted archive if it is not the archive root
- Whether the app is plain GUI or permission/helper sensitive
- Desired install destination policy: prefer `/Applications`, prefer `~/Applications`, or choose automatically

If any required contract field is missing, ask only for those missing values before generating code.

### Phase 3: Generate the installer

Write one standalone bash script.

- Keep the constant block compact and app-specific.
- Keep helper functions generic and reusable across apps, but inline them into the same `install.sh`.
- Preserve downloaded bundle identity; do not add signing logic unless the user explicitly requests a non-portable mode.
- Resolve install destination before copying.
- Clear quarantine on the installed bundle after copy.
- Replace the existing app safely, then relaunch.
- Accept zero positional arguments unless the task explicitly requires parameters.
- Prefer one complete end-to-end code example over many disconnected snippets when the user asks for example code.

### Phase 4: Review against portability failures

Before delivering, verify all of the following:

- No repo-relative path remains.
- No build toolchain dependency remains in the default path.
- No claim exceeds the chosen trust model.
- The script can run on a clean supported Mac with only built-in tools.
- The install target behavior matches the user's prompt/no-prompt requirement.

## Quality Checklist

```text
[ ] Description clearly triggers on macOS installer generation tasks
[ ] Script is self-contained and does not depend on repo-local files
[ ] Common/default path uses downloadable prebuilt app artifacts
[ ] Install target strategy matches the required prompt/no-prompt behavior
[ ] Bundle identity is validated before install
[ ] Existing app replacement and relaunch are handled
[ ] Release signature is preserved when present
[ ] Output defaults to one self-contained `install.sh`
[ ] Output does not promise impossible trust or permission guarantees
[ ] Brevity reduced wording, not portability guidance
```

---

## Reminder (END Anchor)

Portable installer means one standalone script, not a script plus hidden local setup.

Keep the default path release-first and self-contained; building from source is a separate non-portable mode.

Prefer writable install destinations when the request forbids extra user prompts.

Do not change a valid shipped app identity unless the user explicitly accepts the consequences.

Validate the bundle you downloaded before replacing anything already installed.

Promise only what the selected macOS trust model can actually deliver.
