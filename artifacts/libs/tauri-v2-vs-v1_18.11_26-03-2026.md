# Tauri v2 vs v1: Engineering Differences

**Research date:** 26 Mar 2026  
**Sources:** [Official Tauri v2 migration guide](https://v2.tauri.app/start/migrate/from-tauri-1/), [Tauri 2.0 blog announcement](https://v2.tauri.app/blog/tauri-2.0/), [Tauri 2.0 RC release notes](https://v2.tauri.app/blog/tauri-2-0-0-release-candidate/)

---

## 1. Platform Support: Mobile is the Headline Change

**Tauri v1:** Desktop only (Windows, macOS, Linux).

**Tauri v2:** Adds first-class **iOS and Android** support. You write Swift/Kotlin for native mobile APIs and expose them to Rust/frontend through the plugin system.

**Evidence** ([Tauri 2.0 blog](https://v2.tauri.app/blog/tauri-2.0/)):
> Tauri v2 extends support beyond desktop operating systems to include iOS and Android mobile platforms. The framework uses native languages — Swift for iOS and Kotlin for Android — to build interfaces that interact with Rust code.

**Caveat:** Not all desktop plugins work on mobile. The blog explicitly states some plugins are "intentionally excluded as poor fits for mobile platforms." Mobile tooling is also acknowledged to be less mature than desktop.

---

## 2. Architecture: Monolith → Plugin System

This is the fundamental architectural shift.

**Tauri v1:** Core binary included everything — filesystem, shell, dialogs, HTTP client. The `allowlist` in `tauri.conf.json` was a runtime gatekeeper (code present, execution gated). Result: bloated binaries and broad implicit trust.

**Tauri v2:** Feature modules are **separate Rust crates** and **separate NPM packages**. You opt into only what you need.

**Evidence** ([ColdFusion migration blog](https://coldfusion-example.blogspot.com/2025/12/tauri-v2-migration-guide-handling.html)):
> Tauri v2 decouples these features to solve two problems: Binary Size and Security Surface Area. By moving features (fs, shell, cli, dialog) into separate Cargo crates and NPM packages, the compiler performs tree shaking.

**Migration impact:**
- `api::dialog` → `tauri-plugin-dialog`
- `api::http` → `tauri-plugin-http`
- `api::fs` → `tauri-plugin-fs` (Rust side uses `std::fs`)
- `api::clipboard` → `tauri-plugin-clipboard-manager`
- `updater` → `tauri-plugin-updater`
- CLI, shell, global-shortcut, notification — all plugins

On the JS side: `@tauri-apps/api/fs` → `@tauri-apps/plugin-fs`, etc.

---

## 3. Security: Allowlist → Capabilities (ACL System)

**Tauri v1:** Boolean allowlist (`fs: { all: true }`) — too coarse-grained.

**Tauri v2:** Granular **capabilities** system with explicit permission scopes.

**Evidence** ([Tauri docs](https://v2.tauri.app/start/migrate/from-tauri-1/)):
> `tauri > allowlist` removed. Refer to Migrate Permissions.

**How it works:** You create capability JSON files in `src-tauri/capabilities/` that define exactly which permissions each window/platform gets:

```json
{
  "identifier": "mobile-capability",
  "windows": ["main"],
  "platforms": ["iOS", "android"],
  "permissions": [
    "nfc:allow-scan",
    "biometric:allow-authenticate"
  ]
}
```

**Security improvement:** The code for a capability must both be compiled in AND explicitly granted. In v1, compiled-in code was only gated by config. In v2, it's gated by both compilation AND capability file.

**Trade-off:** More secure but more verbose initial setup.

---

## 4. Configuration Restructure

The `tauri.conf.json` schema changed significantly:

| v1 | v2 |
|----|----|
| `package > productName` | top-level `productName` |
| `tauri` key | renamed to `app` |
| `tauri > allowlist` | removed (capabilities instead) |
| `tauri > cli` | `plugins > cli` |
| `tauri > updater` | `plugins > updater` |
| `tauri > systemTray` | `app > trayIcon` |
| `build > distDir` | `frontendDist` |
| `build > devPath` | `devUrl` |
| `bundle > identifier` | top-level `identifier` |
| `tauri > windows > fileDropEnabled` | `app > windows > dragDropEnabled` |

**Evidence:** [Migration guide config section](https://v2.tauri.app/start/migrate/from-tauri-1/#tauri-configuration)

---

## 5. Event System Redesign

**Tauri v1:** Event source tracking was implicit — listeners relied on knowing event origins.

**Tauri v2:** Event targets make routing explicit.

- `emit` now broadcasts to all listeners
- New `emit_to` triggers events to specific targets
- `listen_global` → `listen_any` (listens regardless of target)
- `WebviewWindow.listen` only receives events for its own target

**Evidence:** [Migration guide event system section](https://v2.tauri.app/start/migrate/from-tauri-1/#event-system)

---

## 6. Multi-Webview Support (Unstable)

**Tauri v1:** Single webview per window.

**Tauri v2:** `Window` type renamed to `WebviewWindow`; multiwebview behind `unstable` feature flag.

**Evidence:**
> Tauri v2 introduces multiwebview support currently behind an `unstable` feature flag. In order to support it, we renamed the Rust `Window` type to `WebviewWindow`.

---

## 7. Windows: HTTP Scheme Change

On Windows production builds, v2 uses `http://tauri.localhost` instead of `https://tauri.localhost`. This resets IndexedDB/LocalStorage/Cookies unless you set `app > windows > useHttpsScheme: true`.

---

## 8. Other Notable Changes

| Change | Detail |
|--------|--------|
| **Rust crate** | `api` module fully removed; all APIs are now plugins |
| **JS API split** | `@tauri-apps/api` now only exports `core`, `path`, `event`, `window` — everything else is a plugin package |
| **IPC rewrite** | `api::ipc` → `tauri::ipc::Channel` |
| **Menu/Tray APIs** | Moved to `tauri::menu` (using `muda` crate) and `tauri::tray` |
| **Path resolution** | `api::path` → `tauri::Manager::path` |
| **Env vars renamed** | e.g., `TAURI_PRIVATE_KEY` → `TAURI_SIGNING_PRIVATE_KEY` |
| **Updater** | Now a plugin (`tauri-plugin-updater`) |
| **Security audit** | v2 underwent independent audit by Radically Open Security (NLNet funded) |

---

## Verdict: When does v2 Matter?

### Choose **Tauri v2** if:
- You need **mobile** (iOS/Android) — v1 is desktop-only, deal-breaker for mobile
- You want **smaller binaries** and better tree-shaking via the plugin model
- You need **finer-grained security** via capabilities (important for multi-tenant or high-privilege apps)
- You want to use **mobile-specific plugins** (NFC, biometric, barcode-scanner, geolocation, etc.)
- You're starting a **new project** — v1 is deprecated and won't get new features

### Consider staying on **v1** (or accept migration cost) if:
- You're migrating an **existing v1 app** and the mobile/advanced security features aren't needed — the migration is non-trivial
- You rely on the simpler `allowlist` model and config structure
- You hit v2's **mobile immaturity** for your specific plugin needs

### Bottom line
> "V1 will only get deprecated over time. There's no justification to use an old version for new apps, especially for production use." — [Reddit community consensus](https://www.reddit.com/r/tauri/comments/1h6qei2/)

The **mobile support is the killer feature** of v2. Everything else (plugin architecture, capabilities, security hardening) is a significant improvement but not a breaking reason to migrate existing desktop apps. For new projects, v2 is the clear default.
