# Tauri v2 Vanilla HTML/JS Frontend Research

**Date:** 20.25_26-03-2026  
**Source:** Official Tauri v2 Documentation ([v2.tauri.app](https://v2.tauri.app/))

---

## 1. Static HTML Files as `frontendDist` / Dev Frontend

**Claim:** A Tauri v2 app can use static HTML files directly as `frontendDist` without a bundler.

**Evidence** ([Configuration Reference - Tauri v2](https://v2.tauri.app/reference/config/)):

> "When a path relative to the configuration file is provided, it is read recursively and all files are embedded in the application binary. Tauri then looks for an `index.html` and serves it as the default entry point for your application."

**Explanation:** Tauri acts as a static web host. You point `frontendDist` at a folder containing HTML, CSS, and JS files. Tauri embeds all files recursively and serves `index.html` as the entry point. No bundler is required for the frontend.

**Minimal `tauri.conf.json` for static HTML:**
```json
{
  "build": {
    "frontendDist": "../ui"
  },
  "app": {
    "withGlobalTauri": true
  }
}
```

**Directory structure expected:**
```
.
├── src-tauri/
│   ├── tauri.conf.json
│   └── src/
└── ui/
    ├── index.html
    ├── styles.css
    └── script.js
```

---

## 2. Accessing Tauri JS APIs in Vanilla JS Without Bundler

**Claim:** Tauri v2 supports accessing JS APIs from vanilla JS via `window.__TAURI__` global injection (when `withGlobalTauri` is enabled). The v2 API structure is `window.__TAURI__.core` and `window.__TAURI__.event`.

**Evidence** ([GitHub Discussion #11511 - Migrating to 2.0 with plain javascript](https://github.com/orgs/tauri-apps/discussions/11511)):

User 0xflux confirmed working v2 vanilla JS syntax:
```javascript
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
```

**Evidence** ([create-tauri-app Issue #48](https://github.com/tauri-apps/create-tauri-app/issues/48)):

> "To Use tauri APIs, enable `withGlobalTauri` in `tauri.conf.json` and use it in js"
> ```js
> // all
> const { invoke } = window.__TAURI__.core;
> ```

**Evidence** ([Tauri Event API docs](https://v2.tauri.app/reference/javascript/api/namespaceevent)):

> "This package is also accessible with `window.__TAURI__.event` when `app.withGlobalTauri` in `tauri.conf.json` is set to `true`."

**Configuration needed in `tauri.conf.json`:**
```json
{
  "app": {
    "withGlobalTauri": true
  }
}
```

**Three approaches to access Tauri APIs:**

| Approach | Setup Required | Use Case |
|----------|---------------|----------|
| **Global injection** | Set `withGlobalTauri: true` | Vanilla JS, no npm, no bundler |
| **ES module import** | npm install `@tauri-apps/api` + bundler | Modern JS with Vite/webpack |
| **Asset pipeline** | Copy API files to frontendDist manually | No npm, manual asset management |

**Important for v2:** The API namespace changed from v1:
- v1: `window.__TAURI__.tauri.invoke()`
- v2: `window.__TAURI__.core.invoke()`

---

## 3. Is Adding a Bundler Like Vite Recommended?

**Claim:** Tauri officially recommends Vite for most projects, especially for SPA frameworks, but it's not strictly required. Vanilla JS/TS without a bundler is supported.

**Evidence** ([Frontend Configuration - Tauri v2](https://v2.tauri.app/start/frontend/)):

> "For most projects we recommend Vite for SPA frameworks such as React, Vue, Svelte, and Solid, **but also for plain JavaScript or TypeScript projects**."

**Evidence** ([Vite Guide - Tauri v2](https://v2.tauri.app/start/frontend/vite/)):

Tauri provides explicit Vite integration instructions with `beforeDevCommand`, `beforeBuildCommand`, and `devUrl` configuration.

**When a bundler is recommended:**
- React, Vue, Svelte, Solid, or other SPA frameworks
- TypeScript projects needing compilation
- Projects using npm packages that require bundling
- Mobile development (requires dev server on internal IP)

**When you can skip the bundler:**
- Pure static HTML/CSS/JS with no npm dependencies
- Simple apps that don't need module imports
- Projects where you manually manage dependencies

**Vite is recommended but not required.** The documentation states frameworks "may work with Tauri with no additional configuration needed."

---

## 4. CSP Implications

**Claim:** CSP is disabled by default in Tauri v2 (`csp: null`). When enabled, it restricts resource loading and requires special handling for inline scripts (hashes/nonces are auto-appended by Tauri at compile time). Vanilla JS without a bundler must work within CSP constraints if CSP is enabled.

**Evidence** ([Content Security Policy - Tauri v2](https://v2.tauri.app/security/csp/)):

> "CSP protection is only enabled if set on the Tauri configuration file."
> 
> "Local scripts are hashed, styles and external scripts are referenced using a cryptographic nonce, which prevents unallowed content from being loaded."
>
> "At compile time, Tauri appends its nonces and hashes to the relevant CSP attributes automatically to bundled code and assets, so you only need to worry about what is unique to your application."

**Default behavior (CSP disabled):**
```json
{
  "security": {
    "csp": null
  }
}
```

**Example CSP configuration from Tauri API example:**
```json
{
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
```

**CSP Implications for Vanilla JS:**

| Scenario | CSP Disabled (`null`) | CSP Enabled |
|----------|----------------------|-------------|
| Inline `<script>` tags | Work normally | Must use external JS files (inline blocked) |
| External JS files | Work normally | Must be from allowed origins |
| Dynamic `eval()` | Works | Blocked by default |
| `unsafe-inline` for styles | N/A | May need `'unsafe-inline'` for CSS-in-JS |

**Important:** When CSP is enabled and you use vanilla JS without a bundler:
- All `<script src="...">` must be in your `frontendDist` folder
- Tauri auto-hashes local scripts at compile time
- External script loads must be explicitly allowed in CSP

**CSP and `withGlobalTauri`:** No conflict - global injection works with or without CSP.

---

## Summary

| Question | Answer |
|----------|--------|
| **Static HTML as frontendDist?** | ✅ YES — point `frontendDist` at a folder with `index.html` |
| **Access Tauri APIs in vanilla JS?** | ✅ YES — enable `withGlobalTauri`, use `window.__TAURI__.core` |
| **Bundler required?** | ❌ NO — but Vite is recommended for most projects |
| **CSP implications?** | CSP is OFF by default; when ON, inline scripts blocked, local scripts auto-hashed |

---

## Key Configuration Files

**`src-tauri/tauri.conf.json` (minimal vanilla JS setup):**
```json
{
  "build": {
    "frontendDist": "../ui"
  },
  "app": {
    "withGlobalTauri": true,
    "security": {
      "csp": null
    }
  }
}
```

**`src-tauri/capabilities/default.json` (permissions):**
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

---

## References

- [Tauri v2 Frontend Configuration](https://v2.tauri.app/start/frontend/)
- [Tauri v2 Configuration Reference](https://v2.tauri.app/reference/config/)
- [Tauri v2 Content Security Policy](https://v2.tauri.app/security/csp/)
- [GitHub: create-tauri-app vanilla JS template issue](https://github.com/tauri-apps/create-tauri-app/issues/48)
- [GitHub Discussion #11511: Plain JS with window.__TAURI__ in v2](https://github.com/orgs/tauri-apps/discussions/11511)
- [Tauri v2 Event API (global access)](https://v2.tauri.app/reference/javascript/api/namespaceevent)
- [Tauri v2 Vite Integration](https://v2.tauri.app/start/frontend/vite/)
