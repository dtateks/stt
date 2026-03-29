# tauri-plugin-global-shortcut v2: Handler Accumulation and Unregister Behavior

**Timestamp**: 22.06_28-03-2026
**Commit**: fdd7a8e6a0d86de0caaacbdd11d717620c180e81

---

## 1. Decisive Answers

| Question | Answer |
|----------|--------|
| Does `on_shortcut(shortcut, handler)` accumulate handlers when called repeatedly? | **NO** — Handlers are **replaced**, not accumulated |
| Does `unregister(shortcut)` remove the handler callback or only unregister the accelerator? | **Removes BOTH** — The entire `RegisteredShortcut` entry (shortcut + handler) is removed from the HashMap |

---

## 2. Evidence

### Evidence A: `on_shortcut` Replaces Handlers (Does Not Accumulate)

**Source**: [src/lib.rs lines 89-102](https://github.com/tauri-apps/tauri-plugin-global-shortcut/blob/fdd7a8e6a0d86de0caaacbdd11d717620c180e81/src/lib.rs#L89-L102)

```rust
fn register_internal<F: Fn(&AppHandle<R>, &Shortcut, ShortcutEvent) + Send + Sync + 'static>(
    &self,
    shortcut: Shortcut,
    handler: Option<F>,
) -> Result<()> {
    let id = shortcut.id();
    let handler = handler.map(|h| Arc::new(Box::new(h) as HandlerFn<R>));
    run_main_thread!(self.app, self.manager, |m| m.0.register(shortcut))?;
    self.shortcuts
        .lock()
        .unwrap()
        .insert(id, RegisteredShortcut { shortcut, handler });  // <-- HashMap::insert REPLACES
    Ok(())
}
```

**Explanation**: `self.shortcuts` is a `HashMap<HotKeyId, RegisteredShortcut<R>>` (line 72). The `insert` method on HashMap **overwrites** any existing entry with the same key. Since `shortcut.id()` is a deterministic `u32` derived from `(mods.bits() << 16) | key as u32` (see [hotkey.rs line 97](https://github.com/tauri-apps/global-hotkey/blob/main/src/hotkey.rs#L97)), the same shortcut string always produces the same ID.

**Consequence**: Calling `on_shortcut("Ctrl+C", handler1)` then `on_shortcut("Ctrl+C", handler2)` replaces handler1 with handler2. The OS-level registration happens only on the first call (the second call skips it because the shortcut is already registered at the OS level).

---

### Evidence B: `unregister` Removes Both Shortcut AND Handler

**Source**: [src/lib.rs lines 182-190](https://github.com/tauri-apps/tauri-plugin-global-shortcut/blob/fdd7a8e6a0d86de0caaacbdd11d717620c180e81/src/lib.rs#L182-L190)

```rust
/// Unregister a shortcut
pub fn unregister<S: TryInto<ShortcutWrapper>>(&self, shortcut: S) -> Result<()>
where
    S::Error: std::error::Error,
{
    let shortcut = try_into_shortcut(shortcut)?;
    run_main_thread!(self.app, self.manager, |m| m.0.unregister(shortcut))?;  // OS-level unregister
    self.shortcuts.lock().unwrap().remove(&shortcut.id());  // <-- REMOVES entry from HashMap
    Ok(())
}
```

**Explanation**: Two operations occur:
1. `m.0.unregister(shortcut)` — Unregisters the accelerator from the OS-level global hotkey system
2. `.remove(&shortcut.id())` — Removes the `RegisteredShortcut` entry (which contains both the shortcut and its handler) from the internal HashMap

**Evidence C**: Shortcut ID Determinism (proves overwrite semantics)

**Source**: [global-hotkey/src/hotkey.rs lines 51-59, 97](https://github.com/tauri-apps/global-hotkey/blob/main/src/hotkey.rs#L51-L59)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct HotKey {
    pub mods: Modifiers,
    pub key: Code,
    pub id: u32,  // <-- derived from mods + key
}

impl HotKey {
    pub fn new(mods: Option<Modifiers>, key: Code) -> Self {
        let mut mods = mods.unwrap_or_else(Modifiers::empty);
        // ...
        Self {
            mods,
            key,
            id: (mods.bits() << 16) | key as u32,  // <-- deterministic ID
        }
    }
}
```

The test at [hotkey.rs lines 467-474](https://github.com/tauri-apps/global-hotkey/blob/main/src/hotkey.rs#L467-L474) confirms:
```rust
assert!(h1.id() == h2.id() && h2.id() == h3.id());  // Same shortcut = same ID
```

---

## 3. Recommended Correct Pattern for Dynamically Changing a Single Active Shortcut

### The Problem with Naive Approach

```rust
// WRONG: Handler gets orphaned at OS level, new handler replaces old one silently
global_shortcut.on_shortcut("Ctrl+C", handler1);
global_shortcut.on_shortcut("Ctrl+C", handler2);  // handler1 is dropped, but OS still has shortcut registered
```

### Correct Pattern: Unregister First, Then Register New

```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// 1. Unregister the OLD shortcut (removes both OS registration and handler)
if global_shortcut.is_registered("Ctrl+C") {
    global_shortcut.unregister("Ctrl+C")?;
}

// 2. Register the NEW shortcut with the NEW handler
global_shortcut.on_shortcut("Ctrl+V", move |app, shortcut, event| {
    if event.state == ShortcutState::Pressed {
        // New behavior
    }
})?;
```

### Rust: Helper Function for Dynamic Shortcut Replacement

```rust
/// Dynamically replaces a shortcut's handler.
/// If `old_shortcut` is registered, unregisters it first.
/// Then registers `new_shortcut` with the provided handler.
fn replace_shortcut<R: Runtime>(
    global_shortcut: &GlobalShortcut<R>,
    old_shortcut: &str,
    new_shortcut: &str,
    handler: impl Fn(&AppHandle<R>, &Shortcut, ShortcutEvent) + Send + Sync + 'static,
) -> Result<()> {
    // Unregister old if exists
    if global_shortcut.is_registered(old_shortcut) {
        global_shortcut.unregister(old_shortcut)?;
    }
    // Register new
    global_shortcut.on_shortcut(new_shortcut, handler)
}
```

### JavaScript/TypeScript: Same Pattern

```typescript
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

async function replaceShortcut(oldShortcut: string, newShortcut: string, handler: (event: any) => void) {
  // Unregister old if exists
  try {
    await unregister(oldShortcut);
  } catch (e) {
    // Ignore if not registered
  }
  
  // Register new
  await register(newShortcut, handler);
}

// Usage
await replaceShortcut('CommandOrControl+C', 'CommandOrControl+V', (event) => {
  if (event.state === 'Pressed') {
    console.log('New shortcut triggered');
  }
});
```

---

## Summary

| Behavior | Verdict |
|----------|---------|
| `on_shortcut` repeated with same shortcut | **Replaces** handler (HashMap insert semantics) |
| `unregister` effect | **Removes both** shortcut registration and handler from internal state |
| Dynamic shortcut change | **Must call `unregister(old)` first**, then `on_shortcut(new, handler)` |
