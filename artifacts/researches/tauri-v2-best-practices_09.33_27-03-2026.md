# Findings: Tauri v2 Production Best Practices (2026)

**Research Date:** 27-03-2026
**Scope:** Production-grade Tauri v2 desktop/mobile app development — security, maintainability, packaging, IPC patterns
**Primary Lens:** Guidance for an internal reusable skill enabling agents to consistently choose safe/correct Tauri v2 patterns

---

## Executive Summary

Tauri v2 is production-ready with a mature security model centered on its capability/permission system, but the ecosystem has significant sharp edges. The three biggest risk areas are: (1) the ACL/capability system's learning curve causing devs to accidentally ship over-privileged apps, (2) Linux being substantially less stable than Windows/macOS due to WebKitGTK issues, and (3) mobile being officially released but rough in practice — especially debugging and custom plugin authoring. The updater plugin requires code signing and is non-negotiable for production. The isolation pattern is recommended for apps with untrusted content but adds measurable overhead. Key footgun: `tauri dev` often works where `tauri build` silently fails due to capability configuration differences.

---

## 1. Production Golden Path Defaults

### 1.1 Configuration

**Use explicit capability files over inline config.**
- Put capability definitions in individual files under `src-tauri/capabilities/` (supports JSON and TOML), reference them by identifier in `tauri.conf.json`.
- Do NOT inline all permissions in `tauri.conf.json` — it bloats the file and makes audit hard.
- The `capabilities` directory files are auto-discovered, but once you explicitly list capabilities in `tauri.conf.json`, only those are active — the auto-discovery behavior changes.
- Use the generated JSON schema (`../gen/schemas/desktop-schema.json` or `mobile-schema.json`) as `$schema` in capability files for IDE autocompletion.
- Set `identifier`, `description`, `windows` array, and `permissions` array in each capability file.

**tauri.conf.json structural defaults to preserve:**
```json
{
  "app": {
    "security": {
      "capabilities": ["main-capability"]  // explicit list
    }
  },
  "bundle": {
    "createUpdaterArtifacts": true  // required for updater
  }
}
```

**Dev vs. Build divergence is a known hazard.** A capability that works in `tauri dev` may silently fail in `tauri build` because the default capability file excluded plugins you forgot to explicitly allow. Always test after `tauri build`.

---

### 1.2 Capabilities and Permissions

**Capability is the grant; permission is the atomic privilege.**
- Capabilities assign permissions to windows/webviews.
- Permissions can be: command-level (`fs:allow-read-file`), scope-level (`fs:scope-home`), or sets that combine both.
- Plugin permissions follow the naming convention `<plugin-name>:<permission-name>` — the `tauri-plugin-` prefix is auto-prepended.

**Golden-path capability for a desktop app with fs, http, and shell:**
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main window with minimal required permissions",
  "windows": ["main"],
  "permissions": [
    "core:path:default",
    "core:event:default", 
    "core:window:default",
    "core:app:default",
    "fs:default",
    "http:default",
    "shell:allow-open"
  ]
}
```

**Least-privilege rules:**
- Never grant `*` wildcard permissions in production.
- Split capabilities by window: main window gets minimal perms, settings window gets more.
- Use platform-specific capabilities via the `platforms` field (`["linux", "macOS", "windows"]` or `["iOS", "android"]`).
- Use scope restrictions to limit filesystem access to `$APP/*` or specific directories, not `$HOME/*` broadly.
- Remote API access (`"remote": { "urls": [...] }`) is disabled by default and must be explicitly enabled — keep it off unless reviewed.

**Scope example restricting to $HOME/test.txt only:**
```json
{
  "identifier": "fs-write-restricted",
  "permissions": [
    {
      "identifier": "fs:allow-write-text-file",
      "allow": [{ "path": "$HOME/test.txt" }]
    }
  ]
}
```

**Commands registered via `invoke_handler` are allowed from all windows by default.** To restrict: use `AppManifest::commands` in `build.rs` to explicit allowlist.

---

### 1.3 IPC: Command vs. Event vs. Channel

**Use commands (`invoke()`) when you need a response.**
- Commands are type-safe, support async, can return data, and serialize via serde.
- All arguments must implement `serde::Deserialize`; custom structs need `#[derive(Deserialize)]`.
- Error handling: return `Result<T, YourError>` and use `thiserror` for ergonomic error enums.
- Async commands are preferred for heavy work to avoid blocking the main thread.
- Borrowed types (`&str`, `State<'_, T>`) in async command signatures cause compile issues — clone to owned types or wrap return in `Result`.

**Use events for one-way fire-and-forget from Rust to frontend.**
- `emit()` sends to all listeners globally; `emitTo()` targets a specific webview window.
- Events are not type-safe (JSON payloads only), always async, and cannot return values.
- Frontend listens via `listen()` which returns an `unlisten` function — always call it on component unmount to prevent leaks in SPAs.

**Use channels for streaming data from Rust to frontend.**
- Channels use `tauri::ipc::Channel<T>` to stream chunks (e.g., file reads, HTTP response bodies).
- Channels are the correct approach for large data transfers rather than returning large payloads through commands (which serialize to JSON).
- Example: 4096-byte chunk streaming for image loading with progress reporting.

**Decision summary:**
| Need | IPC primitive |
|------|-------------|
| Request + response with data | `invoke()` command |
| Notification, no response needed | Event (`emit`) |
| Streaming / large data / progress | Channel |
| Bidirectional streaming | Not natively supported — use channel + event combo |

---

### 1.4 Plugin Usage

**Official plugins (from `tauri-apps/plugins-workspace`):** fs, http, shell, dialog, clipboard, notification, sql, store, updater, autostart, process, window-state, deep-linking, biometric, barcode-scanner, geolocation, haptics, nfc, global-shortcut, os-info, positioner, single-instance, localhost, persisted-scope, websocket, upload, Stronghold.

**Plugin security rule: every plugin command must have an associated permission in a capability.**
- Each official plugin has autogenerated permissions in `plugins/<name>/permissions/autogenerated/`.
- Default plugin permissions are intentionally restrictive — do not expand beyond what the app needs.
- Plugin permission identifiers follow `<name>:<command>` or `<name>:<set-name>` pattern (e.g., `fs:allow-read-file`, `fs:default`).
- Mobile plugins require Kotlin (Android) or Swift (iOS) code in addition to the Rust side.

**Adding a plugin (official):**
```bash
cargo tauri add fs    # auto-adds to Cargo.toml and initializes in lib.rs
# OR manually:
cargo add tauri-plugin-fs
```

Then add permission to capability:
```json
"permissions": ["fs:default", "fs:allow-write-text-file"]
```

**Custom plugins:** Author in `src-tauri/src/` or as separate crate. Custom plugin commands need custom permission definitions in `src-tauri/permissions/`.

---

### 1.5 Content Security Policy (CSP)

**CSP must be explicitly configured — there is no default.**
- Configured in `tauri.conf.json` under `security.csp`.
- Local scripts are hashed at compile time; external scripts require cryptographic nonce.
- `unsafe-inline` and `unsafe-eval` should be avoided in production.
- When using Rust-to-frontends (Leptos, Yew) or WebAssembly, add `'wasm-unsafe-eval'` to `script-src`.

**Example CSP from the official API example:**
```json
"csp": {
  "default-src": "'self' customprotocol: asset:",
  "connect-src": "ipc: http://ipc.localhost",
  "font-src": ["https://fonts.gstatic.com"],
  "img-src": "'self' asset: http://asset.localhost blob: data:",
  "style-src": "'unsafe-inline' 'self' https://fonts.googleapis.com"
}
```

**Golden path:** Start with `'self'` everywhere and add exceptions minimally. Avoid loading remote scripts. Prefer bundled assets.

---

### 1.6 Updater

**The updater requires code signing — this cannot be disabled.**
- `createUpdaterArtifacts: true` must be set in `bundle` config.
- Generate keys: `cargo tauri signer generate -- -w ~/.tauri/myapp.key`
- Public key goes in `tauri.conf.json`; private key NEVER leaves your CI system.
- Signature format: raw content of `.sig` file (not a path), placed in `latest.json` or server response.
- Windows install modes: `"passive"` (default, small progress bar), `"basicUi"` (requires interaction), `"quiet"` (no UI, no admin elevation).

**Update server options:**
- Static JSON (GitHub Releases): simpler, no backend needed.
- Dynamic server: returns 204 if no update, 200 + JSON body if update available.
- Endpoints support `{{current_version}}`, `{{target}}`, `{{arch}}` variables.

**latest.json minimal structure:**
```json
{
  "version": "1.2.3",
  "platforms": {
    "linux-x86_64": { "signature": "<raw-sig-content>", "url": "https://..." },
    "windows-x86_64": { "signature": "<raw-sig-content>", "url": "https://..." },
    "darwin-x86_64": { "signature": "<raw-sig-content>", "url": "https://..." }
  }
}
```

**Cannot test updater from `tauri dev`** — only from installed app.

---

### 1.7 Packaging and Distribution

**Desktop targets:**
| Platform | Formats |
|----------|---------|
| Windows | NSIS installer (`.exe`), MSI |
| macOS | `.app` bundle, `.dmg`, `.tar.gz` (for updater) |
| Linux | AppImage, `.deb`, `.rpm`, `.AppImage.tar.gz` (for updater) |

**iOS:** Requires Apple Developer Program ($99/year). Must configure automatic signing via Xcode or manual via env vars (`IOS_CERTIFICATE`, `IOS_CERTIFICATE_PASSWORD`, `IOS_MOBILE_PROVISION`). Notarization is mandatory for distribution outside App Store.

**Android:** Google Play requires signing. Bundle (AAB) recommended over APK. 16KB memory pages required for new Play Store submissions — use NDK ≥28 or add `link-arg=-Wl,-z,max-page-size=16384` to `.cargo/config.toml` for older NDK.

**CI/CD:** GitHub Actions is the officially documented CI platform. `tauri-action` generates `latest.json` from GitHub Releases automatically. Use build matrices for multi-platform parallel builds.

---

### 1.8 Dev Workflow

**`tauri dev`:** Runs in development mode with hot reloading. Frontend bundler handles frontend changes; Rust recompiles on `src-tauri/` changes.

**`tauri build`:** Production build. Creates distributable bundles. Tests the actual bundled config, not the dev config.

**Critical workflow note:** Test the built app (`target/release/...`) before shipping. `tauri dev` and `tauri build` can behave differently regarding capabilities, plugin initialization, and CSP.

**Development tooling:**
- `@tauri-apps/cli` + `@tauri-apps/api` for frontend.
- VS Code extension: `tauri.devtools` for debugging.
- CrabNebula DevTools for cross-platform inspection.

---

## 2. Footguns and Anti-Patterns

### 2.1 Security Footguns

**Overly broad capabilities:**
- Using `"windows": ["*"]` grants permissions to all windows including child webviews — a compromised child webview gets all parent permissions.
- Using `$HOME/*` scope without tight restrictions exposes user home directory.
- Relying on `fs:default` which grants read access to `$APP` folder — if the app processes untrusted content, this expands attack surface.

**Remote API access left enabled:**
- `"remote": { "urls": ["*"] }` or broad URL patterns allow any webpage to invoke your Tauri commands.
- This is the most dangerous configuration mistake — only enable with explicit URL allowlisting and only for specific commands.

**Skipping the isolation pattern:**
- Tauri recommends the isolation pattern for apps with many frontend dependencies or that process less-trusted content.
- Without it, all frontend IPC messages go directly to Rust core without an validation intercept layer.
- The overhead is small (~AES-GCM encryption per message) and the security benefit is significant.

**Not validating IPC inputs:**
- Even with capabilities, a compromised frontend can send unexpected argument values.
- Commands should validate file paths are within expected directories, URLs have expected origins, etc.

**Supply chain risk in frontend dependencies:**
- The isolation pattern docs explicitly call out development threats: build-time tools with hundreds of nested npm dependencies.
- Use `npm audit`, lockfiles, and consider dependency minimization as a security practice.

### 2.2 Permission/Capability Footguns

**Silent failure on no capability match:**
- If a window's label doesn't match any capability's `windows` array, that window gets ZERO IPC access with no runtime error.
- Windows are matched by **label** (not title) — label mismatch is a common bug.

**Multiple `manage()` calls silently drop:**
- Calling `app.manage::<T>()` twice with the same type `T` only uses the first registration; subsequent ones are silently ignored.
- Use `AppHandle::manage()` in `setup()` or plugin initialization, not both.

**Capability config file proliferation:**
- Permissions can live in: `src-tauri/capabilities/*.json`, `src-tauri/permissions/*.toml`, and inline in `tauri.conf.json`.
- It is easy to lose track of which file controls which permissions.

**Auto-discovery confusion:**
- All files in `capabilities/` directory are auto-enabled.
- But once you add explicit `capabilities` array to `tauri.conf.json`, only those listed are used.
- This transition is silent and breaks many新手 projects.

### 2.3 IPC Footguns

**Reserved argument names (v1 carry-over):**
- In v1, arguments named `cmd`, `callback`, `error`, `options`, or `payload` caused IPC payload flattening issues.
- Patched in v2 stable, but old tutorials still show these patterns.
- Always name arguments descriptively in camelCase or snake_case.

**Borrowed types in async commands:**
- `&str` and `State<'_, T>` in async command signatures cause compile errors due to lifetime issues with the async runtime.
- Workaround: clone to owned types (`String`) or use `Result<T, ()>` return type.

**Returning large data through commands:**
- Commands serialize return values to JSON — large file contents or binary data should use `tauri::ipc::Response` directly or channels.
- Serializing large objects slows the app and can cause memory pressure.

**Forgetting to unlisten events in SPAs:**
- `listen()` registers a persistent listener; in SPA routers, navigating between routes without calling the returned `unlisten()` function causes listener leaks and duplicate handlers.

### 2.4 Mobile Footguns

**Android IPC blocking (~10% of cases):**
- Invoking Android intents (camera, NFC, etc.) can block the IPC channel until the next IPC message arrives.
- Active bug as of early 2026, no known workaround — design around it by not depending on immediate IPC response after intent launch.

**iOS first-run network permission hang:**
- `tauri ios dev` prompts for local network access on first run.
- Missing or dismissing this prompt causes a silent hang that looks like a build failure.
- Fix: rerun and explicitly allow the prompt.

**Custom mobile plugin complexity:**
- Writing a custom mobile plugin requires bridging Rust ↔ Swift/Kotlin via JNI (Android) or FFI (iOS).
- Tooling and documentation for this is sparse — prefer official plugins over custom mobile code.
- Android commands run on main thread — long-running operations cause ANR (Application Not Responding); use `CoroutineScope(Dispatchers.IO)` for blocking work.

**iOS debugging opacity:**
- iOS crashes produce stack traces that may not clearly indicate whether the problem is TypeScript, Rust, Swift, Tauri permissions, or WebView.
- Plan for longer debugging cycles on iOS compared to desktop.

### 2.5 Linux Footguns

**webkit2gtk-4.1 hard requirement:**
- Tauri v2 requires `webkit2gtk-4.1`, which is NOT available on RHEL 9, CentOS 9, or older LTS distros.
- This effectively blocks enterprise Linux deployment in environments with fixed OS versions.

**NVIDIA GPU crashes:**
- A bug in `webkit2gtk` causes rendering crashes or hangs on systems with NVIDIA GPUs.
- Workaround: disable GPU acceleration, which hurts performance significantly.
- This is an upstream WebKitGTK issue, not Tauri-specific.

**Wayland visual corruption:**
- Repeatedly maximizing/unmaximizing windows causes visual corruption.
- Labeled as upstream WebKitGTK issue.

**`tauri dev` Vite restart loop:**
- On Linux only, Vite may detect changes in `src-tauri/` and trigger infinite Rust recompilation.
- `tauri dev` becomes unusable; workaround is to be careful about file change detection or use separate build workflows.

**Performance gap vs. Chromium:**
- WebKitGTK delivers 50%+ worse FPS on DOM-heavy UIs compared to Chromium (used by Electron).
- Not a blocker but a consideration for UI-intensive applications.

### 2.6 Updater Footguns

**Unsigned builds silently skip updates:**
- If `createUpdaterArtifacts` is not set, no `.sig` files are generated and the updater silently does nothing.
- There is no runtime error or warning.

**Wrong signature format:**
- The `signature` field in `latest.json` must be the raw Base64 content of the `.sig` file — not a path, not a URL.
- Tauri validates the entire JSON before checking version, so incomplete platform entries cause silent failure.

**Cannot test updater in dev:**
- The updater only works from an installed application, not `tauri dev`.
- Build and install the app to test update flow.

### 2.7 Build Footguns

**Windows crate feature bloat:**
- Specifying only `Win32_Foundation` in `Cargo.toml` still transitively activates dozens of unrelated Win32 features (`Win32_Devices`, `Win32_Graphics`, etc.).
- This dramatically increases build times — no known workaround.

**Build hangs during windows crate phase:**
- Compilation can appear to freeze with no progress indicator during the `windows` crate compilation.
- No workaround other than patience.

**`create-tauri-app` stale templates:**
- Shortly after v2 stable launch, the scaffolding tool shipped with outdated templates.
- Always verify generated project builds before relying on template defaults.

---

## 3. Optional/Advanced Patterns (NOT Defaults)

The following patterns are powerful but should NOT be presented as defaults in a skill — they are for advanced use cases:

### 3.1 Isolation Pattern
- Intercepts all IPC messages in a sandboxed iframe, encrypts with AES-GCM using runtime-generated keys.
- Adds encryption overhead; most apps don't need it.
- **Default position:** Don't use it unless you process untrusted content or have many frontend dependencies.
- **Advanced use:** Use it to validate file paths, HTTP headers, and other inputs before they reach Rust.

### 3.2 Remote API Access
- Allows external URLs to invoke specific Tauri commands.
- Disabled by default and that default should be preserved.
- **Advanced use:** For web-like apps that serve content from a CDN but need Tauri native features.
- **Risk level:** HIGH — enables remote code execution if misconfigured.

### 3.3 Custom Scopes Beyond $APP
- The `$HOME/*` and `$APP/*` scopes are already provided by plugins.
- Defining custom scopes is only needed for very specific directory restrictions.
- **Default position:** Use provided scopes; define custom only when needed.

### 3.4 Multiple Windows with Different Capabilities
- Powerful for complex apps (main window, settings, auxiliary panels with different privilege levels).
- **Default position:** Single capability for single-window apps; complexity only when needed.

### 3.5 Custom Mobile Plugins (Kotlin/Swift)
- Requires JNI/FFI bridging knowledge.
- **Default position:** Use official plugins; build custom only when no official plugin exists and the functionality is critical.

### 3.6 Dynamic Update Server
- Provides server-side control over update logic, channels, rollbacks.
- Static JSON via GitHub Releases is simpler and sufficient for most apps.
- **Default position:** Use static JSON; dynamic server only for complex rollout strategies.

### 3.7 Sidecar Binaries (Node.js or other)
- Embedding external executables (e.g., Node.js runtime) as sidecars.
- Increases bundle size and complexity.
- **Default position:** Don't use unless the app requires a runtime that can't be compiled to Rust or WASM.

---

## 4. Unstable / Private-API / Version-Sensitive Areas

### 4.1 Capabilities Behave Differently in Dev vs. Release
- **Status:** Open issue as of October 2025 per GitHub discussions.
- **Risk:** A working dev build may fail silently in release due to capability resolution differences.
- **Mitigation:** Always test `tauri build` output before shipping.

### 4.2 Linux WebKitGTK Instability
- **Status:** Active upstream issues, not fully resolved.
- **Affected:** NVIDIA GPU compatibility, Wayland rendering corruption, `webkit2gtk-4.1` availability on enterprise distros.
- **Mitigation:** Test extensively on target Linux distribution; consider targeting only newer LTS versions.

### 4.3 Android IPC Blocking Bug
- **Status:** Active as of February 2026.
- **Frequency:** Approximately 10% of Android intent invocations.
- **Effect:** IPC channel blocks until next message.
- **Mitigation:** Design around it; avoid depending on immediate post-intent IPC response.

### 4.4 Module Path Changes Between v1 and v2
- `tauri::command` items moved to `tauri::ipc` in v2.
- The ACL system replaced the flat allowlist.
- AI tools frequently hallucinate v1 syntax when working with v2 codebases.

### 4.5 iOS Debugging Opacity
- **Status:** Known pain point in mobile plugin development.
- **Risk:** Long diagnostic cycles for crashes that could be in TypeScript, Rust, Swift, permissions, or WebView.
- **Mitigation:** Add instrumentation at each layer; test mobile changes incrementally.

### 4.6 Android 16KB Memory Pages
- **Status:** Google requirement for new Play Store submissions as of 2024/2025.
- **Requirement:** NDK version ≥28 OR manual linker flag `-Wl,-z,max-page-size=16384`.
- **Risk:** Old NDK versions generate non-compliant bundles.
- **Mitigation:** Use NDK 28+ or add the linker flag to `.cargo/config.toml`.

### 4.7 Documentation Lag
- Official docs have historically been updated after features ship.
- Particularly acute for new major versions and new plugins.
- **Mitigation:** Check the actual source code / crates.io / GitHub for the most accurate API definitions.

---

## 5. Decision Trees

### 5.1 Command vs. Event vs. Channel

```
Does the frontend need a response or return data?
├── YES → Does it involve streaming or large payloads (file reads, HTTP bodies)?
│   ├── YES → Use Channel (tauri::ipc::Channel<T>)
│   └── NO → Use Command (#[tauri::command], invoke())
└── NO → Is it a one-way notification from Rust to frontend?
    ├── YES → Use Event (emit / emitTo)
    └── NO → Consider: Is it bidirectional streaming?
        └── YES → Use Channel + Event combo
```

### 5.2 Plugin vs. Custom Rust Command

```
Does an official Tauri plugin provide the functionality?
├── YES → Use the official plugin
│   ├── Does it need permissions configured?
│   │   ├── YES → Add to capability with minimal scope
│   │   └── NO → Use default permission set
│   └── Is mobile support needed?
│       ├── YES → Verify plugin supports mobile (not all do)
│       └── NO → Desktop-only plugin is fine
└── NO → Does functionality require OS-native APIs?
    ├── YES → Is it mobile-specific (camera, NFC, biometric)?
    │   ├── YES → Consider custom mobile plugin (complexity: HIGH)
    │   └── NO → Custom Rust command + capability
    └── NO → Could this be a web API or local process?
        ├── YES → Consider sidecar binary or http plugin
        └── NO → Custom Rust command in src-tauri/src/
```

### 5.3 Desktop-Only vs. Cross-Platform (Mobile)

```
Is mobile a target?
├── NO (desktop-only) →
│   ├── Use full Tauri capability system
│   ├── Linux is supported but test on target distros
│   └── Consider isolation pattern if frontend has many dependencies
└── YES (cross-platform) →
    ├── Can you use only plugins that support mobile?
    │   ├── YES → Proceed with cross-platform strategy
    │   └── NO → Implement desktop-only features via feature flags
    │           and conditional compilation
    ├── Mobile has different permission models (Android: runtime grants, iOS: Info.plist)
    ├── Test on actual mobile devices — emulator ≠ real behavior
    ├── Android: Verify 16KB page compliance (NDK ≥28 or linker flag)
    └── iOS: Plan for longer debugging cycles and Xcode dependency
```

### 5.4 CSP Configuration

```
Does the app load remote scripts or styles?
├── YES → Add each trusted remote origin to relevant CSP directive
│   ├── Example: "style-src": "'self' https://fonts.googleapis.com"
│   └── Keep list minimal — prefer CDN-free deployments
└── NO → Use restrictive CSP: default-src="'self'" 
         with asset: and customprotocol: for local assets only
         + 'wasm-unsafe-eval' if using Rust frontend or WASM
```

### 5.5 Updater Decision

```
Does the app need auto-updates?
├── NO → Don't configure updater; saves build complexity
└── YES →
    ├── Is code signing infrastructure available?
    │   ├── NO → Set up signing keys first; don't skip this
    │   └── YES → Configure createUpdaterArtifacts: true
    ├── Static JSON (GitHub Releases) or Dynamic server?
    │   ├── Simple app, no complex rollout needs → Static JSON
    │   └── Multi-channel, canaries, server-side logic → Dynamic server
    └── Test ONLY from installed build, never from tauri dev
```

---

## 6. Confidence Notes

**Overall Confidence: MEDIUM-HIGH**

**Reasoning:**
- Primary sources are official Tauri v2 documentation (v2.tauri.app) — Tier 1, current as of 2025-2026.
- Secondary sources include the Oflight security analysis (March 2026), which provides independent corroboration of official doc claims.
- Perplexity used once for coverage check on common issues — claims verified against underlying sources before inclusion.
- Multiple sources triangulate on the same findings (capabilities security model, CSP, updater signing requirements, Linux WebKitGTK issues).
- Gaps: Exact market share data unavailable; enterprise adoption rates unconfirmed; some v2-specific benchmark data sparse.
- Some footgun items (Android IPC blocking at 10%, Linux restart loop) are from community reports with imprecise frequency estimates.
- Mobile plugin authoring documentation is thin — some details inferred from plugin template structure rather than comprehensive official docs.

**Source recency:** All official doc sources are from 2025 (last updated Apr-Aug 2025) and the Oflight articles are March 2026, making them current for 2026 guidance.

---

## Sources

[1] Tauri v2 Security — Permissions: https://v2.tauri.app/security/permissions/ (Tier 1, updated Apr 8 2025)

[2] Tauri v2 Security — Capabilities: https://v2.tauri.app/security/capabilities/ (Tier 1, updated Aug 1 2025)

[3] Tauri v2 Security — Content Security Policy: https://v2.tauri.app/security/csp/ (Tier 1, updated Apr 7 2025)

[4] Tauri v2 Concept — Isolation Pattern: https://v2.tauri.app/concept/inter-process-communication/isolation/ (Tier 1, updated Jul 10 2025)

[5] Tauri v2 Develop — Calling Rust from Frontend: https://v2.tauri.app/develop/calling-rust/ (Tier 1, updated Nov 19 2025)

[6] Tauri v2 Plugin — Updater: https://v2.tauri.app/plugin/updater/ (Tier 1, updated Nov 28 2025)

[7] Tauri v2 Develop — Mobile Plugin Development: https://v2.tauri.app/develop/plugins/develop-mobile/ (Tier 1, updated Nov 15 2025)

[8] Tauri v2 Learn — Using Plugin Permissions: https://v2.tauri.app/learn/security/using-plugin-permissions/ (Tier 1, updated Feb 22 2025)

[9] Tauri v2 Distribute — iOS Code Signing: https://v2.tauri.app/distribute/sign/ios/ (Tier 1, updated Feb 22 2025)

[10] Oflight Inc. — Complete Guide to Tauri v2 Security Model: https://www.oflight.co.jp/en/columns/tauri-v2-security-model (Tier 3, published Mar 4 2026)

[11] Oflight Inc. — Tauri v2 Auto-Update and Distribution Guide: https://www.oflight.co.jp/en/columns/tauri-v2-auto-update-distribution (Tier 3, published Mar 4 2026)

[12] Tauri v2 — Capabilities for Different Windows and Platforms: https://v2.tauri.app/learn/security/capabilities-for-windows-and-platforms/ (Tier 1, updated Sep 3 2025)

[13] Tauri v2 — Configuration Files: https://v2.tauri.app/develop/configuration-files/ (Tier 1, updated Jul 2 2025)

[14] Tauri v2 — HTTP Headers: https://v2.tauri.app/security/http-headers/ (Tier 1, updated Jul 1 2025)

[15] Tauri v2 — Ecosystem Security: https://v2.tauri.app/security/ecosystem/ (Tier 1)

[16] Tauri v2 — Application Lifecycle Threats: https://v2.tauri.app/security/lifecycle/ (Tier 1)

[17] Perplexity — Tauri v2 Common Problems/Issues research (synthesis, verified against sources above)
