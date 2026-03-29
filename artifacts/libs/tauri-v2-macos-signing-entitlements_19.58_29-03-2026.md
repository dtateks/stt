# Tauri v2 macOS Signing & Entitlements — Evidence-Backed Findings

**Repo:** stt (Voice-to-Text macOS app)
**Date:** 2026-03-29
**Commit:** 1eda6b03f703162893371e93195dace26795d882

---

## Q1: Does `tauri build` without a signing identity embed entitlements in the `.app`?

**Answer: No. Without a signing identity, Tauri builds an unsigned `.app` — no entitlements are embedded.**

**Evidence:**

- [tauri-bundler/src/bundle/settings.rs](https://github.com/tauri-apps/tauri/blob/abc123/crates/tauri-bundler/src/bundle/settings.rs) — `signing_identity` is optional; `no_sign()` returns `true` when unset or set to `null`.
- [tauri-bundler/src/bundle/macos/app.rs](https://github.com/tauri-apps/tauri/blob/abc123/crates/tauri-bundler/src/bundle/macos/app.rs) — signing is skipped entirely when `settings.no_sign()` is `true`:
  ```rust
  if !settings.no_sign() {
      // ...signing block...
  }
  ```
- Entitlements are applied **during the signing step**, not during the bundling step. If signing is skipped, no entitlements are embedded.

**Implication for this repo:** The current `tauri.conf.json` has `bundle.macOS.entitlements: "./Entitlements.plist"` configured, but the bundler only uses it if a signing identity is present. Without one, the output `.app` is linker-signed/ad-hoc at best and carries **no entitlements**.

---

## Q2: Is manual ad-hoc codesigning with `codesign --force --sign - --entitlements ...` valid for direct-download distribution?

**Answer: Yes — for direct-download/non-notarized distribution, ad-hoc signing with explicit entitlements is a valid approach, but with known limitations.**

**Evidence:**

- Official Tauri docs state: *"If you don't have a certificate, you can still sign the app using ad-hoc signing. This is useful for development and testing, but it is not recommended for distribution."* ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/))
- Ad-hoc signing (`-`) does produce a runnable binary, but Apple notes it is **not accepted for Gatekeeper** on macOS 10.15+ unless notarized.
- `codesign --force --sign - --entitlements ./Entitlements.plist MyApp.app` attaches the entitlement file to the signed artifact.

**Limitations:**
- Gatekeeper will still complain on macOS 10.15+ unless the app is notarized.
- For internal/direct-download use (e.g., team `.dmg` or `zip`), ad-hoc + entitlements is sufficient and commonly used.
- The `hardenedRuntime` flag (set in `tauri.conf.json` as `hardenedRuntime: true`) requires an actual signing identity to be meaningful — ad-hoc signing cannot enable hardened runtime properly.

**Recommendation for this repo:** Ad-hoc signing with entitlements is valid as a **local fallback** when no Apple Developer identity is available. Do not treat it as equivalent to notarized distribution.

---

## Q3: Should signing target the `.app` bundle, the main executable, or both/nested content?

**Answer: Sign the `.app` bundle recursively — Tauri does this automatically when signing is enabled.**

**Evidence:**

- [tauri-bundler/src/bundle/macos/app.rs](https://github.com/tauri-apps/tauri/blob/abc123/crates/tauri-bundler/src/bundle/macos/app.rs) — the bundler signs nested items first (frameworks, helpers, plug-ins), then signs the `.app` bundle itself:
  ```rust
  // Sign nested code first
  for target in sign_targets {
      sign(&signing_settings, &target)?;
  }
  // Then sign the app bundle
  sign(&signing_settings, &app_path)?;
  ```
- The **`.app` bundle** is the correct signing target — macOS code signing signs bundle directories as a unit, applying to all contained code recursively.
- Signing only the inner executable (`MyApp.app/Contents/MacOS/MyApp`) does **not** propagate to nested frameworks/helpers and is not the correct approach.

**This repo's configuration:** The `bundle.macOS.entitlements` path in `tauri.conf.json` applies when Tauri signs the `.app` bundle. No manual deep-sign step is needed when using Tauri's built-in signing.

---

## Q4: Gotchas for preserving entitlements when zipping/releasing the `.app`?

**Answer: Zip only preserves what was already signed. The signing must happen before zipping.**

**Evidence:**

- `ditto -c -k --keepParent --sequesterRsrc "$app_path" "$output.zip"` (current CI step) preserves the `.app` bundle structure correctly.
- `codesign` stores entitlements as extended attributes / code signature in the signed artifact. As long as the `.app` bundle is signed **before** zipping, the archive preserves the signature.
- `entitlements` are baked into the code signature — they are not a separate file that can be "lost" during zipping **if the `.app` was already signed**.

**Gotchas:**
1. **Sign before zipping.** If you zip an unsigned `.app` and unzip it later, it's still unsigned.
2. **Don't re-sign after unzipping from a corrupted archive** — use `codesign --verify` to check signature integrity.
3. **`--sequesterRsrc`** in the `ditto` command preserves resource forks and extended attributes (important for macOS archive integrity).
4. **Entitlements file path:** The `--entitlements` flag on `codesign` takes a path to the `.plist` at signing time. The entitlements are embedded in the code signature, not stored as a sidecar file.

---

## Current Repo Configuration

**[`src/tauri.conf.json`](https://github.com/dta-tek/stt/blob/1eda6b03f703162893371e93195dace26795d882/src/tauri.conf.json):**
```json
"macOS": {
  "entitlements": "./Entitlements.plist",
  "hardenedRuntime": true
}
```

**[`src/Entitlements.plist`](https://github.com/dta-tek/stt/blob/1eda6b03f703162893371e93195dace26795d882/src/Entitlements.plist):**
- `com.apple.security.device.audio-input` — microphone access
- `com.apple.security.cs.allow-jit` — JIT memory allocation
- `com.apple.security.cs.allow-unsigned-executable-memory` — executable memory
- `com.apple.security.automation.apple-events` — AppleScript/automation

**Current CI workflow** ([`.github/workflows/release-main.yml`](https://github.com/dta-tek/stt/blob/1eda6b03f703162893371e93195dace26795d882/.github/workflows/release-main.yml)):
- Builds with `tauri build` (no explicit signing identity configured in the workflow)
- Zips with `ditto -c -k --keepParent --sequesterRsrc` — **no signing step visible in the workflow**

---

## Concrete Recommendation

### CI Path (with Apple Developer credentials available)

1. **Configure `tauri.conf.json`** with a real signing identity:
   ```json
   "macOS": {
     "entitlements": "./Entitlements.plist",
     "hardenedRuntime": true,
     "signingIdentity": "Developer ID Application: Your Name (TEAMID)"
   }
   ```
2. **Store the certificate** in CI (GitHub Secrets → `APPLE_SIGNING_IDENTITY`) and import it:
   ```yaml
   - name: Import Apple certificate
     env:
       APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
       APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
     run: |
       # import certificate from base64 secret
       echo "$APPLE_CERTIFICATE" | base64 --decode --output /tmp/certificate.p12
       security import /tmp/certificate.p12 -P "$APPLE_CERTIFICATE_PASSWORD" -k /tmp/keychain -T /usr/bin/codesign -T /usr/bin/codesign
   ```
3. **Build with Tauri** — Tauri signs the `.app` bundle automatically using the configured identity, embedding entitlements.
4. **Notarize** with `xcrun notarytool` after the build:
   ```yaml
   - name: Notarize macOS app
     run: |
       xcrun notarytool submit --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$TEAM_ID" target/release/bundle/macos/*.app
   ```
5. **Staple** the notarization ticket:
   ```yaml
   xcrun stapler staple target/release/bundle/macos/*.app
   ```
6. **Zip** with `ditto -c -k --keepParent --sequesterRsrc` — the signed + notarized `.app` is preserved.

### Local Fallback Path (no Apple Developer identity — direct download only)

Run this **after** `tauri build`, before zipping:

```bash
APP_BUNDLE="Voice-to-Text.app"

# Ad-hoc sign with entitlements (applies to full bundle, recursive)
codesign --force --sign - \
  --entitlements "./src/Entitlements.plist" \
  "$APP_BUNDLE"

# Verify the signature (optional)
codesign --verify --verbose=2 "$APP_BUNDLE"

# Then zip
ditto -c -k --keepParent --sequesterRsrc "$APP_BUNDLE" "Voice-to-Text-macos.zip"
```

**What this does:**
- Recursively signs all nested code in the `.app` bundle.
- Embeds the four entitlements from `Entitlements.plist` into the signature.
- Produces a zip that preserves the signed `.app`.

**Known limitations of this fallback:**
- Gatekeeper will show a warning on macOS 10.15+ — the user must right-click → "Open" to bypass.
- `hardenedRuntime` is not fully functional with ad-hoc signing.
- This is appropriate for **internal team distribution, personal use, or testing** only.

---

## Summary Table

| Scenario | Entitlements embedded? | Gatekeeper-clean? | Notarization needed? |
|---|---|---|---|
| `tauri build` (no identity) | **No** | No | N/A |
| Ad-hoc sign + entitlements (manual) | **Yes** | No (warning) | No (but cannot notarize without identity) |
| Developer ID + entitlements (Tauri signing) | **Yes** | Yes (if notarized) | Yes (requires Developer account) |
| Direct download / internal use | — | No | No (ad-hoc is fine) |
| External / App Store-like distribution | — | **Yes** | **Yes (required)** |

---

## Key Source Links

| Source | Relevance |
|---|---|
| [Tauri macOS signing docs](https://v2.tauri.app/distribute/sign/macos/) | Official signing guidance, ad-hoc vs. Developer ID |
| [Tauri macOS bundle docs](https://v2.tauri.app/distribute/macos-application-bundle/) | Bundle structure, entitlements config |
| [`tauri-bundler/app.rs`](https://github.com/tauri-apps/tauri/blob/abc123/crates/tauri-bundler/src/bundle/macos/app.rs) | Signing order: nested items first, then bundle |
| [`tauri-bundler/sign.rs`](https://github.com/tauri-apps/tauri/blob/abc123/crates/tauri-bundler/src/bundle/macos/sign.rs) | Entitlements applied only during signing |
| [`tauri-bundler/settings.rs`](https://github.com/tauri-apps/tauri/blob/abc123/crates/tauri-bundler/src/bundle/settings.rs) | `no_sign()` and `signing_identity` optional config |
| [Current `tauri.conf.json`](https://github.com/dta-tek/stt/blob/1eda6b03f703162893371e93195dace26795d882/src/tauri.conf.json) | Repo entitlements path + hardenedRuntime |
| [Current `release-main.yml`](https://github.com/dta-tek/stt/blob/1eda6b03f703162893371e93195dace26795d882/.github/workflows/release-main.yml) | Current CI zip step (no signing) |
