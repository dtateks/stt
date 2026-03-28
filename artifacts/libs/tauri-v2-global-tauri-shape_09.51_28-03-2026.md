# Tauri v2.10.x `window.__TAURI__` Global Shape with `app.withGlobalTauri = true`

## Summary

When `app.withGlobalTauri = true` in `tauri.conf.json`, the Tauri v2.10.x runtime exposes a bundled global object at `window.__TAURI__`. This is NOT a direct `window.__TAURI__.core.invoke` path — the modules are exposed as **top-level namespace properties**.

## Confirmed API Paths

### `invoke` — `window.__TAURI__.core.invoke`

**Evidence** ([packages/api/src/core.ts#L8](https://github.com/tauri-apps/tauri/blob/e5b00795/packages/api/src/core.ts#L8)):
```typescript
/**
 * Invoke your custom commands.
 *
 * This package is also accessible with `window.__TAURI__.core` when [`app.withGlobalTauri`](https://v2.tauri.app/reference/config/#withglobaltauri) in `tauri.conf.json` is set to `true`.
 */
```

**Real usage** from Tauri bench ([bench/tests/cpu_intensive/public/site.js#L22](https://github.com/tauri-apps/tauri/blob/e5b00795/bench/tests/cpu_intensive/public/site.js#L22)):
```javascript
window.__TAURI__.core.invoke('app_completed_successfully')
```

### `event.listen` — `window.__TAURI__.event.listen`

**Evidence** ([packages/api/src/event.ts#L6](https://github.com/tauri-apps/tauri/blob/e5b00795/packages/api/src/event.ts#L6)):
```typescript
/**
 * The event system allows you to emit events to the backend and listen to events from it.
 *
 * This package is also accessible with `window.__TAURI__.event` when [`app.withGlobalTauri`](https://v2.tauri.app/reference/config/#withglobaltauri) in `tauri.conf.json` is set to `true`.
 */
```

### Usage Example from Official Docs

```javascript
// When withGlobalTauri: true, you can use:
const { event, window: tauriWindow, path } = window.__TAURI__;

// event.listen is the global event listener
await window.__TAURI__.event.listen('my-event', (ev) => {
  console.log(ev.payload);
});

// invoke Rust commands
await window.__TAURI__.core.invoke('my_command', { arg: 'value' });
```

## Complete `window.__TAURI__` Module Surface

From the bundled script `crates/tauri/scripts/bundle.global.js`, the runtime exposes these modules as top-level properties:

| Module | Path |
|--------|------|
| `app` | `window.__TAURI__.app` |
| `core` | `window.__TAURI__.core` |
| `dpi` | `window.__TAURI__.dpi` |
| `event` | `window.__TAURI__.event` |
| `image` | `window.__TAURI__.image` |
| `menu` | `window.__TAURI__.menu` |
| `mocks` | `window.__TAURI__.mocks` |
| `path` | `window.__TAURI__.path` |
| `tray` | `window.__TAURI__.tray` |
| `webview` | `window.__TAURI__.webview` |
| `webviewWindow` | `window.__TAURI__.webviewWindow` |
| `window` | `window.__TAURI__.window` |

## Key Finding: `window.__TAURI__.core` NOT `window.__TAURI__.core.invoke` as a property

The `invoke` function is a **method on the `core` module object**, not a top-level property. So:

- ✅ `window.__TAURI__.core.invoke('cmd')` — **CORRECT**
- ❌ `window.__TAURI__.invoke` — **WRONG** (does not exist)
- ❌ `window.__TAURI__.core.invoke` — **WRONG** if you're checking for existence of `invoke` as a property path

## Important Timing Note

From [GitHub issue #12990](https://github.com/tauri-apps/tauri/issues/12990), there is a known bug where `window.__TAURI__` may be `undefined` while executing top-level scripts (before `window.onload` completes). The global API is injected via `with_initialization_script` but code at top-level of `<script>` tags may run before the global is available.

## Configuration Reference

```json
{
  "app": {
    "withGlobalTauri": true
  }
}
```

See: [Tauri v2 Config — withGlobalTauri](https://v2.tauri.app/reference/config/#withglobaltauri)

## Commit SHA Used
`e5b00795c226c4d44f7b47257eb8982bd73b1025` (Tauri `dev` branch as of research date)
