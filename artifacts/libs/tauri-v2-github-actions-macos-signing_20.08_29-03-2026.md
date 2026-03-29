# Tauri v2 macOS Signing & Notarization on GitHub Actions

**Research date:** 2026-03-29  
**Sources:** Tauri v2 official docs, DEV Community tutorials (2026-02), electron-builder docs

---

## 1. Signing: Developer ID Certificate Import to Keychain

### Recommended Approach

Use a **Developer ID Application** certificate (for distribution outside App Store). The CI keychain import sequence is well-established:

**Evidence** — Official Tauri docs keychain import sequence ([macOS signing](https://v2.tauri.app/distribute/sign/macos/)):

```bash
# Decode the base64 secret
echo $APPLE_CERTIFICATE | base64 --decode > certificate.p12

# Create a fresh temporary keychain (avoids runner conflicts)
security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
security default-keychain -s build.keychain
security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
security set-keychain-settings -t 3600 -u build.keychain

# Import the certificate
security import certificate.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign

# CRITICAL: Set the partition list so codesign can access the key without GUI prompt
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain

# Verify
security find-identity -v -p codesigning build.keychain
```

**Critical secrets required:**

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` file (exported from Keychain Access) |
| `APPLE_CERTIFICATE_PASSWORD` | Password set during `.p12` export |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `KEYCHAIN_PASSWORD` | Randomly generated per-run; used to lock/unlock the temp keychain |

**Note from Tauri docs:** The `APPLE_SIGNING_IDENTITY` can be extracted dynamically rather than hardcoded as a secret. The Tauri docs example shows grepping for "Apple Development" in the identity output and writing `CERT_ID` to `$GITHUB_ENV` for use in `tauri-action`.

### Certificate Export Steps (from macOS machine)

1. Open **Keychain Access** → **My Certificates** (login keychain)
2. Find your `Developer ID Application:` certificate with its private key
3. Right-click the **private key** → **Export** → save as `.p12` with a strong password
4. Base64 encode: `base64 -i certificate.p12 -o certificate-base64.txt`
5. Store the contents of `certificate-base64.txt` as `APPLE_CERTIFICATE` secret

---

## 2. Notarization: notarytool — API Key vs Apple ID

### App Store Connect API Key (Recommended)

**Evidence** — Tauri official docs ([macOS signing > Notarization](https://v2.tauri.app/distribute/sign/macos/)):

> **Option A: App Store Connect API Key**
> 1. Open App Store Connect's Users and Access page → Integrations tab → Add → name + Developer access
> 2. Set `APPLE_API_ISSUER` to the Issuer ID shown above the keys table
> 3. Set `APPLE_API_KEY` to the Key ID column value
> 4. Download the `.p8` private key (only visible once; reload page after creation)
> 5. Set `APPLE_API_KEY_PATH` to the downloaded key file path

| Env Variable | Source |
|-------------|--------|
| `APPLE_API_ISSUER` | App Store Connect → Users and Access → Integrations tab |
| `APPLE_API_KEY` | Key ID from the keys table |
| `APPLE_API_KEY_PATH` | Path to downloaded `.p8` file (uploaded as secret or path in repo) |

### Apple ID + App-Specific Password (Legacy)

**Evidence** — Tauri official docs and DEV Community tutorial ([Part 1](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n)):

> 1. Create an app-specific password at [appleid.apple.com](https://appleid.apple.com) → Security → App-Specific Passwords
> 2. Find your Team ID at developer.apple.com → Membership

| Env Variable | Value |
|-------------|-------|
| `APPLE_ID` | Apple account email |
| `APPLE_PASSWORD` | App-specific password (NOT your Apple ID password) |
| `APPLE_TEAM_ID` | 10-character Team ID |

### Which to Use?

| Criteria | API Key | Apple ID |
|----------|---------|----------|
| Security | Better (no account password stored) | Worse (app-specific password still sensitive) |
| Team management | Key can have limited permissions | Tied to individual Apple ID |
| 2FA requirement | Yes (for App Store Connect) | Yes (for Apple ID) |
| Required for notarization | Yes | Yes |
| Tauri/tauri-action support | Native env vars | Native env vars |

**Conclusion:** App Store Connect API key is strictly better for CI: scoped permissions, no shared credential, easier to rotate. Both work with Tauri v2.

---

## 3. Ad-Hoc Signing: Acceptable for Public GitHub Release Distribution?

### Short Answer: **No — for public GitHub Releases, ad-hoc signing is not acceptable.**

**Evidence** — Tauri official docs ([Ad-Hoc Signing section](https://v2.tauri.app/distribute/sign/macos/)):

> "Ad-hoc code signing does not prevent macOS from requiring users to whitelist the installation in their Privacy & Security settings."

And from electron-builder docs (same pattern for all macOS code signing):

> "Ad-hoc signed apps cannot be notarized or distributed to other users. This is only suitable for local development and testing."

### The Problem with Ad-Hoc for Releases

1. **No notarization possible** — Apple will not notarize ad-hoc signed apps
2. **Every user sees the "damaged app" warning** — macOS Gatekeeper blocks ad-hoc signed internet-downloaded apps until the user explicitly approves in System Settings → Privacy & Security
3. **User experience is terrible for public releases** — users must click "Open Anyway" and navigate to System Settings, defeating the purpose of a polished release

### When Ad-Hoc IS Appropriate

- Local development builds on your own machine
- Internal-only distribution where recipients have physical or screen-sharing access to approve the app
- Builds that will never be distributed beyond the signing machine

### Correct Approach for GitHub Releases

**Developer ID Application** certificate + **notarization** is the minimum for public distribution. This is confirmed by:

- Tauri official docs: "Notarization is required when using a *Developer ID Application* certificate."
- Multiple DEV Community walkthroughs ([Massi's Stik writeup](https://dev.to/0xmassi/shipping-a-production-macos-app-with-tauri-20-code-signing-notarization-and-homebrew-mc3), [Thomas Cosialls' guide](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n))

---

## 4. Tauri-Specific Guidance for CI Release Signing/Notarization

### Use `tauri-apps/tauri-action@v0`

**Evidence** — Tauri official GitHub pipeline docs ([GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)):

`tauri-action` handles the entire build-sign-notarize-upload pipeline automatically when given the right environment variables. This is the standard approach used in all recent Tauri v2 release guides.

### Entitlements File Is Required

Tauri apps use a WebView requiring JIT. Without these entitlements, notarization may pass but the app will crash at runtime.

**Evidence** — From [Massi's writeup](https://dev.to/0xmassi/shipping-a-production-macos-app-with-tauri-20-code-signing-notarization-and-homebrew-mc3):

```xml
<!-- src-tauri/Entitlements.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
</dict>
</plist>
```

Reference in `tauri.conf.json`:
```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAMID)",
      "entitlements": "./Entitlements.plist"
    }
  }
}
```

### Trigger on Tag Push

**Evidence** — From [tauri-action examples](https://github.com/tauri-apps/tauri-action) and Tauri docs:

```yaml
on:
  push:
    tags:
      - "v*"
```

The `__VERSION__` placeholder in `tagName: v__VERSION__` is resolved from `tauri.conf.json`'s `version` field. Tag-based triggers keep version numbers in sync automatically.

### Dual-Architecture Builds for macOS

```yaml
matrix:
  include:
    - args: '--target aarch64-apple-darwin'   # Apple Silicon
    - args: '--target x86_64-apple-darwin'    # Intel
```

Both are built because:
- Universal binaries double download size unnecessarily
- GitHub Releases can host both DMGs
- Users download the correct architecture automatically

### Workflow Permissions

```yaml
permissions:
  contents: write
```

Required for `tauri-action` to upload artifacts to GitHub Releases.

### `tauri-action` Handles All of These Automatically

When environment variables are provided:
1. Certificate import to temp keychain
2. `codesign --deep --force --verify --options runtime` on the `.app` bundle
3. `xcrun notarytool submit` with polling and `--wait`
4. `xcrun stapler staple` on the `.dmg`
5. Draft GitHub Release creation and artifact upload

---

## 5. Recommended Workflow Shape

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: true

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: "--target aarch64-apple-darwin"
          - platform: macos-latest
            args: "--target x86_64-apple-darwin"
          - platform: windows-latest
            args: "--target x86_64-pc-windows-msvc"

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install frontend dependencies
        run: npm ci

      # === macOS ONLY: Certificate import ===
      - name: Import Apple signing certificate
        if: runner.os == 'macOS'
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          CERT_PATH=$RUNNER_TEMP/certificate.p12
          KEYCHAIN_PATH=$RUNNER_TEMP/build.keychain-db
          KEYCHAIN_PASSWORD=$(openssl rand -base64 24)

          echo "$APPLE_CERTIFICATE" | base64 --decode > "$CERT_PATH"
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security default-keychain -s "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security import "$CERT_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security list-keychains -d user -s "$KEYCHAIN_PATH"

      # === All platforms: Build + Sign + Notarize + Upload ===
      - name: Build and release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

          # macOS signing + notarization (API key approach)
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_PATH: ${{ secrets.APPLE_API_KEY_PATH }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}

          # Tauri updater signing
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}

          # Windows signing (Azure Key Vault via relic — separate concern)
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}

        with:
          tagName: v__VERSION__
          releaseName: "App v__VERSION__"
          releaseBody: "See CHANGELOG for details."
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

### Minimum Required Secrets (macOS-only summary)

| Secret | Notes |
|--------|-------|
| `APPLE_CERTIFICATE` | Base64 `.p12` from Keychain Export |
| `APPLE_CERTIFICATE_PASSWORD` | Export password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_API_KEY` | App Store Connect Key ID (for notarization) |
| `APPLE_API_KEY_PATH` | Path to `.p8` private key file |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |
| `KEYCHAIN_PASSWORD` | Random per-run; stored as secret for unlock step |
| `TAURI_SIGNING_PRIVATE_KEY` | For updater plugin signatures |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password if set |

---

## Summary

| Question | Answer |
|----------|--------|
| **Certificate type for GitHub Releases?** | Developer ID Application (not Apple Distribution) |
| **Certificate import method?** | Base64 `.p12` → temp keychain with partition list |
| **Notarization approach?** | App Store Connect API key (`APPLE_API_KEY` + `APPLE_API_KEY_PATH` + `APPLE_API_ISSUER`) preferred over Apple ID password |
| **Ad-hoc signing acceptable for public releases?** | **No** — users get "damaged app" warning; Developer ID + notarization is required |
| **Key Tauri-specific requirement?** | Entitlements plist with `allow-jit` and `allow-unsigned-executable-memory`; `tauri-action` handles full pipeline |
| **Trigger approach?** | Tag push (`v*`) with `__VERSION__` placeholder resolved from `tauri.conf.json` |
| **Architecture strategy?** | Separate `aarch64-apple-darwin` and `x86_64-apple-darwin` builds (not universal), hosted on same release |
| **Updater signing?** | Separate `tauri signer generate` keypair; private key as GitHub secret; `createUpdaterArtifacts: true` in `tauri.conf.json` |

## Sources

- [Tauri v2 macOS Signing Docs](https://v2.tauri.app/distribute/sign/macos/) — Official source of truth
- [Tauri v2 GitHub Pipeline Docs](https://v2.tauri.app/distribute/pipelines/github/) — CI configuration
- [Ship Your Tauri v2 App Like a Pro: Part 1 (Code Signing)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n) — Feb 2026
- [Ship Your Tauri v2 App Like a Pro: Part 2 (GitHub Actions)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-github-actions-and-release-automation-part-22-2ef7) — Feb 2026
- [Shipping a Production macOS App with Tauri 2.0 (Stik case study)](https://dev.to/0xmassi/shipping-a-production-macos-app-with-tauri-20-code-signing-notarization-and-homebrew-mc3) — Feb 2026
- [electron-builder macOS Code Signing Docs](https://www.mintlify.com/electron-userland/electron-builder/guides/code-signing/macos) — Industry reference (same principles apply)
