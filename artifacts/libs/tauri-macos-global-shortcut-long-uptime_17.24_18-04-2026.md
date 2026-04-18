## Findings: Tauri global shortcut / macOS long-uptime failure modes

### Direct Answer
- Fact: `tauri-plugin-global-shortcut` on Tauri v2 delegates macOS shortcut registration to the `global-hotkey` crate, and that crate uses Carbon `InstallEventHandler` + `RegisterEventHotKey` on `GetApplicationEventTarget()` for normal shortcuts, not `CGEventTap`; so the main Tauri shortcut path is **not** exposed to CGEventTap timeout-disable failure modes like `kCGEventTapDisabledByTimeout`. [plugins/global-shortcut/src/lib.rs#L75-L85](https://github.com/tauri-apps/plugins-workspace/blob/964e13f124ad1feeb93c10168b265dc4936f738c/plugins/global-shortcut/src/lib.rs#L75-L85) [src/platform_impl/macos/mod.rs#L43-L80](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L43-L80) [src/platform_impl/macos/mod.rs#L83-L139](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L83-L139) [1][2][3]
- Trace: The plugin forces register/unregister work onto Tauri’s main thread with `run_on_main_thread`, matching `global-hotkey`’s documented macOS requirement that the event loop and manager live on the main thread; the upstream code therefore already avoids the obvious wrong-thread / missing-main-runloop class of bugs. [plugins/global-shortcut/src/lib.rs#L75-L85](https://github.com/tauri-apps/plugins-workspace/blob/964e13f124ad1feeb93c10168b265dc4936f738c/plugins/global-shortcut/src/lib.rs#L75-L85) [global_hotkey index docs](https://docs.rs/global-hotkey/latest/global_hotkey/) [1][4]
- Fact: Upstream `global-hotkey` installs the Carbon event handler once in `GlobalHotKeyManager::new()` and removes it only in `Drop`; it does **not** contain any macOS wake/sleep, session-active, App Nap, or handler reinstallation logic. If the Carbon hotkey path stops delivering after a long-running OS state transition, upstream currently has no self-healing path. [src/platform_impl/macos/mod.rs#L43-L80](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L43-L80) [src/platform_impl/macos/mod.rs#L290-L300](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L290-L300) [2]
- Fact: The only `CGEventTap` in `global-hotkey`’s macOS backend is for media keys, and that code likewise adds the tap to the main run loop but has no handling for tap-disabled events or wake/session notifications. That is relevant only if the failing shortcut is a media key, not a normal key combination like `Command+Shift+X`. [src/platform_impl/macos/mod.rs#L196-L249](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L196-L249) [2]
- History: Apple DTS still describes `RegisterEventHotKey` as a viable system-wide hotkey mechanism, but not the preferred modern API; Apple staff explicitly prefers `CGEventTap` for new work because of TCC/Input Monitoring integration. That preference does not change the fact that Tauri’s current implementation is Carbon-based. [Apple Developer Forums thread 735223](https://developer.apple.com/forums/thread/735223) [5]
- Synthesis: For a Tauri v2 macOS shortcut that works initially and then dies only after long uptime until restart, upstream evidence supports two realistic buckets: **(a)** an OS/Carbon delivery break that upstream does not automatically recover from, or **(b)** an app-level lifecycle problem around sleep/wake/session transitions outside the plugin. Upstream evidence does **not** support blaming CGEventTap timeout/App Nap for ordinary non-media shortcuts, because that code path is not used for them. [1][2][3][5][6][7]

### Key Findings
#### Main Tauri v2 shortcut path on macOS

**Claim**: `tauri-plugin-global-shortcut` forwards macOS registration to `global-hotkey` and executes those calls on the main thread. [1]

**Evidence** ([plugins/global-shortcut/src/lib.rs#L75-L85](https://github.com/tauri-apps/plugins-workspace/blob/964e13f124ad1feeb93c10168b265dc4936f738c/plugins/global-shortcut/src/lib.rs#L75-L85) [1]):
```rust
macro_rules! run_main_thread {
    ($handle:expr, $manager:expr, |$m:ident| $ex:expr) => {{
        let (tx, rx) = std::sync::mpsc::channel();
        let manager = $manager.clone();
        let task = move || {
            let f = |$m: &GlobalHotKeyManager| $ex;
            let _ = tx.send(f(&*manager));
        };
        $handle.run_on_main_thread(task)?;
        rx.recv()?
    }};
}
```

**Explanation**: Every plugin register/unregister call is marshaled to the Tauri main thread before touching `global_hotkey::GlobalHotKeyManager`. That matches the backend’s threading contract rather than letting arbitrary worker threads manipulate macOS hotkeys.

- Trace: `register_internal` calls `m.0.register(shortcut)` inside that macro, so the Carbon registration path below is executed on the main thread. [plugins/global-shortcut/src/lib.rs#L89-L101](https://github.com/tauri-apps/plugins-workspace/blob/964e13f124ad1feeb93c10168b265dc4936f738c/plugins/global-shortcut/src/lib.rs#L89-L101) [1]
- Version scope: plugins-workspace `HEAD` = `964e13f124ad1feeb93c10168b265dc4936f738c` on 2026-04-18. [1]

#### Carbon lifecycle for ordinary shortcuts

**Claim**: Ordinary shortcuts use Carbon `InstallEventHandler` + `RegisterEventHotKey` against the application event target, and the handler stays installed for the manager lifetime. [2]

**Evidence** ([src/platform_impl/macos/mod.rs#L43-L80](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L43-L80) [2]):
```rust
pub fn new() -> crate::Result<Self> {
    let pressed_event_type = EventTypeSpec {
        eventClass: kEventClassKeyboard,
        eventKind: kEventHotKeyPressed,
    };
    let released_event_type = EventTypeSpec {
        eventClass: kEventClassKeyboard,
        eventKind: kEventHotKeyReleased,
    };

    let ptr = unsafe {
        let mut handler_ref: EventHandlerRef = std::mem::zeroed();
        let result = InstallEventHandler(
            GetApplicationEventTarget(),
            Some(hotkey_handler),
            2,
            event_types.as_ptr(),
            std::ptr::null_mut(),
            &mut handler_ref,
        );
```

**Explanation**: The manager installs one Carbon application-level event handler for hotkey pressed/released events when the manager is created.

**Evidence** ([src/platform_impl/macos/mod.rs#L98-L139](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L98-L139) [2]):
```rust
if let Some(scan_code) = key_to_scancode(hotkey.key) {
    let hotkey_id = EventHotKeyID {
        id: hotkey.id(),
        signature: { /* ... */ },
    };

    let ptr = unsafe {
        let mut hotkey_ref: EventHotKeyRef = std::mem::zeroed();
        let result = RegisterEventHotKey(
            scan_code,
            mods,
            hotkey_id,
            GetApplicationEventTarget(),
            0,
            &mut hotkey_ref,
        );
```

**Explanation**: Non-media hotkeys are registered directly with Carbon’s global hotkey API, using the same application event target as the installed handler.

- Trace: When Carbon fires the event, `hotkey_handler` pulls the `EventHotKeyID` out of the event and emits `GlobalHotKeyEvent::send(...)`, which the Tauri plugin maps back to the registered shortcut handler. [src/platform_impl/macos/mod.rs#L303-L337](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L303-L337) [src/plugins/global-shortcut/src/lib.rs#L415-L425](https://github.com/tauri-apps/plugins-workspace/blob/964e13f124ad1feeb93c10168b265dc4936f738c/plugins/global-shortcut/src/lib.rs#L415-L425) [1][2]
- Version scope: global-hotkey `HEAD` = `a7058be984c7d5dfa1efa711b7531d97b250926a` on 2026-04-18. [2]

#### No upstream recovery path for sleep/wake or session churn

**Claim**: The macOS Carbon path has no wake/session/App Nap recovery hooks; if delivery stops after long uptime, restart recreates the manager, handler, and hotkeys, but upstream does not do that automatically. [2]

**Evidence** ([src/platform_impl/macos/mod.rs#L290-L300](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L290-L300) [2]):
```rust
impl Drop for GlobalHotKeyManager {
    fn drop(&mut self) {
        let hotkeys = self.hotkeys.lock().unwrap().clone();
        for (_, hotkeywrapper) in hotkeys {
            let _ = self.unregister(hotkeywrapper.hotkey);
        }
        unsafe {
            RemoveEventHandler(self.event_handler_ptr);
        }
        self.stop_watching_media_keys()
    }
}
```

**Explanation**: The only explicit teardown/recreation seam is process lifetime. A restart reconstructs the manager and reinstalls the handler because `new()` runs again; upstream contains no comparable runtime reinit path triggered by wake, unlock, or session activation.

- Fact: Code search found no `NSWorkspaceDidWakeNotification`, `NSWorkspaceSessionDidBecomeActiveNotification`, `NSWorkspaceSessionDidResignActiveNotification`, or `App Nap` handling in `tauri-apps/global-hotkey`. [2]
- Caveat: Absence of those hooks proves missing recovery logic, not the exact OS root cause.

#### CGEventTap only affects media-key shortcuts here

**Claim**: `global-hotkey`’s `CGEventTapCreate` path is only used for media keys, so CGEventTap invalidation is relevant to Tauri only when the registered shortcut itself is a media key. [2]

**Evidence** ([src/platform_impl/macos/mod.rs#L140-L148](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L140-L148) [2]):
```rust
        } else if is_media_key(hotkey.key) {
            {
                let mut media_hotkeys = self.media_hotkeys.lock().unwrap();
                if !media_hotkeys.insert(hotkey) {
                    return Err(crate::Error::AlreadyRegistered(hotkey));
                }
            }
            self.start_watching_media_keys()
```

**Explanation**: The branch into `start_watching_media_keys()` is only taken when `is_media_key(hotkey.key)` is true.

**Evidence** ([src/platform_impl/macos/mod.rs#L204-L233](https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs#L204-L233) [2]):
```rust
let event_mask: CGEventMask = CGEventMaskBit!(CGEventType::SystemDefined);
let tap = CGEventTapCreate(
    CGEventTapLocation::Session,
    CGEventTapPlacement::HeadInsertEventTap,
    CGEventTapOptions::Default,
    event_mask,
    media_key_event_callback,
    Arc::into_raw(self.media_hotkeys.clone()) as *const c_void,
);
/* ... */
let run_loop = CFRunLoopGetMain();
CFRunLoopAddSource(run_loop, loop_source, kCFRunLoopCommonModes);
CGEventTapEnable(tap, true);
```

**Explanation**: This is a real session event tap on the main run loop, but it is scoped to media-key watching. There is no code here to handle disabled-tap callbacks or re-create the tap after wake/session churn.

- History: External macOS reports like Ghostty discussion `#11819` describe exactly that CGEventTap sleep/wake failure mode — taps stop after wake until manually re-enabled or recreated — but that pattern maps to the media-key path here, not ordinary Carbon hotkeys. [6]

#### Main-thread contract is explicit upstream

**Claim**: Upstream docs explicitly require a macOS main-thread event loop and creating the manager on the main thread, and the Tauri plugin design aligns with that contract. [4][1]

**Evidence** ([global_hotkey index docs](https://docs.rs/global-hotkey/latest/global_hotkey/) [4]):
```text
On macOS, an event loop must be running on the main thread so you also need to create the global hotkey manager on the main thread.
```

**Explanation**: This is the upstream contract for correctness on macOS. Since the Tauri plugin dispatches manager work onto the main thread, a long-uptime failure is less likely to be caused by obvious thread misuse in plugin code.

- Synthesis: If your app uses the official plugin in the standard way and the bug appears only after uptime/sleep/session churn, upstream evidence points away from a simple “registered on the wrong thread” explanation. [1][4]

#### Known macOS Carbon limitation relevant to user-configurable shortcuts

**Claim**: `RegisterEventHotKey` itself has known macOS-specific regressions unrelated to long uptime; one documented example is Option-only / Option+Shift shortcuts failing on macOS 15.0 for sandboxed apps. [7]

**Evidence** ([feedback-assistant/reports#552](https://github.com/feedback-assistant/reports/issues/552) [7]):
```text
Any sandboxed app that wants to support user customizable global keyboard shortcuts must use the old RegisterEventHotKey API. This works fine in macOS 14, but in macOS 15 final, keyboard shortcuts that only use Option or Option+Shift as modifiers no longer trigger the listener.
```

**Explanation**: This is not a long-uptime failure mode, but it matters when triaging “shortcut stopped working” reports because some accelerator shapes are OS-version-sensitive even when the app lifecycle is fine.

- History: The report is marked `Resolution: Fixed`, so this specific regression was fixed by Apple after macOS 15.0. [7]

### Execution Trace
| Step | Symbol / Artifact | What happens here | Source IDs |
|------|-------------------|-------------------|------------|
| 1 | `run_main_thread!` | Tauri plugin marshals manager calls to the macOS main thread | [1] |
| 2 | `GlobalHotKeyManager::new` | Installs Carbon pressed/released event handler on `GetApplicationEventTarget()` | [2] |
| 3 | `GlobalHotKeyManager::register` | Ordinary shortcuts call `RegisterEventHotKey(...)` against the application event target | [2] |
| 4 | `hotkey_handler` | Carbon event is decoded into `GlobalHotKeyEvent { id, state }` | [2] |
| 5 | `GlobalHotKeyEvent::set_event_handler` closure | Plugin looks up `e.id` in its shortcut map and invokes app/plugin handlers | [1] |
| 6 | `Drop for GlobalHotKeyManager` | Restart/teardown unregisters hotkeys and removes the Carbon event handler | [2] |

### Change Context
- History: Apple’s Carbon event manager docs describe `InstallEventHandler` and `RemoveEventHandler` as lifecycle pairs on an event target, and note that handlers persist until explicitly removed or the target is disposed. That matches `global-hotkey`’s one-install, one-remove lifecycle. [Carbon Event Manager Tasks](https://developer.apple.com/library/archive/documentation/Carbon/Conceptual/Carbon_Event_Manager/Tasks/CarbonEventsTasks.html) [3]
- History: Apple DTS says `RegisterEventHotKey` remains a valid background hotkey mechanism but recommends `CGEventTap` instead for modern TCC-aware designs. That is guidance for new implementations, not evidence that Tauri’s Carbon path is misimplemented. [5]
- History: No Tauri/global-hotkey upstream issue was found documenting a known long-uptime Carbon hotkey failure on macOS; the closest directly relevant external discussion found was Ghostty’s CGEventTap wake failure, which is adjacent but not the same API path. [6]

### Caveats and Gaps
- No upstream Tauri/global-hotkey issue was found that directly reproduces “Carbon hotkey works for hours then dies until restart” on macOS; absence of an issue is not proof the bug does not exist.
- The evidence proves missing recovery hooks for wake/session churn, but it does not prove Apple invalidates `RegisterEventHotKey` registrations after sleep or session switches; that exact OS behavior would need a minimal native repro or Apple documentation.
- App Nap was investigated only through upstream code search. No `App Nap` handling exists in the relevant repos, but no primary Apple source was found tying Carbon `RegisterEventHotKey` delivery loss to App Nap.
- If the affected shortcut is a media key, re-evaluate the CGEventTap branch; that path has a materially different failure surface than ordinary shortcuts.

### Source Register
| ID | Kind | Source | Version / Ref | Why kept | URL |
|----|------|--------|---------------|----------|-----|
| [1] | code | `tauri-plugin-global-shortcut` plugin implementation | plugins-workspace `964e13f124ad1feeb93c10168b265dc4936f738c` | Shows main-thread marshaling and plugin event dispatch path | https://github.com/tauri-apps/plugins-workspace/blob/964e13f124ad1feeb93c10168b265dc4936f738c/plugins/global-shortcut/src/lib.rs |
| [2] | code | `global-hotkey` macOS backend | global-hotkey `a7058be984c7d5dfa1efa711b7531d97b250926a` | Decisive implementation of Carbon hotkeys, media-key event tap, and teardown lifecycle | https://github.com/tauri-apps/global-hotkey/blob/a7058be984c7d5dfa1efa711b7531d97b250926a/src/platform_impl/macos/mod.rs |
| [3] | docs | Apple Carbon Event Manager Tasks | Documentation archive, retired doc | Primary contract/lifecycle doc for `InstallEventHandler` / `RemoveEventHandler` behavior | https://developer.apple.com/library/archive/documentation/Carbon/Conceptual/Carbon_Event_Manager/Tasks/CarbonEventsTasks.html |
| [4] | docs | `global-hotkey` docs.rs page | crate `0.7.0` | States main-thread event-loop contract on macOS | https://docs.rs/global-hotkey/latest/global_hotkey/ |
| [5] | docs | Apple Developer Forums thread 735223 | Aug 2023 | Apple DTS guidance comparing `RegisterEventHotKey` with `CGEventTap` | https://developer.apple.com/forums/thread/735223 |
| [6] | secondary | Ghostty discussion `#11819` | Mar–Apr 2026 | Concrete macOS long-running failure pattern for CGEventTap after sleep/wake; relevant contrast with Carbon path | https://github.com/ghostty-org/ghostty/discussions/11819 |
| [7] | issue | Feedback Assistant report `#552` | macOS 15.0 regression, opened 2024-09-18 | Primary evidence of an Apple-side `RegisterEventHotKey` regression affecting some modifiers | https://github.com/feedback-assistant/reports/issues/552 |
