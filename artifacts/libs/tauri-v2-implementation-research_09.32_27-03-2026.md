# Tauri v2 Implementation Research Artifact

**Research Date**: 27-03-2026
**Scope**: Tauri v2 official documentation + upstream sources
**Purpose**: Reusable skill for Tauri v2 implementation patterns

---

## 1. Permission Architecture Quick Map

### Capability File Location & Structure

**Path**: `src-tauri/capabilities/{identifier}.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": ["core:default", "fs:default"]
}
```

**Key concepts**:
- **Capability** = grouping/boundary mechanism for IPC access control
- **Permission** = explicit privilege description for commands
- **Scope** = granular allow/deny rules within a permission
- **Deny supersedes allow** — if a path/url is in both allow and deny, deny wins

### Core Concepts

| Concept | Purpose | File Location |
|---------|---------|---------------|
| Capability | Isolates access per window/platform | `src-tauri/capabilities/*.json` |
| Permission | Enables specific commands | `capabilities` array + `permissions/` dir |
| Scope | Restricts access to specific resources | Inside permission objects |
| Default capability | Fallback for unmatched windows | `src-tauri/capabilities/default.json` |

### Window/Platform Scoping

```json
{
  "identifier": "main-capability",
  "windows": ["main", "settings"],
  "platforms": ["linux", "windows"],
  "permissions": ["fs:default"]
}
```

### Permission Identifier Format

```
{plugin-prefix}:{action}[-{subaction}]
```

| Prefix | Plugin | Example Permission |
|--------|--------|-------------------|
| `core:` | Tauri core | `core:window:allow-minimize` |
| `fs:` | file-system | `fs:allow-read-text-file` |
| `shell:` | shell | `shell:allow-execute` |
| `http:` | http-client | `http:default` |
| `sql:` | sql | `sql:allow-execute` |
| `dialog:` | dialog | `dialog:default` |
| `notification:` | notification | `notification:default` |
| `clipboard-manager:` | clipboard-manager | `clipboard-manager:default` |
| `store:` | store | `store:default` |
| `log:` | log | `log:default` |
| `process:` | process | `process:default` |
| `os:` | os | `os:default` |
| `updater:` | updater | `updater:default` |
| `positioner:` | positioner | `positioner:default` |
| `opener:` | opener | `opener:default` |
| `deep-link:` | deep-linking | `deep-link:default` |

### Default Permission Set

Tauri 2.0 introduces `core:default` which grants all core default permissions:

```json
{
  "permissions": ["core:default"]
}
```

### Path Variables (FS Scope)

| Variable | Resolves To |
|----------|-------------|
| `$HOME` | User home directory |
| `$APPDATA` | App data directory |
| `$APPLOCALDATA` | Local app data |
| `$RESOURCE` | Bundled resources |
| `$TEMP` | Temp directory |
| `$DESKTOP` | Desktop directory |
| `$DOCUMENT` | Documents directory |
| `$DOWNLOAD` | Downloads directory |

---

## 2. Plugin Matrix

### Plugin: `fs` (File System)

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/file-system/ |
| **When to use** | Read/write files, directory operations, file metadata |
| **Capability prefix** | `fs:` |
| **Common footgun** | Path traversal prevention blocks `..` in paths; unscoped permissions require explicit allow array |
| **Mobile notes** | Desktop only; no mobile support |
| **Desktop notes** | MSI/NSIS perMachine mode requires admin for some paths |

**Permission scope structure**:
```json
{
  "identifier": "fs:allow-read-text-file",
  "allow": [{ "path": "$APPDATA/*" }],
  "deny": [{ "path": "$APPDATA/secret/*" }]
}
```

**Security**: Module prevents path traversal — paths like `/usr/path/to/../file` or `../path/to/file` are rejected.

---

### Plugin: `shell`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/shell/ |
| **When to use** | Spawn child processes, execute sidecars, open URLs |
| **Capability prefix** | `shell:` |
| **Common footgun** | Sidecar args must match exactly; `args: true` allows all args; missing sidecar binary fails silently |
| **Mobile notes** | Only `shell:allow-open` supported (open URLs); process spawning not available |
| **Desktop notes** | Full sidecar + execute support |

**Sidecar configuration**:
```json
{
  "identifier": "shell:allow-execute",
  "allow": [
    {
      "name": "binaries/my-sidecar",
      "sidecar": true,
      "args": ["arg1", "-a", { "validator": "\\S+" }]
    }
  ]
}
```

**Security**: Args validator uses regex; args must be passed in exact order defined.

---

### Plugin: `http`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/http-client/ |
| **When to use** | REST API calls, fetch with Tauri context |
| **Capability prefix** | `http:` |
| **Common footgun** | All URLs blocked by default; must explicitly allow domains in capability |
| **Mobile notes** | Supported |
| **Desktop notes** | Supported |

**URL scope structure**:
```json
{
  "identifier": "http:default",
  "allow": [{ "url": "https://*.tauri.app" }],
  "deny": [{ "url": "https://private.tauri.app" }]
}
```

**Security**: URL scope uses allow/deny lists; supports wildcard patterns.

---

### Plugin: `sql`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/sql/ |
| **When to use** | SQLite, MySQL, PostgreSQL databases |
| **Capability prefix** | `sql:` |
| **Common footgun** | Connection strings in JS expose credentials; must enable features in Cargo.toml (`--features sqlite\|mysql\|postgres`); SQL injection if using string concatenation |
| **Mobile notes** | SQLite works; MySQL/PostgreSQL require network |
| **Desktop notes** | All drivers supported |

**Setup**:
```toml
# Cargo.toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

```json
{
  "plugins": {
    "sql": {
      "preload": ["sqlite:mydatabase.db"]
    }
  }
}
```

**Security**: Parameterized queries required (`$1`, `$2` for SQLite/Postgres; `?` for MySQL); never interpolate user input.

---

### Plugin: `dialog`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/dialog/ |
| **When to use** | Native file open/save dialogs, message boxes |
| **Capability prefix** | `dialog:` |
| **Common footgun** | Does not support folder picker |
| **Mobile notes** | Supported (native dialogs) |
| **Desktop notes** | Full support |

---

### Plugin: `notification`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/notification/ |
| **When to use** | System notifications |
| **Capability prefix** | `notification:` |
| **Common footgun** | Must check/request permission before sending; mobile requires runtime permission request |
| **Mobile notes** | Requires runtime permission request via plugin |
| **Desktop notes** | Works if notification permission granted |

**Permission flow (mobile)**:
```javascript
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
let granted = await isPermissionGranted();
if (!granted) {
  const result = await requestPermission();
  granted = result === 'granted';
}
```

---

### Plugin: `store`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/store/ |
| **When to use** | Persistent key-value settings storage |
| **Capability prefix** | `store:` |
| **Common footgun** | Values must be JSON-serializable; `autoSave: false` requires manual `store.save()` |
| **Mobile notes** | Supported |
| **Desktop notes** | Supported |

---

### Plugin: `log`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/logging/ |
| **When to use** | Application logging, Rust-in-JS console |
| **Capability prefix** | `log:` |
| **Common footgun** | Default target is file; Webview console requires explicit `Target::new(TargetKind::Webview)` config |
| **Mobile notes** | Supported |
| **Desktop notes** | Supported |

---

### Plugin: `updater`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/updater/ |
| **When to use** | Auto-update application from server |
| **Capability prefix** | `updater:` |
| **Common footgun** | Signing is mandatory (cannot be disabled); losing private key = cannot publish updates; pubkey rotation requires careful planning |
| **Mobile notes** | Supported |
| **Desktop notes** | Supported |

**Configuration**:
```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "-----BEGIN PUBLIC KEY-----...",
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

**Security**: Signature verification cannot be disabled; store private key securely.

---

### Plugin: `clipboard-manager`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/clipboard/ |
| **When to use** | Read/write system clipboard |
| **Capability prefix** | `clipboard-manager:` |
| **Common footgun** | Mobile clipboard APIs differ; on mobile may need platform-specific handling |
| **Mobile notes** | Supported but different APIs |
| **Desktop notes** | Full support |

---

### Plugin: `positioner`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/positioner/ |
| **When to use** | Position window at screen corners/edges |
| **Capability prefix** | `positioner:` |
| **Common footgun** | Tray-relative positions require `tray-icon` feature in Cargo.toml |
| **Mobile notes** | Not supported (mobile apps don't have floating windows) |
| **Desktop notes** | Full support |

---

### Plugin: `process`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/process/ |
| **When to use** | Exit app, relaunch app |
| **Capability prefix** | `process:` |
| **Common footgun** | Replaced deprecated `tauri::api::process` in v1 |
| **Mobile notes** | Supported (exit only, no relaunch) |
| **Desktop notes** | Full support |

---

### Plugin: `os`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/os-info/ |
| **When to use** | OS platform, version, arch info |
| **Capability prefix** | `os:` |
| **Common footgun** | Returns host OS info, not target OS when cross-compiling |
| **Mobile notes** | Supported |
| **Desktop notes** | Supported |

---

### Plugin: `opener` / `deep-link`

| Attribute | Detail |
|-----------|--------|
| **Official URL** | https://v2.tauri.app/plugin/deep-linking/ |
| **When to use** | Custom URL schemes, deep links |
| **Capability prefix** | `opener:`, `deep-link:` |
| **Common footgun** | Desktop uses `schemes` array in config; mobile uses `appLink` for universal links |
| **Mobile notes** | Supports custom schemes + universal links |
| **Desktop notes** | Custom URI schemes only |

**Desktop config**:
```json
{
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["my-app", "custom-protocol"]
      }
    }
  }
}
```

---

## 3. Platform Caveats Matrix

### Window / Webview APIs

| Feature | Desktop | Mobile | Notes |
|---------|---------|--------|-------|
| **System tray** | ✅ | ❌ | Tray events on Linux not supported |
| **Menu bar** | ✅ | N/A | Native menu not available on mobile |
| **Transparent titlebar** | ✅ macOS | N/A | Requires `TitleBarStyle::Transparent` |
| **Custom titlebar** | ✅ | ❌ | `decorations: false` + drag region |
| **Multiwebview** | ⚠️ Behind flag | ❌ | Behind `unstable` Cargo feature |
| **Always-on-top** | ✅ | ❌ | Mobile windows are always full-screen |
| **Window positioning** | ✅ | ❌ | Use positioner plugin on desktop |

### Multiwebview Status

> "Tauri v2 introduces multiwebview support currently behind an `unstable` feature flag."

```toml
# Cargo.toml - must enable feature
[dependencies]
tauri = { version = "2", features = ["unstable-multiwebview"] }
```

**Renamed APIs in v2**:
- `Window` → `WebviewWindow`
- `WindowBuilder` → `WebviewWindowBuilder`
- `WindowUrl` → `WebviewUrl`
- `get_window` → `get_webview_window`
- `parent_window` → `parent_raw`

### Tray Limitations

| Platform | Tray Icon | Tray Events | Context Menu |
|----------|-----------|-------------|-------------|
| macOS | ✅ | ✅ | ✅ |
| Windows | ✅ | ✅ | ✅ |
| Linux | ✅ | ❌ | ✅ (right-click only) |
| iOS | ❌ | ❌ | ❌ |
| Android | ❌ | ❌ | ❌ |

### Mobile Plugin Support

**Supported on mobile** (official plugins):
- `notification` — with runtime permission
- `dialog`
- `clipboard-manager`
- `deep-link` / `opener`
- `store`
- `sql` (SQLite only typically)
- `http`
- `os`
- `process` (exit only)
- `log`

**NOT available on mobile**:
- `fs` — use plugin with scoped paths or resource access
- `shell` (execute/sidecar)
- `updater`
- `positioner`
- System tray/menu

> "Not all desktop features and plugins are ported to mobile yet, but production-ready mobile applications can be developed with Tauri now." — Tauri Blog

---

## 4. Safe Wording for Reusable Skill

### Capability Setup

- **ALWAYS** define permissions in `src-tauri/capabilities/`. Default capability is `default.json`.
- **ALWAYS** use `core:default` as baseline, then add plugin permissions.
- **ALWAYS** scope fs paths explicitly: `allow: [{ path: "$APPDATA/*" }]`
- **REMEMBER**: deny supersedes allow in scope evaluation

### FS Plugin

- Path traversal is blocked — no `..` or absolute paths outside scope
- Use path variables (`$APPDATA`, `$HOME`, etc.) for portability
- Apps installed via MSI/NSIS in perMachine mode require admin privileges

### Shell Plugin

- Sidecar binary name must match path in `binaries/` directory
- Args must be declared in capability; `args: true` allows any args
- Dynamic args require regex validator: `{ "validator": "\\S+" }`
- `shell:allow-open` is the only shell permission available on mobile

### HTTP Plugin

- ALL URLs blocked by default — must explicitly allow domains
- Use wildcard patterns: `https://*.domain.com`
- Deny takes precedence when URL matches both allow and deny

### SQL Plugin

- Enable driver features in Cargo.toml: `--features sqlite` (or mysql, postgres)
- Use parameterized queries ONLY: `$1`, `$2` (SQLite/Postgres) or `?` (MySQL)
- Never interpolate user input into SQL strings
- Connection strings may expose credentials — use environment variables

### Updater Plugin

- Signing is MANDATORY — cannot be disabled
- Store private key securely; losing it means no future updates
- Key rotation is complex — plan ahead
- Pubkey set in `tauri.conf.json`; private key via env var `TAURI_SIGNING_PRIVATE_KEY`

### Notification Plugin (Mobile)

- Must request permission at runtime before sending
- Check `isPermissionGranted()` first, then `requestPermission()` if needed

### Window/Webview

- Multiwebview behind unstable flag — API may change
- Tray only on desktop; tray events not supported on Linux
- Mobile apps always full-screen — no window positioning
- Custom titlebar requires `decorations: false` + drag region CSS

### Distribution

| Platform | Installer | Code Signing | Store |
|----------|-----------|--------------|-------|
| **macOS** | DMG, PKG | Developer ID + notarization | App Store (PKG + altool) |
| **Windows** | NSIS, MSI | EV code signing recommended | Optional |
| **Linux** | AppImage, deb, rpm | None required | Flathub |
| **Android** | AAB, APK | keystore signing | Google Play |
| **iOS** | IPA | Apple Developer cert + provisioning profile | App Store |

**macOS signing**:
```bash
# Sign DMG
xcrun productbuild --sign "Developer ID" --component "app.app" /Applications app.dmg

# Upload to App Store
xcrun altool --upload-app --type macos --file app.pkg --apiKey $KEY --apiIssuer $ISSUER
```

**Android signing**:
```bash
# Generate keystore
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload

# Build AAB
npm run tauri android build -- --aab
```

**iOS requirements**:
- Apple Developer Program ($99/year)
- Code signing certificate (Apple Distribution)
- Provisioning profile linking cert + app ID
- Bundle identifier registered in App Store Connect

---

## 5. Official Documentation URLs

| Resource | URL |
|----------|-----|
| Main docs | https://v2.tauri.app/ |
| Capabilities | https://v2.tauri.app/security/capabilities/ |
| Permissions | https://v2.tauri.app/security/permissions/ |
| Command Scopes | https://v2.tauri.app/security/scope/ |
| FS plugin | https://v2.tauri.app/plugin/file-system/ |
| Shell plugin | https://v2.tauri.app/plugin/shell/ |
| HTTP plugin | https://v2.tauri.app/plugin/http-client/ |
| SQL plugin | https://v2.tauri.app/plugin/sql/ |
| Dialog plugin | https://v2.tauri.app/plugin/dialog/ |
| Notification plugin | https://v2.tauri.app/plugin/notification/ |
| Store plugin | https://v2.tauri.app/plugin/store/ |
| Log plugin | https://v2.tauri.app/plugin/logging/ |
| Updater plugin | https://v2.tauri.app/plugin/updater/ |
| Clipboard plugin | https://v2.tauri.app/plugin/clipboard/ |
| Positioner plugin | https://v2.tauri.app/plugin/positioner/ |
| Process plugin | https://v2.tauri.app/plugin/process/ |
| OS plugin | https://v2.tauri.app/plugin/os-info/ |
| Deep-link plugin | https://v2.tauri.app/plugin/deep-linking/ |
| Plugin workspace | https://github.com/tauri-apps/plugins-workspace |

---

*Research synthesized from official Tauri v2 documentation at v2.tauri.app, official plugin docs, and Tauri GitHub organization sources.*
