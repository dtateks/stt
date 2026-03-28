# Tauri v2 Production Best Practices

**Scope**: Tauri v2.x (stable) — desktop and mobile — for agents building new production applications.
**Status**: Research artifact. Claims labeled "official" (from v2.tauri.app/docs) or "inferred" (from upstream source).

---

## 1. Decision Matrix: When Tauri v2 Is the Right Fit

### Tauri v2 IS a Good Fit

| Scenario | Rationale | Source |
|----------|-----------|--------|
| Cross-platform desktop (Windows/macOS/Linux) + mobile (Android/iOS) from one codebase | Unified Rust backend, web frontend, shared plugins | [v2.tauri.app](https://v2.tauri.app/ko/blog/tauri-20) |
| Need native system integration (tray, menus, dialogs, notifications) | First-class plugin APIs for OS-level features | [System Tray](https://v2.tauri.app/learn/system-tray), [Window Menu](https://v2.tauri.app/learn/window-menu) |
| Small binary size (< 10 MB) is critical | Compiles to single native binary, no bundled runtime | [docs.rs tauri](https://docs.rs/tauri/2.0.0/tauri/) |
| Security-sensitive app requiring IPC isolation | Isolation pattern option, CSP enforcement, capability system | [Isolation Pattern](https://v2.tauri.app/concept/inter-process-communication/isolation) |
| Need to embed external binaries (sidecars) | First-class sidecar support for any language | [Sidecar](https://v2.tauri.app/es/develop/sidecar) |
| App with custom titlebar/transparent/HUD windows | Full window customization including transparent titlebars | [Window Customization](https://v2.tauri.app/learn/window-customization) |

### Tauri v2 Is NOT the Right Fit

| Scenario | Alternative |
|----------|-------------|
| Pure mobile app without desktop | Native Flutter, React Native, or Kotlin Multiplatform |
| Requires WebGL-intensive 3D rendering | Electron with native Node modules or Godot |
| Needs Node.js native modules unavailable in Rust | Electron or WRY-based solution |
| Very simple static HTML + JS app with no system integration | Static web hosting or Tauri with `devtools` only |

### Frontend Stack Decision

| Stack | Best For | Setup Command |
|-------|----------|---------------|
| **Vanilla JS/TS** | Maximum control, minimal bundle | `npm create tauri-app` → Vanilla |
| **React** | Component ecosystem, state management | `npm create tauri-app` → React |
| **Vue/Svelte/Solid** | Reactive UI, smaller bundles | `npm create tauri-app` → Vue/Svelte/Solid |
| **SvelteKit/Next.js** | SSR routing, full-stack | Configure `devUrl` + `frontendDist` manually | [Vite Config](https://v2.tauri.app/start/frontend/sveltekit) |

> **Official recommendation**: Use any frontend that compiles to HTML/JS/CSS. Tauri is frontend-framework agnostic. ([v2.tauri.app](https://v2.tauri.app/))

### Desktop vs Mobile Considerations

| Concern | Desktop | Mobile |
|---------|---------|--------|
| Window model | Multiple windows, full customization | Single window, limited control |
| Menu system | App menu + window menu + tray menu | System context menus only |
| Filesystem access | Full FS via plugin with scope restrictions | Sandboxed, use app directories |
| Shell commands | Executable spawning with strict allowlist | Restricted, `open` only |
| Background services | Full support | Limited by OS lifecycle |
| Distribution | Direct .app/.exe/.deb/.rpm | App Store / Play Store |

> **Critical**: Code paths using `#[cfg(target_os = "macos")]` or `#[cfg(target_os = "android")]` are required for platform-specific features. ([docs.rs feature flags](https://docs.rs/tauri/2.0.0/tauri/#cargo-features))

---

## 2. Golden Path: Secure/Default Project Setup

### 2.1 Project Scaffolding

```bash
# Official scaffolding via create-tauri-app
sh <(curl https://create.tauri.app/sh)
```

Directory structure produced:

```
tauri-app/
├── src/                    # Frontend source
├── index.html
├── package.json
└── src-tauri/
    ├── Cargo.toml
    ├── capabilities/        # Permission/capability JSON files
    │   └── default.json
    ├── src/
    │   ├── lib.rs           # Plugin registration, setup
    │   └── main.rs          # Entry point
    └── tauri.conf.json      # Main configuration
```

### 2.2 tauri.conf.json — Production Baseline

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "MyApp",
  "version": "1.0.0",
  "identifier": "com.myapp.app",
  "build": {
    "frontendDist": "../dist",
    "devtools": true
  },
  "app": {
    "windows": [
      {
        "title": "MyApp",
        "width": 1200,
        "height": 800,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": false,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      "freezePrototype": true,
      "dangerousDisableAssetCspModification": false
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "minimumSystemVersion": "10.13",
      "hardenedRuntime": true
    }
  },
  "plugins": {}
}
```

> **Safe defaults applied**: `hardenedRuntime: true` on macOS, CSP enabled, `freezePrototype: true`, devtools restricted to debug builds.

### 2.3 Minimal Capability File

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main window permissions",
  "windows": ["main"],
  "permissions": [
    "core:default"
  ]
}
```

### 2.4 Rust Backend Baseline (lib.rs)

```rust
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Stdout,
            ))
            .build())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 3. High-Confidence Best Practices

### 3.1 Architecture & Project Structure

| Practice | Recommendation | Source |
|----------|----------------|--------|
| **Use `create-tauri-app`** | Official scaffolding for fresh projects | [Create Project](https://v2.tauri.app/start/create-project/) |
| **Separate frontend/backend concerns** | Frontend in `src/`, Rust in `src-tauri/` | [Project Structure](https://v2.tauri.app/start/project-structure) |
| **Keep `src-tauri/` as Rust project** | Cargo.toml, proper Rust workspace | [docs.rs](https://docs.rs/tauri/2.0.0/tauri/) |
| **Use capabilities for permissions** | Define permissions in `capabilities/` directory, not inline | [Capabilities](https://v2.tauri.app/security/capabilities) |

### 3.2 Configuration Anatomy

#### `build` Section

| Property | Purpose | Notes |
|----------|---------|-------|
| `frontendDist` | Frontend build output path | Relative to `src-tauri/` |
| `devUrl` | Dev server URL (dev mode only) | Default: `http://localhost:1420` |
| `beforeDevCommand` | Frontend dev command to run | Executes before `tauri dev` |
| `beforeBuildCommand` | Frontend build command to run | Executes before `tauri build` |
| `devtools` | Enable web inspector | Default `true` in debug; requires `devtools` feature in release |

> **Important**: `devtools` is enabled by default in debug builds. In release builds, it requires the `devtools` Cargo feature. On macOS private APIs are used, so devtools cannot be enabled for App Store builds. ([Reference Config](https://v2.tauri.app/zh-cn/reference/config))

#### `app.windows[]` Section

| Property | Purpose | Platform Notes |
|----------|---------|---------------|
| `decorations` | Show native window frame | Set `false` for custom titlebar |
| `transparent` | Enable transparency | macOS: requires `macOSPrivateApi` config; see [Window Customization](https://v2.tauri.app/learn/window-customization) |
| `titleBarStyle` | macOS titlebar style | `Transparent` for HUD windows; only with `decorations: false` |
| `resizable` | Allow window resize | |
| `fullscreen` | Start in fullscreen mode | Platform restrictions apply |
| `alwaysOnTop` | Keep window above others | |

#### `bundle` Section

| Property | Purpose | macOS Notes |
|----------|---------|-------------|
| `targets` | Bundle formats | `"all"` or specific: `["app", "dmg", "pkg"]` |
| `icon` | App icons | Required for App Store |
| `macOS.hardenedRuntime` | Enable hardened runtime | **Required for notarization** |
| `macOS.minimumSystemVersion` | Minimum macOS version | |
| `createUpdaterArtifacts` | Enable auto-updates | Requires `pubkey` in `plugins.updater` |
| `active` | Enable/disable bundling | Set `false` to get raw binary only |

### 3.3 Plugin Model & Permission System

**Plugin Installation** (via CLI):

```bash
npm run tauri add log     # npm
cargo tauri add log       # or cargo
```

**Official Plugins** (always install via CLI for correct versioning):

| Plugin | Purpose | Capability Prefix |
|--------|---------|------------------|
| `tauri-plugin-fs` | Filesystem access | `fs:` |
| `tauri-plugin-shell` | Execute commands | `shell:` |
| `tauri-plugin-dialog` | Native dialogs | `dialog:` |
| `tauri-plugin-http` | HTTP client | `http:` |
| `tauri-plugin-store` | Persistent key-value store | `store:` |
| `tauri-plugin-log` | Logging | `log:` |
| `tauri-plugin-updater` | Auto-updates | `updater:` |
| `tauri-plugin-os` | OS info | `os:` |
| `tauri-plugin-notification` | System notifications | `notification:` |

**Capability Format** (in `src-tauri/capabilities/main.json`):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "fs:default",
    {
      "identifier": "fs:allow-exists",
      "allow": [{ "path": "$APPDATA/*" }]
    },
    "dialog:default",
    "shell:allow-open"
  ]
}
```

**Key Permission Rules**:

- All dangerous commands are **denied by default**. Explicit allow required. ([FS Plugin](https://v2.tauri.app/plugin/file-system))
- Use scope restrictors on `fs:` permissions — never grant `fs:read-all` in production
- Shell `execute`/`spawn` require explicit cmd/args validators in the capability
- `shell:allow-open` is enabled by default for `http(s)://`, `tel:`, `mailto:` links

### 3.4 Secure IPC Design

#### Commands (invoke)

Rust backend command:

```rust
use tauri::command;

#[command]
fn my_command(arg: String) -> Result<MyResponse, String> {
    // Validate input — never trust frontend data
    if arg.is_empty() {
        return Err("arg cannot be empty".into());
    }
    Ok(MyResponse { data: arg })
}
```

**IPC Channel for Streaming**:

```rust
use tauri::{AppHandle, ipc::Channel};

#[tauri::command]
fn download(app: AppHandle, url: String, on_event: Channel<DownloadEvent>) {
    // Send events to frontend via Channel
    on_event.send(DownloadEvent::Started { url: url.clone() }).unwrap();
}
```

#### Events (emit/listen)

**Rust → Frontend**:

```rust
use tauri::Emitter;
app.emit("my-event", payload).unwrap();
```

**Frontend listening**:

```javascript
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen('my-event', (event) => {
  console.log(event.payload);
});
// Clean up
unlisten();
```

#### Serialization Rules

- Use `serde` derive macros on all IPC structs (`#[derive(serde::Serialize, serde::Deserialize)]`)
- Use `#[serde(rename_all = "camelCase")]` to match JS convention
- For Rust enums sent to TS, implement `SERIALIZE_TO_IPC_FN` for custom serialization
- `LogicalPosition`/`PhysicalPosition` require manual serialization in TS:

```typescript
const validPosition = position instanceof LogicalPosition
  ? { Logical: { x: position.x, y: position.y } }
  : { Physical: { x: position.x, y: position.y } };
await invoke("do_something", { position: validPosition });
```

### 3.5 Security Hardening

| Setting | Value | Purpose |
|---------|-------|---------|
| `csp` | `default-src 'self'` | Restrict resource loading to same origin |
| `freezePrototype` | `true` | Prevent JS prototype pollution |
| `dangerousDisableAssetCspModification` | `false` (or minimal list) | Never disable CSP entirely unless required |
| `devCsp` | Separate dev CSP or `null` | Dev CSP can be looser, override separately |
| `pattern` | `"brownfield"` (default) or `"isolation"` | Isolation is recommended for security-sensitive apps |

**CSP Example** (restrictive):

```json
{
  "app": {
    "security": {
      "csp": {
        "default-src": "'self'",
        "connect-src": "ipc: http://ipc.localhost",
        "img-src": "'self' asset: http://asset.localhost blob: data:",
        "style-src": "'self' 'unsafe-inline'"
      }
    }
  }
}
```

**Isolation Pattern** (recommended for security-sensitive apps):

```json
{
  "app": {
    "security": {
      "pattern": {
        "use": "isolation",
        "options": {
          "dir": "../dist-isolation"
        }
      }
    }
  }
}
```

**Input Validation Rules**:
- **Always validate** at Rust backend entry points — frontend data is untrusted
- Use typed structs over raw strings for IPC arguments
- Plugin permissions are the **only** gate for plugin APIs
- `fs:` scope restrictors are critical for filesystem security

**Dangerous Flags to Avoid**:

| Flag/Config | Risk |
|-------------|------|
| `dangerousDisableAssetCspModification: true` (boolean, not list) | Disables all CSP injection — XSS risk |
| `fs:read-all` / `fs:write-all` | Overly broad filesystem access |
| `shell:allow-execute` without args validator | Arbitrary command execution |
| `transparent: true` without `decorations: false` | Inconsistent behavior across platforms |
| `devtools: true` in release (without feature flag) | Security exposure |

### 3.6 Window/Webview/Tray/Menu Patterns

#### Window Creation (Rust)

```rust
use tauri::{TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
    .title("My App")
    .inner_size(1200.0, 800.0)
    .center()
    .build()
    .unwrap();
```

#### Custom Titlebar (macOS HUD):

```rust
#[cfg(target_os = "macos")]
let window = win_builder
    .title_bar_style(TitleBarStyle::Transparent)
    .decorations(false)
    .build()
    .unwrap();
```

> **Platform note**: `TitleBarStyle::Transparent` only works on macOS and requires `macOSPrivateApi` config. ([Window Customization](https://v2.tauri.app/learn/window-customization))

#### System Tray

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&quit_i])?;

let tray = TrayIconBuilder::new()
    .menu(&menu)
    .menu_on_left_click(true)
    .build(app)?;
```

#### Application Menu

```rust
use tauri::menu::{MenuBuilder, PredefinedMenuItem};

let menu = MenuBuilder::new(app)
    .copy()
    .separator()
    .undo()
    .redo()
    .cut()
    .paste()
    .select_all()
    .build()?;
app.set_menu(menu)?;
```

### 3.7 Plugin-Specific Gotchas

#### FS Plugin

| Path Variable | Resolves To |
|--------------|-------------|
| `$APPDATA` | Application data directory |
| `$APPLOCALDATA` | Local app data |
| `$APPCONFIG` | Config directory |
| `$APPCACHE` | Cache directory |
| `$APPLOG` | Log directory |

> All dangerous commands blocked by default. Explicit scope required.

#### Shell Plugin

```json
{
  "identifier": "shell:allow-execute",
  "allow": [{
    "name": "exec-sh",
    "cmd": "sh",
    "args": [{ "validator": "\\S+" }],
    "sidecar": false
  }]
}
```

#### HTTP Plugin

- URL scope is **mandatory** — configure allowed/denied URL patterns
- `fetch` is web-standard compliant but with Rust backend
- Default forbids all URLs; must explicitly allow

```json
{
  "permissions": [
    {
      "identifier": "http:default",
      "allow": [{ "url": "https://*.myapi.com" }],
      "deny": [{ "url": "https://private.myapi.com" }]
    }
  ]
}
```

#### Store Plugin

```rust
// Rust access
let store = app.store("settings.json")?;
store.set("key", json!({ "value": 5 }));
```

```javascript
// JS access
import { load } from '@tauri-apps/plugin-store';
const store = await load('store.json', { autoSave: true });
await store.set('some-key', { value: 5 });
await store.save();
```

#### Updater Plugin

- **Signature verification is mandatory** — cannot be disabled
- Requires `pubkey` in `plugins.updater` config
- Generate keys: `cargo tauri signer generate -w ~/.tauri/myapp.key`

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

### 3.8 Mobile-Specific Caveats

| Feature | Android | iOS | Desktop Implication |
|---------|---------|-----|---------------------|
| Window transparency | Not supported | Not supported | Don't rely on `transparent: true` |
| `setBackgroundColor` | Unsupported on window | Unsupported on window | Not portable |
| Devtools | Chrome inspect only | Safari Dev Tools | Different debugging workflow |
| Menu | Context menus only | System menus only | No app-wide menu on mobile |
| Tray | Not supported | Not supported | Tray is desktop-only |
| Shell | `open` only | `open` only | Cannot spawn arbitrary processes |
| FS access | App sandbox | App sandbox | Use app-specific directories only |
| Sidecar | Not supported | Not supported | Desktop-only feature |

**Mobile Plugin Development** (Kotlin/Swift):

```rust
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_example);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("example")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            api.register_android_plugin("com.plugin.example", "ExamplePlugin")?;
            #[cfg(target_os = "ios")]
            api.register_ios_plugin(init_plugin_example)?;
            Ok(())
        })
        .build()
}
```

### 3.9 Packaging/Signing/Distribution

#### macOS Signing (App Store / Direct Distribution)

```bash
# Via GitHub Actions tauri-action
xcrun productbuild --sign "<certificate identity>" \
  --component "target/universal-apple-darwin/release/bundle/macos/$APPNAME.app" \
  /Applications "$APPNAME.pkg"
```

**Required for App Store**:
- `macOS.hardenedRuntime: true` in `tauri.conf.json`
- `minimumSystemVersion` set appropriately
- Notarization via `xcrun notarytool` or GitHub Actions

#### Android Signing

```bash
npm run tauri android build -- --export-method app-store-connect
```

Signing config in GitHub Actions:

```yaml
- name: setup Android signing
  run: |
    echo "keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}" > keystore.properties
    echo "password=${{ secrets.ANDROID_KEY_PASSWORD }}" >> keystore.properties
    base64 -d <<< "${{ secrets.ANDROID_KEY_BASE64 }}" > $RUNNER_TEMP/keystore.jks
    echo "storeFile=$RUNNER_TEMP/keystore.jks" >> keystore.properties
```

### 3.10 Testing & Dev Workflow

#### Dev Mode

```bash
npm run tauri dev   # Runs beforeDevCommand + starts Tauri
```

#### Testing with WebDriver

```yaml
# GitHub Actions CI
- name: Cargo test
  run: cargo test
- name: WebdriverIO
  run: xvfb-run yarn test  # Linux
  working-directory: e2e-tests
```

#### Mocking IPC in Tests

```typescript
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

afterEach(() => clearMocks());

test("mocked command", () => {
  mockIPC((cmd, payload) => {
    if (cmd === "add") {
      return (payload.a as number) + (payload.b as number);
    }
  });
  expect(invoke('add', { a: 12, b: 15 })).resolves.toBe(27);
});
```

#### Dev-Only Code

```rust
#[cfg(dev)]
{
    // tauri dev only code
}

if cfg!(dev) {
    // tauri dev only code
} else {
    // tauri build only code
}

let is_dev: bool = tauri::is_dev();
```

### 3.11 Vite Dev Server for Mobile

Mobile requires binding to `0.0.0.0` and WebSocket HMR:

```javascript
const mobile = !!/android|ios/.exec(process.env.TAURI_ENV_PLATFORM);

export default defineConfig({
  server: {
    host: mobile ? '0.0.0.0' : false,
    port: 1420,
    hmr: mobile ? { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 1430 } : undefined,
  },
});
```

> **Inferred from** [Tauri 2.0.0-rc blog post](https://v2.tauri.app/blog/tauri-2-0-0-release-candidate) — `TAURI_DEV_HOST` env var replaced `internal-ip` package in newer versions.

---

## 4. Anti-Patterns / Footguns

| Anti-Pattern | Problem | Correct Approach |
|--------------|---------|-----------------|
| `dangerousDisableAssetCspModification: true` (boolean) | Disables ALL CSP protection | Use list form or set specific directives only |
| `fs:read-all` / `fs:write-all` in production | Over-privileged filesystem access | Use scoped permissions per directory |
| `shell:allow-execute` without args validation | Arbitrary command injection | Always define `args` with `validator` regex |
| Using `#[cfg(feature = "custom-protocol")]` for prod detection | Deprecated feature | Use `#[cfg(not(dev))]` instead |
| `transparent: true` without understanding platform limits | Transparency not supported on Android/iOS window layer | Test on all target platforms |
| Skipping `devtools` feature check in release | Devtools exposed in release builds | Explicitly require `devtools` feature flag for release |
| Not using capabilities file | Inline permissions hard to audit | Use `capabilities/` directory with schema-validated JSON |
| Missing `pubkey` for updater | Updater cannot verify signatures | Always configure updater pubkey |
| Assuming desktop FS paths work on mobile | Mobile uses sandboxed directories | Use `$APPDATA`, `$APPCONFIG` path variables |
| `devCsp: null` without explicit CSP | Falls back to production CSP in dev | Set explicit `devCsp` if different from prod |
| Global exception handler swallowing errors | Silent failures cascade | Use `Result` types, propagate errors |

---

## 5. Source Map

### Official Documentation (v2.tauri.app)

| Topic | URL |
|-------|-----|
| Homepage | https://v2.tauri.app/ |
| Create Project | https://v2.tauri.app/start/create-project/ |
| Project Structure | https://v2.tauri.app/start/project-structure |
| Configuration Files | https://v2.tauri.app/develop/configuration-files/ |
| Reference Config | https://v2.tauri.app/reference/config/ |
| Window Customization | https://v2.tauri.app/learn/window-customization |
| System Tray | https://v2.tauri.app/learn/system-tray |
| Window Menu | https://v2.tauri.app/learn/window-menu |
| Security Capabilities | https://v2.tauri.app/security/capabilities |
| CSP | https://v2.tauri.app/security/csp/ |
| Isolation Pattern | https://v2.tauri.app/concept/inter-process-communication/isolation |
| Plugin Development | https://v2.tauri.app/develop/plugins/ |
| Sidecar | https://v2.tauri.app/develop/sidecar/ |
| FS Plugin | https://v2.tauri.app/plugin/file-system |
| Shell Plugin | https://v2.tauri.app/plugin/shell |
| Dialog Plugin | https://v2.tauri.app/plugin/dialog |
| HTTP Plugin | https://v2.tauri.app/plugin/http-client |
| Store Plugin | https://v2.tauri.app/plugin/store |
| Logging Plugin | https://v2.tauri.app/plugin/logging |
| Updater Plugin | https://v2.tauri.app/plugin/updater |
| macOS Signing | https://v2.tauri.app/distribute/sign/macos |
| Android Signing | https://v2.tauri.app/distribute/sign/android |
| App Store | https://v2.tauri.app/distribute/app-store |
| Testing | https://v2.tauri.app/develop/tests/ |
| Debug | https://v2.tauri.app/develop/debug/ |

### docs.rs (Rust API)

| Topic | URL |
|-------|-----|
| tauri 2.0.0 crate | https://docs.rs/tauri/2.0.0/tauri/ |
| Feature Flags | https://docs.rs/tauri/2.0.0/tauri/#cargo-features |
| IPC Module | https://docs.rs/tauri/2.0.0/tauri/ipc/ |
| Menu Module | https://docs.rs/tauri/2.0.0/tauri/menu/ |
| Tray Module | https://docs.rs/tauri/2.0.0/tauri/tray/ |

### GitHub Sources (upstream, for clarification)

| Topic | URL |
|-------|-----|
| tauri main repo | https://github.com/tauri-apps/tauri |
| tauri-docs repo | https://github.com/tauri-apps/tauri-docs |
| plugins-workspace | https://github.com/tauri-apps/plugins-workspace |
| API TypeScript package | https://github.com/tauri-apps/tauri/blob/dev/packages/api/src/core.ts |

---

## Appendix: Key Config Properties Quick Reference

### app.security

```json
{
  "assetProtocol": { "enable": false, "scope": [] },
  "capabilities": ["main-capability"],
  "csp": "default-src 'self'",
  "dangerousDisableAssetCspModification": false,
  "freezePrototype": true,
  "pattern": { "use": "brownfield" }
}
```

### bundle targets

- `"all"` — all platforms
- `"app"` — macOS .app bundle
- `"dmg"` — macOS DMG
- `"pkg"` — macOS PKG
- `"deb"` — Debian
- `"rpm"` — RedHat
- `"appimage"` — AppImage
- `"nsis"` — Windows NSIS
- `"msi"` — Windows MSI

---

*Artifact generated: 09.24_27-03-2026*
*Research scope: Tauri v2 official docs, docs.rs API, upstream GitHub sources*
