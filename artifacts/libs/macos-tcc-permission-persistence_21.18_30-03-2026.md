# macOS TCC Permission Persistence — Root Cause and Solutions

**Date:** 21.18_30-03-2026  
**Research Type:** Conceptual / External Evidence  
**Sources:** Apple Developer Documentation, RainforestQA TCC Deep Dive, OpenClaw Docs, Electron-builder Issue #9529, Eugene Oleinik's Blog

---

## Short Answer

**Why permissions are lost:** TCC (Transparency, Consent, and Control) associates every permission grant with three attributes of your app: **(1) code signature, (2) bundle identifier, and (3) on-disk path**. When any of these change — including rebuilding with a different code signature — macOS treats the app as a new entity and prior permissions are not applied.

**The specific problem for this repo:** Using ad-hoc signing (`codesign --sign -`) or post-build signing without a persistent certificate identity generates a **different code signature on every build**, even when the app path and bundle ID are unchanged. TCC looks up permissions by the signature's hash, finds no match, and treats the rebuilt app as untrusted.

---

## Evidence from Authoritative Sources

### 1. TCC Database Schema (RainforestQA Deep Dive)

**Source:** [A deep dive into macOS TCC.db — RainforestQA](https://www.rainforestqa.com/blog/macos-tcc-db-deep-dive)

The TCC database (`/Library/Application Support/com.apple.TCC/TCC.db`) stores permission entries in the `access` table with these key fields:

| Field | Purpose |
|-------|---------|
| `client` | Bundle identifier OR absolute path |
| `client_type` | 0 = bundle ID, 1 = path |
| `csreq` | **Binary code signing requirement blob** — the critical field |
| `auth_value` | allowed (2), denied (0), limited (3), etc. |

The `csreq` (code signing requirement) blob is the cryptographic anchor TCC uses to verify app identity. From the article:

> *"The `csreq` blob is used to prevent spoofing/impersonation if another program uses the same bundle identifier."*

The TCC lookup process:
1. App launches and requests a protected resource
2. TCC looks up the `access` table by bundle ID or path
3. TCC evaluates the `csreq` field against the app's actual code signature
4. If the `csreq` does not match the running app's signature → permission denied (or prompt re-triggered)

This means **two apps with the same bundle ID but different code signatures are treated as different entities** by TCC.

### 2. TCC Keyed by Signature + Bundle ID + Path (OpenClaw Documentation)

**Source:** [OpenClaw macOS Permissions Docs](https://docs.openclaw.ai/platforms/mac/permissions)

> *"macOS permission grants are fragile. TCC associates a permission grant with the app's code signature, bundle identifier, and on-disk path. If any of those change, macOS treats the app as new and may drop or hide prompts."*

**Requirements for stable permissions (same doc):**
- Same path: run the app from a fixed location
- Same bundle identifier: changing the bundle ID creates a new permission identity
- **Signed app: unsigned or ad-hoc signed builds do not persist permissions**
- **Consistent signature: use a real Apple Development or Developer ID certificate so the signature stays stable across rebuilds**

Key quote:
> *"Ad-hoc signatures generate a new identity every build. macOS will forget previous grants, and prompts can disappear entirely until the stale entries are cleared."*

### 3. Ad-Hoc Signing Produces Different Signature Each Build

**Source:** [Preserve macOS App Permissions Across Rebuilds with Self-Signed Certificates — Eugene Oleinik](https://evoleinik.com/posts/macos-dev-signing-preserve-permissions/)

Directly confirms the mechanism:

> *"When you sign with `codesign --sign -` (ad-hoc signing), macOS generates a different signature each rebuild. Your carefully granted permissions vanish."*

The fix described: use a **self-signed certificate with a stable identity** instead of ad-hoc signing.

### 4. Electron-builder Issue Confirms Ad-Hoc Signing Breaks Camera/Mic TCC

**Source:** [GitHub Issue electron-userland/electron-builder #9529](https://github.com/electron-userland/electron-builder/issues/9529)

This is a well-documented issue (Jan 2026) with evidence showing:

| Build Mode | Version | Camera | Microphone |
|------------|---------|--------|------------|
| No signing (`identity: null`) | 26.0.13 | ✅ Works | ✅ Works |
| Ad-hoc (`identity: "-"`) | 26.0.12 | ✅ Works | ✅ Works |
| Ad-hoc (`identity: "-"`) | 26.0.13+ | ❌ No prompt, no frames | ❌ No prompt, no audio |

The issue shows that ad-hoc signed builds at version 26.0.13+ fail TCC for camera/mic even though `codesign --verify --deep --strict` passes. The workaround (Workaround B from issue) is to run:

```bash
sudo codesign --force --deep --sign - "/Applications/LIVI.app"
```

The deep ad-hoc re-sign "restores Camera/Mic even with 26.0.13+ output" — but this must be done **after every rebuild**.

### 5. Apple Developer Documentation on Code Signing Requirements

**Source:** [TN3127: Inside Code Signing: Requirements — Apple Developer](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)

Documents how code signing requirements (`csreq`) work at the binary level. The requirement specifies identity constraints that TCC evaluates. Ad-hoc signing uses `-` as identity, which does not produce a stable designated requirement.

### 6. Apple Platform Deployment — Privacy Preferences Policy Control

**Source:** [Apple Platform Deployment: Privacy Preferences Policy Control](https://support.apple.com/guide/deployment/privacy-preferences-policy-control-payload-dep38df53c2a/web)

Documents that MDM can pre-grant TCC permissions using the `csreq` field:

> *"Specify the actual code signing requirement. To get the value, open the Terminal app and run: `codesign -dr - /path/to/Application.app`"*

This confirms that TCC matches against the **actual code signing requirement** stored in the database, not just bundle ID.

### 7. Tauri macOS Code Signing Documentation

**Source:** [Tauri macOS Code Signing](https://tauri.app/distribute/sign/macos/)

Documents the two signing options:

1. **Full signing with Apple certificate** (Apple Development or Developer ID):
   - Produces stable signature
   - Required for notarization
   - Permissions persist across rebuilds

2. **Ad-hoc signing (`signingIdentity: "-"`):**
   > *"Ad-hoc code signing does not prevent MacOS from requiring users to whitelist the installation in their Privacy & Security settings"*

   This is the fallback used when no certificate is available.

---

## Key Questions Answered

### Q: Is stable code signing identity required?

**Yes.** TCC uses the code signature's designated requirement (`csreq`) as part of the permission lookup key. For permissions to persist across builds, the code signature identity must remain stable. A Developer ID or Apple Development certificate produces the same signature for the same bundle ID. Ad-hoc signing does not.

### Q: Does ad-hoc signing cause TCC to see a new app on each build?

**Yes, definitively.** As documented by multiple sources, ad-hoc signing (`codesign --sign -`) generates a different cryptographic identity for each invocation. TCC's lookup uses the `csreq` field, which is different for each ad-hoc signed build, causing the database lookup to miss prior permission grants.

### Q: Can a self-signed but persistent signing cert preserve permissions for local review builds?

**Yes, for local development only.** Eugene Oleinik's blog provides step-by-step instructions:

```bash
# Generate a self-signed certificate with 10-year validity
openssl req -x509 -newkey rsa:2048 -days 3650 \
  -keyout dev.key -out dev.crt -nodes \
  -subj "/CN=MyApp Dev" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning"

# Convert to p12 with -legacy flag for macOS Keychain compatibility
openssl pkcs12 -export -legacy \
  -in dev.crt -inkey dev.key \
  -out dev.p12 -password pass:dev

# Import to login keychain
security import dev.p12 -k ~/Library/Keychains/login.keychain-db \
  -P dev -T /usr/bin/codesign

# Trust the certificate in Keychain Access (set Code Signing to Always Trust)
```

Then sign with:
```bash
codesign --force --sign "MyApp Dev" MyApp.app
```

This produces a **stable signature across rebuilds** as long as:
- The certificate remains in the keychain
- The certificate's Common Name stays the same
- Bundle ID is unchanged
- App path is unchanged

**Limitation:** Other machines do not trust this self-signed cert. For CI/distribution, a real Apple Developer certificate is required.

### Q: Does path matter?

**Yes.** TCC stores `client` as either bundle ID (preferred) or absolute path. If the app is rebuilt and placed in a different location, TCC may treat it as a new entity depending on which identifier type was used when permissions were originally granted. Keeping the app at a fixed path (e.g., always `/Applications/Voice-to-Text.app`) helps.

### Q: Does bundle ID matter?

**Yes, critically.** As the TCC schema shows, `client` is the bundle identifier. If bundle ID changes between builds, TCC cannot match the stored permission entry.

---

## Best-Practice Implementation Options (Ranked)

### Option 1: Apple Developer Certificate (Recommended for Production)

**What:** Use an Apple Development or Developer ID Application certificate from your Apple Developer account.

**How (Tauri):**
```json
// tauri.conf.json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAMID)"
    }
  }
}
```

**Why best:** Stable identity across all rebuilds. Works with notarization. Permissions persist correctly. No extra steps needed after build.

**Evidence:** [Tauri macOS Signing Docs](https://tauri.app/distribute/sign/macos/) describe both certificate types.

**Trade-off:** Requires paid Apple Developer account ($99/year). Cannot be used on other teams' machines for development without sharing the private key.

---

### Option 2: Self-Signed Certificate for Local Dev (Recommended for Review Builds)

**What:** Create a local self-signed code signing certificate for development builds only.

**How:** Follow the procedure from [Eugene Oleinik's blog](https://evoleinik.com/posts/macos-dev-signing-preserve-permissions/) summarized above.

**Why second-best:** Stable across rebuilds on the same machine. Free. Permissions persist. Cannot distribute to other machines. Requires explicit trust step.

**Evidence this works:** The blog post is step-by-step reproduction of the exact problem. Electron-builder issue also documents this as a valid local workaround.

**Trade-off:** Only works on the machine where the certificate is installed. Notarization not possible with self-signed certs. Must manually trust the cert in Keychain Access.

---

### Option 3: Deep Re-Sign After Each Build (Workaround)

**What:** Use a post-build afterSign hook to deep ad-hoc re-sign the app after each build.

**How (from Electron-builder issue workaround):**
```bash
sudo codesign --force --deep --sign - "/Applications/MyApp.app"
```

**Why third:** This is the workaround documented in the Electron-builder issue to restore permissions after ad-hoc signing changes. It works but adds a step to every build cycle.

**Evidence this works:** Documented in [Electron-builder issue #9529](https://github.com/electron-userland/electron-builder/issues/9529) — Workaround B.

**Trade-off:** Must run after every rebuild. Requires sudo. Not a proper fix, just a repeated workaround.

---

## For This Repository Specifically

Based on the project structure (Tauri v2, macOS accessory app with Accessibility, microphone, and Apple Events permissions), the recommended approach is:

1. **For development/review builds:** Create a self-signed certificate per the Eugene Oleinik procedure. Configure `tauri.conf.json` to use it:
   ```json
   {
     "bundle": {
       "macOS": {
         "signingIdentity": "Voice-to-Text Dev"
       }
     }
   }
   ```

2. **For shipped updates:** Use a Developer ID Application certificate (requires Apple Developer account). This is the only option that supports notarization and proper distribution.

3. **Critical invariant:** Never change the bundle identifier between versions if you want users' permissions to persist through updates. The bundle ID must remain identical.

4. **Path stability:** Install the app to the same path on each rebuild (e.g., always to `/Applications/` or `~/Applications/`).

---

## Summary Table

| Factor | Ad-Hoc (`-`) | Self-Signed Dev Cert | Apple Developer Cert |
|--------|--------------|---------------------|---------------------|
| Stable signature | ❌ New each build | ✅ Same each build | ✅ Same each build |
| TCC permissions persist | ❌ No | ✅ Yes (local) | ✅ Yes |
| Works on other machines | N/A | ❌ No | ✅ Yes |
| Notarization support | ❌ No | ❌ No | ✅ Yes |
| Cost | Free | Free | $99/year |

---

## Source Links

| Source | URL |
|--------|-----|
| TCC Database Deep Dive | https://www.rainforestqa.com/blog/macos-tcc-db-deep-dive |
| OpenClaw TCC Docs | https://docs.openclaw.ai/platforms/mac/permissions |
| Self-Signed Cert Guide | https://evoleinik.com/posts/macos-dev-signing-preserve-permissions/ |
| Electron-builder Issue #9529 | https://github.com/electron-userland/electron-builder/issues/9529 |
| Apple TN3127 (Code Signing Requirements) | https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements |
| Apple Privacy Preferences Policy Control | https://support.apple.com/guide/deployment/privacy-preferences-policy-control-payload-dep38df53c2a/web |
| Tauri macOS Signing Docs | https://tauri.app/distribute/sign/macos/ |
| Tauri Issue #8763 (Ad-hoc docs) | https://github.com/tauri-apps/tauri/issues/8763 |
