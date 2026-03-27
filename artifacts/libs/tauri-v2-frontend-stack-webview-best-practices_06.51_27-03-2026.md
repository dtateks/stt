# Tauri v2 Frontend/UI Stack & WebView Best Practices

**Research Date:** 27-03-2026  
**Source:** Official Tauri v2 Documentation (v2.tauri.app) + upstream examples

---

## TL;DR Decision Matrix

| Scenario | Recommendation |
|----------|----------------|
| Simple tool, minimal UI, fast startup | **Plain HTML/CSS/JS** with Vite |
| Rich interactions, state management needed | **React/Vue/Svelte** + Vite |
| Team knows a specific framework | **That framework** (Tauri is agnostic) |
| SSR-dependent meta-framework (Next.js/Nuxt) | **Static export mode only** |
| Untrusted third-party content in WebView | **Isolation Pattern** |

---

## 1. Stack Choice: Plain Web Stack vs Frameworks

### Official Guidance

Tauri is **frontend-agnostic** and supports most frameworks out of the box. From the official [Frontend Configuration docs](https://v2.tauri.app/start/frontend/):

> "Tauri is frontend agnostic and supports most frontend frameworks out of the box. However, sometimes a framework needs a bit of extra configuration to integrate with Tauri."

**Recommendation from official docs:** For most projects, **Vite is recommended** for SPA frameworks such as React, Vue, Svelte, and Solid, but also for plain JavaScript or TypeScript projects.

### When Plain HTML/CSS/JS Is the Right Choice

- [Microservices/CLI tools with minimal UI](https://v2.tauri.app/start/frontend/#javascript)
- Maximum bundle size sensitivity
- Simple forms, notifications, system tray menus
- Existing plain web stack you want to wrap

**Evidence:** The official `create-tauri-app` scaffold includes a Vanilla template as the first option, showing Tauri considers plain web stacks a first-class choice.

### When a Framework Is Justified

- Complex state management (multi-step forms, real-time updates)
- Component reuse across views
- Team already proficient in a framework
- Need for ecosystem (routing, data fetching libs)
- [SvelteKit/Next.js/Nuxt](https://v2.tauri.app/start/frontend/sveltekit) for static export mode works well

**Key Constraint:** Tauri does NOT support server-based solutions. If using a meta-framework, you MUST use static export/SPA mode:

> "Use static site generation (SSG), single-page applications (SPA), or classic multi-page apps (MPA). Tauri does not natively support server based alternatives (such as SSR)." — [Frontend Configuration](https://v2.tauri.app/start/frontend/)

### Framework-Specific Configuration Guides

| Framework | Guide | Key Constraint |
|-----------|-------|----------------|
| **Vite** | [v2.tauri.app/start/frontend/vite](https://v2.tauri.app/start/frontend/vite) | Recommended for all |
| **React** | Works out of the box with Vite | Use Vite, not CRA |
| **Vue** | Works out of the box with Vite | SFC supported |
| **Svelte** | Works out of the box with Vite | SvelteKit uses static adapter |
| **Next.js** | [v2.tauri.app/start/frontend/nextjs](https://v2.tauri.app/start/frontend/nextjs) | Must set `output: 'export'` |
| **SvelteKit** | [v2.tauri.app/start/frontend/sveltekit](https://v2.tauri.app/start/frontend/sveltekit) | Must use `adapter-static`, disable SSR |
| **Angular** | Works out of the box with Vite | — |

---

## 2. Invoke/Event Bridge Usage

### The invoke() Pattern (Frontend → Rust)

**Evidence:** [Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust)

Commands are defined with `#[tauri::command]` attribute and registered via `generate_handler!`:

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn my_custom_command(arg: String) -> Result<String, String> {
    Ok(format!("Processed: {}", arg))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![my_custom_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Frontend calling convention:**
```typescript
import { invoke } from '@tauri-apps/api/core';

const result = await invoke('my_custom_command', { arg: 'hello' });
```

**Key Rules from official docs:**
1. Arguments must be JSON objects with **camelCase keys** (Rust uses snake_case)
2. Commands can be `async` for heavy operations
3. Errors should implement `serde::Serialize` for typed error handling
4. Group commands in separate modules to avoid bloating `lib.rs`

**Organizing commands (official best practice):**
```rust
// src-tauri/src/commands.rs
#[tauri::command]
pub fn my_command() { /* ... */ }

// src-tauri/src/lib.rs
mod commands;

tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![commands::my_command])
```

### The Event System (Rust → Frontend)

**Evidence:** [Calling the Frontend from Rust](https://v2.tauri.app/develop/calling-frontend)

Use events for **push notifications, streaming data, multi-consumer patterns**:

```rust
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn start_download(app: AppHandle, url: String) {
    app.emit("download-started", &url).unwrap();
}
```

**Frontend listening:**
```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen('download-started', (event) => {
    console.log('Download started:', event.payload);
});

// Cleanup when done
unlisten();
```

**Key differences from commands:**
| Aspect | Commands (`invoke`) | Events |
|--------|---------------------|--------|
| Direction | Frontend → Rust | Rust → Frontend |
| Type safety | Strong (serde) | Weak (JSON strings) |
| Return values | Yes | No |
| Latency | Lower | Higher (eval under hood) |
| Use case | Request/response | Streaming, pub/sub |

### Channels (High-Throughput Streaming)

For **low-latency, ordered data** (file transfers, WebSocket proxying, progress streams), use Channels instead of events:

```rust
use tauri::{AppHandle, ipc::Channel};

#[tauri::command]
async fn upload(app: AppHandle, url: String, on_progress: Channel<f64>) {
    // Stream progress via channel
    on_progress.send(0.5).unwrap();
}
```

```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

const onProgress = new Channel<number>();
onProgress.onmessage = (event) => {
    console.log('Progress:', event.payload);
};

await invoke('upload', { url, onProgress });
```

---

## 3. Minimizing Frontend Complexity

### Security Model: Deny by Default

Tauri v2 uses a **"Deny by Default" security philosophy**. From the [Oflight security analysis](https://www.oflight.co.jp/en/columns/tauri-v2-security-model):

> "Unlike traditional Electron applications where the Node.js environment is fully exposed, allowing malicious code unrestricted access to the file system and network, Tauri v2 fundamentally solves this problem by implementing a strict permission management system based on the Principle of Least Privilege."

### Capabilities System

**Evidence:** [Capability Configuration](https://v2.tauri.app/ja/reference/config)

Capabilities isolate access to the IPC layer per window/webview:

```json
// src-tauri/capabilities/main.json
{
    "identifier": "main-user-files-write",
    "description": "Allows main window to write to user-selected files",
    "windows": ["main"],
    "permissions": [
        "core:default",
        "dialog:open",
        { "identifier": "fs:allow-write-text-file", "allow": [{ "path": "$HOME/test.txt" }] }
    ],
    "platforms": ["macOS", "windows"]
}
```

**Best Practice:** Keep capabilities to the absolute minimum. Each permission is a potential attack vector.

### Content Security Policy (CSP)

**Evidence:** [Configure Content Security Policy (CSP)](https://v2.tauri.app/security/csp/)

CSP is **mandatory** in Tauri v2 for WebView security. Default configuration from official docs:

```json
// tauri.conf.json
{
    "app": {
        "security": {
            "csp": {
                "default-src": "'self' customprotocol: asset:",
                "connect-src": "ipc: http://ipc.localhost",
                "font-src": ["https://fonts.gstatic.com"],
                "img-src": "'self' asset: http://asset.localhost blob: data:",
                "style-src": "'unsafe-inline' 'self' https://fonts.googleapis.com"
            }
        }
    }
}
```

**Key rules:**
- Default prohibits inline script execution
- `eval()` and dynamic code generation are blocked
- External scripts require nonces/hashes (auto-injected by Tauri at compile time)
- Avoid `unsafe-inline` and `unsafe-eval` unless absolutely necessary

**DO:**
```json
"script-src": "'self'"
```

**DON'T:**
```json
"script-src": "'unsafe-inline'"  // Only if MUST for legacy code
```

### Isolation Pattern (for Untrusted Content)

**Evidence:** [Isolation Pattern](https://v2.tauri.app/concept/inter-process-communication/isolation/)

When running **untrusted third-party content** in the WebView (e.g., plugins, ads, user-provided HTML), use the Isolation Pattern:

```json
// tauri.conf.json
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

The isolation app intercepts ALL IPC messages before they reach Tauri Core, allowing validation:

```javascript
// dist-isolation/index.js
window.__TAURI_ISOLATION_HOOK__ = (payload) => {
    // Validate IPC input here
    // Reject/modify if invalid
    return payload;
}
```

**Use isolation when:**
- Loading user-provided or third-party HTML/JS
- Using packages from untrusted npm sources
- Running plugin systems

---

## 4. Security Checklist

### From Official Security Docs + Analysis

| Priority | Practice | Evidence |
|----------|----------|----------|
| **Critical** | Configure strict CSP | [v2.tauri.app/security/csp](https://v2.tauri.app/security/csp/) |
| **Critical** | Use minimal Capabilities | [v2.tauri.app/ja/reference/config](https://v2.tauri.app/ja/reference/config) |
| **Critical** | Enable Isolation for untrusted content | [v2.tauri.app/concept/inter-process-communication/isolation](https://v2.tauri.app/concept/inter-process-communication/isolation/) |
| **High** | Set `dangerousDisableAssetCspModification` only when needed | [v2.tauri.app/fr/reference/config](https://v2.tauri.app/fr/reference/config) |
| **High** | Use `freezePrototype` in prod | [v2.tauri.app/fr/reference/config](https://v2.tauri.app/fr/reference/config) |
| **High** | Validate all IPC inputs on Rust side | [v2.tauri.app/develop/calling-rust](https://v2.tauri.app/develop/calling-rust) |
| **Medium** | Run `cargo audit` for Rust deps | External tool |
| **Medium** | Run `npm audit` for JS deps | External tool |

### HTTP Headers for Cross-Origin Isolation

For SharedArrayBuffer and other features requiring cross-origin isolation:

```typescript
// vite.config.ts (for Vite-based projects)
export default defineConfig({
    server: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        }
    }
})
```

---

## 5. Project Structure Recommendation

### For Your Existing Plain HTML/CSS/JS App

```
voice-to-text/           # or your app name
├── src/                  # Plain web frontend (HTML/CSS/JS)
│   ├── index.html
│   ├── styles/
│   └── scripts/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── lib.rs       # Main entry + command registration
│   │   ├── commands.rs  # Your commands
│   │   ├── tray.rs      # Tray logic
│   │   └── ...
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
│       └── main.json
├── package.json
└── vite.config.ts       # Only if you adopt Vite for dev server
```

**You do NOT need to migrate to React/Vue/Svelte.** Wrap your existing plain web stack with Tauri. The only requirement is a way to serve the app (plain files or Vite dev server).

### With Vite (Recommended for Dev Experience)

Even for plain HTML/CSS/JS, Vite provides:
- Faster dev server with HMR
- Better production bundling
- Standardized config with Tauri CLI integration

```json
// package.json scripts
{
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri"
}
```

```json
// tauri.conf.json
{
    "build": {
        "beforeDevCommand": "npm run dev",
        "beforeBuildCommand": "npm run build",
        "devUrl": "http://localhost:5173",
        "frontendDist": "../dist"
    }
}
```

---

## 6. Key Anti-Patterns (From Official Docs)

| Anti-Pattern | Correct Approach |
|--------------|------------------|
| Using SSR mode with Next.js/Nuxt | Use `output: 'export'` or static adapter |
| Bypassing Capabilities | Always define minimal Capabilities |
| Using `unsafe-inline` in CSP | Avoid; Tauri auto-injects nonces |
| Loading remote scripts | Bundle locally or use CSP to block |
| Calling Tauri APIs from untrusted content | Use Isolation Pattern |
| Massive `lib.rs` with all commands | Split into `commands/` module |
| camelCase/snake_case mismatch | invoke args use camelCase, Rust uses snake_case |

---

## 7. References

| Resource | URL |
|----------|-----|
| Frontend Configuration | https://v2.tauri.app/start/frontend/ |
| Vite Guide | https://v2.tauri.app/start/frontend/vite |
| Next.js Guide | https://v2.tauri.app/start/frontend/nextjs |
| SvelteKit Guide | https://v2.tauri.app/start/frontend/sveltekit |
| Calling Rust from Frontend | https://v2.tauri.app/develop/calling-rust |
| Calling Frontend from Rust | https://v2.tauri.app/develop/calling-frontend |
| CSP Configuration | https://v2.tauri.app/security/csp/ |
| Isolation Pattern | https://v2.tauri.app/concept/inter-process-communication/isolation/ |
| Capability Reference | https://v2.tauri.app/ja/reference/config |
| Security Config | https://v2.tauri.app/fr/reference/config |
| Tauri v2 Security Analysis | https://www.oflight.co.jp/en/columns/tauri-v2-security-model |

---

*Generated for voice-to-text app architecture decisions. For specific implementation questions, refer to the official Tauri v2 docs or ask about particular integration patterns.*
