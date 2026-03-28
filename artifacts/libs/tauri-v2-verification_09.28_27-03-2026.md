# Tauri v2 High-Risk Detail Verification Report

**Research Date**: 2026-03-27  
**Scope**: Tauri v2.x (stable)  
**Sources**: Official Tauri Docs (tauri-apps/tauri-docs), Context7 documentation

---

## 1. Official Scaffolding Commands/Options for Creating a New Tauri v2 App

**Verdict**: ✅ Verified

**Evidence**: The primary command is `npm create tauri-app@latest` (or equivalent for yarn/pnpm/bun/deno), which invokes `create-tauri-app`. Version 2 is explicitly available via `pnpm create tauri-app@2`, `yarn create tauri-app@2`, etc. Shell installers are also available via `sh <(curl https://create.tauri.app/sh)` on Unix, `irm https://create.tauri.app/ps | iex` on PowerShell. Rust-only projects can use `cargo install create-tauri-app --locked && cargo create-tauri-app`.

Source: [create-tauri-app scaffolding](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/_fragments/cta.mdx), [create-tauri-app v2 release](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/blog/create-tauri-app-version-3-released.md)

**Interactive Prompts** (from `create-tauri-app`):
- Project name (default: `tauri-app`)
- Identifier (default: `com.tauri-app.app`)
- Frontend language: Rust (cargo), TypeScript/JavaScript (pnpm/yarn/npm/bun), .NET (dotnet)
- Package manager selection
- UI template: Vanilla, Vue, Svelte, React, Solid, Angular, Preact, Yew, Leptos, Sycamore, Blazor
- UI flavor (for TS/JS): TypeScript or JavaScript

**Safe wording for skill**: Use `npm create tauri-app@latest` (or equivalent for your package manager). The `@latest` tag defaults to the latest stable v2.x. For non-interactive use, pipe answers or use the shell installer directly.

**Confidence**: HIGH — Direct from official docs and release blog.

---

## 2. CSP: Enabled/Disabled by Default in v2 Config, and CSP Modification for Bundled Assets

**Verdict**: CSP is **DISABLED by default** — must be explicitly set in `tauri.conf.json`.

**Evidence**: Official docs state: "The CSP protection is only enabled if set on the Tauri configuration file." CSP is configured under `app.security.csp` (not under `headers`). When CSP is configured, "Tauri appends its nonces and hashes to the relevant CSP attributes automatically to bundled code and assets" at compile time, so developers only need to define what is unique to their application.

Source: [CSP Configuration](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/security/csp.mdx)

**CSP Config Example** (from docs):
```json
"csp": {
  "default-src": "'self' customprotocol: asset:",
  "connect-src": "ipc: http://ipc.localhost",
  "font-src": ["https://fonts.gstatic.com"],
  "img-src": "'self' asset: http://asset.localhost blob: data:",
  "style-src": "'unsafe-inline' 'self' https://fonts.googleapis.com"
}
```

**Safe wording for skill**: "CSP is NOT enabled by default in Tauri v2. You must explicitly add an `app.security.csp` entry in `tauri.conf.json`. When configured, Tauri automatically injects nonces/hashes for bundled scripts and assets."

**Additional note for WebAssembly**: When using WASM, include `'wasm-unsafe-eval'` in `script-src` CSP directive per [WASM Support section](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/security/csp.mdx).

**Confidence**: HIGH — Explicitly stated in official docs.

---

## 3. Capabilities/Permissions Best Practice: Directory, Config Linkage, Per-Window

**Verdict**: Capabilities live in `src-tauri/capabilities/` (JSON or TOML format). Permissions are defined in TOML under `src-tauri/permissions/`. Per-window capability files are the recommended pattern for least-privilege.

**Evidence**: Official docs state:
- Capabilities directory: `src-tauri/capabilities/`
- Permissions directory: `src-tauri/permissions/` (TOML only — permissions cannot be JSON)
- Capability files can be JSON, JSON5, or TOML
- Each capability has an `identifier`, `description`, `windows` array, and `permissions` array
- Capability files map to specific windows via the `windows` field
- `core:default` permission set simplifies boilerplate by including all core plugin defaults

Source: [Permissions Configuration](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/security/permissions.mdx), [Capabilities Security](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/security/capabilities.mdx)

**Directory Structure** (from docs):
```
src-tauri/
├── capabilities/
│   └── default.json/toml
└── permissions/
    └── <identifier>.toml
```

**Per-Window Best Practice**: Create separate capability files per window category. Docs state: "Capability files in Tauri should be organized by category of actions they enable, with separate JSON files stored in the `src-tauri/capabilities` directory."

Source: [Capabilities for Windows and Platforms](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/Security/capabilities-for-windows-and-platforms.mdx)

**Safe wording for skill**: "Store capabilities in `src-tauri/capabilities/` (one file per window/category). Use the `windows` array to restrict permissions per window. Prefer `core:default` for main window convenience, but use targeted per-window files for least-privilege. Permissions themselves must be defined in TOML format under `src-tauri/permissions/`."

**Confidence**: HIGH — Explicitly documented.

---

## 4. Plugin Installation Guidance for v2 (Rust + JS CLI/Package Additions)

**Verdict**: Two-step process: (1) Add Rust crate to `Cargo.toml` (or use `cargo tauri add <plugin>`), (2) Add JS package to `package.json`. The `tauri add` CLI command automates both sides.

**Evidence**: Official docs show two patterns:

**Manual Installation**:
```rust
// Cargo.toml
[dependencies]
tauri-plugin-cli = "2"
```
```json
// package.json
{
  "dependencies": {
    "@tauri-apps/plugin-cli": "^2.0.0"
  }
}
```
```rust
// lib.rs / main.rs
tauri::Builder::default()
    .plugin(tauri_plugin_cli::init())
```

**Automated via CLI**:
```sh
npm run tauri add cli   # or yarn/pnpm/etc.
cargo tauri add cli     # Rust-only equivalent
```

Source: [CLI Plugin Installation](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/cli.mdx), [Migrate from Tauri 1](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/start/migrate/from-tauri-1.mdx)

**Plugin Initialization Pattern**: Most v2 plugins use `.plugin(plugin_name::init())` in the builder chain, conditionally initialized for desktop only via `#[cfg(desktop)]` when mobile siblings exist.

**Safe wording for skill**: "For each plugin: (1) Add the Rust crate to `Cargo.toml` or run `cargo tauri add <plugin-name>`, (2) Add the JS package via your package manager, (3) Register the plugin in `tauri::Builder::default().plugin(...)`. The `tauri add` CLI automates the Rust+JS sync."

**Confidence**: HIGH — Official docs and migration guide.

---

## 5. Release/Devtools Guidance: Debug Default, Release Feature Flag, App Store Limitations

**Verdict**: Devtools are OFF by default in release builds. Enabling `devtools` Cargo feature allows inspection in production, but **macOS App Store rejects apps using private devtools APIs**.

**Evidence**:

**Debug vs Release**:
- `tauri dev` — always has devtools (debug assertions enabled)
- `tauri build` — release build, devtools OFF by default
- `tauri build --debug` — release build with debug features, devtools available

**Devtools Cargo Feature**:
```toml
[dependencies]
tauri = { version = "...", features = ["...", "devtools"] }
```

**macOS App Store Warning** (exact quote from docs):  
"A critical consideration for macOS applications is that the devtools API is private. Using private APIs on macOS will prevent your application from being accepted into the App Store, so this feature should be used with extreme caution if App Store distribution is a goal."

Source: [Devtools Debug](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/Debug/index.mdx)

**Conditional Rust Debug Code** (from docs):
```rust
#[cfg(debug_assertions)] // true for `tauri dev` AND `tauri build --debug`
{
    let window = app.get_webview_window("main").unwrap();
    window.open_devtools();
}
```

**Safe wording for skill**: "Devtools are off by default in release builds. The `devtools` Cargo feature enables them in production, but DO NOT use this feature if distributing via macOS App Store — the devtools API is private on macOS and will cause App Store rejection."

**Confidence**: HIGH — Exact quote from official docs.

---

## 6. Mobile Vite Dev Server Guidance (`TAURI_DEV_HOST`, Host Binding, HMR)

**Verdict**: For mobile development (iOS physical device), Vite must bind to `TAURI_DEV_HOST` env var and configure HMR with WebSocket protocol on port 1421.

**Evidence**: Official docs provide this exact Vite config:
```javascript
import { defineConfig } from 'vite';
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    host: host || false,   // false = localhost, TAURI_DEV_HOST = public IP or TUN address
    port: 1420,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
  },
});
```

Source: [Mobile Vite Config](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/index.mdx), [Vite + Tauri Integration](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/start/frontend/vite.mdx)

**`TAURI_DEV_HOST` Behavior**:
- Set automatically by `tauri ios dev` / `tauri android dev`
- On physical iOS device: contains public network address OR iOS TUN address (ending in `::2`) if using `--force-ip-prompt`
- Projects created with `create-tauri-app` have this config out of the box

**Dev Commands** (from docs):
```sh
npm run tauri [android|ios] dev --open --host
```

**Safe wording for skill**: "For mobile dev, read `process.env.TAURI_DEV_HOST` in your Vite config. When set, bind server to that address and configure HMR with `{ protocol: 'ws', host: <TAURI_DEV_HOST>, port: 1421 }`. Use `strictPort: true` on port 1420."

**Confidence**: HIGH — Exact config snippet from official docs.

---

## 7. Updater Requirements: Config Keys, Signature/Public Key, Artifact Generation

**Verdict**: Updater requires: (1) `bundle.createUpdaterArtifacts: true` in `tauri.conf.json`, (2) `plugins.updater.pubkey` with public key content (not a file path), (3) `plugins.updater.endpoints` array. Signature is **mandatory and cannot be disabled**.

**Evidence**:

**Config Keys**:
```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "CONTENT FROM PUBLICKEY.PEM",
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

**Key Generation**:
```sh
cargo tauri signer generate -w ~/.tauri/myapp.key
```

**Signer Key Env Vars** (for CI):
```shell
export TAURI_SIGNING_PRIVATE_KEY="Path or content of your private key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

**Artifact Generation** (from docs):
- **Linux**: `myapp.AppImage` + `myapp.AppImage.sig` in `target/release/bundle/appimage/`
- **macOS**: `myapp.app.tar.gz` + `myapp.app.tar.gz.sig` in `target/release/bundle/macos/`
- **Windows**: `myapp-setup.exe` + `myapp-setup.exe.sig` and `myapp.msi` + `myapp.msi.sig`

**Critical Quote**: "Tauri's updater needs a signature to verify that the update is from a trusted source. This cannot be disabled."

**v1 Compatibility**: For migration from v1, set `createUpdaterArtifacts: "v1Compatible"` instead of `true`.

Source: [Updater Plugin](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/updater.mdx)

**Safe wording for skill**: "The updater requires `pubkey` (PEM content, not a path), `endpoints` array with `{{target}}`, `{{arch}}`, `{{current_version}}` variables, and `createUpdaterArtifacts: true`. Signing is mandatory — there is no way to disable it. Loss of the private key means loss of update capability for existing installs."

**Confidence**: HIGH — Exact config and quote from official docs.

---

## 8. macOS Info.plist Extension Behavior: Auto-Discovery/Merge vs File Copy, Recommended Approach

**Verdict**: Creating an `Info.plist` file in `src-tauri/` causes **automatic merge** with Tauri's generated Info.plist. This is the recommended approach. File-copy via `bundle.resources` is a separate mechanism for additional localization files.

**Evidence**:

**Quote from docs**: "To extend the configuration file, create an `Info.plist` file in the `src-tauri` folder and include the key-pairs you desire. This `Info.plist` file is merged with the values generated by the Tauri CLI."

**Merge Behavior**: The user-provided `Info.plist` keys are merged with Tauri's generated defaults. Warning: "Be careful when overwriting default values such as application version as they might conflict with other configuration values and introduce unexpected behavior."

Source: [macOS Application Bundle - Native configuration](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/distribute/macos-application-bundle.mdx)

**Localization Files** (separate mechanism): For `InfoPlist.strings` localization files, use `bundle.resources` to copy them into the bundle:
```json
{
  "bundle": {
    "resources": {
      "infoplist/**": "./"
    }
  }
}
```
This is for `lproj` directories with `InfoPlist.strings` files — NOT for the base `Info.plist` merge.

**Safe wording for skill**: "For macOS Info.plist extensions: place an `Info.plist` file in `src-tauri/` with your additional keys. Tauri will merge it with the generated plist automatically. Do NOT try to overwrite core values like app version. For localization strings, use `bundle.resources` with `infoplist/**` glob pattern instead."

**Confidence**: HIGH — Explicit merge behavior documented.

---

## 9. Transparent Windows / Titlebar Customization on macOS: Conditions and Private API

**Verdict**: Transparent titlebar requires: (1) `title_bar_style(TitleBarStyle::Transparent)` on `WebviewWindowBuilder`, (2) optional background color via cocoa crate bindings, (3) removing default window config from `tauri.conf.json` and creating window programmatically in Rust.

**Evidence**:

**TitleBarStyle Enum Values**: `TitleBarStyle::Transparent` and `TitleBarStyle::Overlay` (from v1.2 release notes — "transparent or overlay titlebar style").

Source: [Window Customization](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/window-customization.mdx), [Tauri 1.2 release](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/blog/tauri-1-2.mdx)

**Required Setup**:
1. Remove `windows` array from `tauri.conf.json` (or don't define the window there)
2. Create window programmatically in Rust using `WebviewWindowBuilder`
3. Apply `title_bar_style(TitleBarStyle::Transparent)` conditionally:
   ```rust
   #[cfg(target_os = "macos")]
   let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);
   ```
4. For background color, use cocoa crate:
   ```rust
   [target."cfg(target_os = \"macos\")".dependencies]
   cocoa = "0.26"
   ```

**Custom Titlebar Caveat**: "For macOS, using a custom titlebar will also lose some features provided by the system, such as moving or aligning the window."

**`decorations: false`**: When building a fully custom titlebar, set `tauri.conf.json` `windows[].decorations` to `false` to hide the native frame entirely.

**Safe wording for skill**: "For transparent titlebar on macOS: use `WebviewWindowBuilder` programmatically with `.title_bar_style(TitleBarStyle::Transparent)`. This requires removing default window config from `tauri.conf.json`. For background color, use the `cocoa` crate with `ns_window.setBackgroundColor_()`. Note: custom titlebars lose native window management features."

**Note on Private API**: The `cocoa` crate usage for `NSWindow` manipulation is not itself a private API — the concern about private APIs was specifically about the devtools `webview inspect` API on macOS.

**Confidence**: HIGH — Direct from official window customization docs.

---

## 10. Anti-Patterns / Warnings: Shell/FS/HTTP Plugin Permissions

**Verdict**: Multiple documented security warnings exist for these plugins. Key anti-patterns to encode:

**Shell Plugin**:
- **CVE-2024-24576**: Windows apps with `shell:allow-execute` passing untrusted input to `cmd.exe` or `.bat/.cmd` files without proper scope validation are vulnerable. Mitigation: always validate arguments with regex validators in scope.
- **Anti-pattern**: Using `shell:allow-open` (which opens URLs/files with system defaults) is safer than `shell:allow-execute` which runs arbitrary commands.
- **Scope required**: `shell:allow-execute` requires an `allow` array with `cmd`, `args` (with validators), and `sidecar` fields.

Source: [Shell Plugin Config](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/shell.mdx), [CVE-2024-24576](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/blog/cve-2024-24576.md)

**FS Plugin**:
- **Anti-pattern**: Granting `fs:default` (which includes read-write access to app data directories) without scoping.
- **Best practice**: Use path-scoped permissions like `$APPDATA`, `$RESOURCE`, `$HOME/*` with explicit `allow` arrays.
- Dangerous permissions like `fs:allow-write-text-file` should be added explicitly, not via `fs:default`.

Source: [FS Plugin Permissions](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/file-system.mdx)

**HTTP Plugin**:
- **Anti-pattern**: Using `http:default` without `allow`/`deny` URL scopes — allows requests to any URL.
- **Best practice**: Always define scope with specific URL patterns:
  ```json
  {
    "identifier": "http:default",
    "allow": [{ "url": "https://*.tauri.app" }],
    "deny": [{ "url": "https://private.tauri.app" }]
  }
  ```
- **Forbidden headers**: Cannot be set by default. Use `features = ["unsafe-headers"]` in `tauri-plugin-http` Cargo dependency only if absolutely required.

Source: [HTTP Plugin Config](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/http-client.mdx)

**General Permission Anti-Pattern**:
- All dangerous plugin commands are **blocked by default** in v2 (unlike v1 allowlist). This is intentional. Never grant more permissions than needed.
- Using `core:default` convenience permission is "reasonably secure" but still grants all core defaults — prefer targeted permissions for production apps handling sensitive data.

Source: [core:default docs](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/blog/tauri-2-0-0-release-candidate.mdx)

**Safe wording for skill**:
- **Shell**: Never use `shell:allow-execute` with user input without strict `args` validators. Prefer `shell:allow-open` when possible.
- **FS**: Always scope `fs` permissions with path variables (`$APPDATA`, `$RESOURCE`). Never grant broad `fs:default` to windows that don't need file access.
- **HTTP**: Always define `allow`/`deny` URL scopes on `http:default`. Never ship with open HTTP scope.
- **General**: v2 blocks dangerous permissions by default — this is a feature. Do not add permissions just because the app "works" — find the minimal set.

**Confidence**: HIGH — All items traceable to official docs or documented CVEs.

---

## Summary Table

| # | Topic | Verdict | Confidence |
|---|-------|---------|------------|
| 1 | Scaffolding commands | `npm create tauri-app@latest` + equivalents | HIGH |
| 2 | CSP default | **DISABLED** by default | HIGH |
| 3 | Capabilities structure | `src-tauri/capabilities/`, per-window files | HIGH |
| 4 | Plugin installation | Rust crate + JS package, `tauri add` CLI | HIGH |
| 5 | Devtools/App Store | OFF by default; `devtools` feature = App Store rejection | HIGH |
| 6 | Mobile dev server | Use `TAURI_DEV_HOST`, ws protocol on 1421 | HIGH |
| 7 | Updater requirements | `pubkey` + `endpoints` + `createUpdaterArtifacts`, signing mandatory | HIGH |
| 8 | Info.plist merge | Auto-merge via `src-tauri/Info.plist` | HIGH |
| 9 | Transparent titlebar | `TitleBarStyle::Transparent` + cocoa crate, programmatic creation | HIGH |
| 10 | Shell/FS/HTTP warnings | Strict scoping, URL allow/deny, arg validators | HIGH |

---

## Inferred Items (Flagged)

No items in this research were purely inferred — all claims trace to official documentation or release blog posts. Items like `TitleBarStyle::Overlay` (vs `Transparent`) came from v1.2 release notes but still represent the official API surface for v2.

---

*Artifact generated: 2026-03-27*
