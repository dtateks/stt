# macOS NSWindowCollectionBehavior Flags for Fullscreen/All-Spaces HUD Windows

**Date**: 28-03-2026
**Project**: Voice to Text (Tauri v2)
**Topic**: Correct `NSWindowCollectionBehavior` flags for a transparent floating HUD that must appear above fullscreen apps and across all Spaces

---

## Executive Summary

**Current code** in [lib.rs:71-74](https://github.com/DTA-TEKS/dev-stt/blob/main/src/src/lib.rs#L71-L74) combines:

```rust
let collection_behavior = ns_window.collectionBehavior()
    | NSWindowCollectionBehavior::CanJoinAllSpaces
    | NSWindowCollectionBehavior::FullScreenAuxiliary
    | NSWindowCollectionBehavior::MoveToActiveSpace;
```

**Problem**: `CanJoinAllSpaces` and `MoveToActiveSpace` are **mutually exclusive** within the Spaces collection behavior group. Apple explicitly states: *"Only one of these options may be used at a time."*

**Recommended fix**: Replace `MoveToActiveSpace` with `Stationary`.

---

## Apple Documentation Evidence

### 1. Spaces Collection Behavior — Mutually Exclusive Group

**Source**: [Apple Developer Documentation Archive — Setting Window Collection Behavior](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/WinPanel/Articles/SettingWindowCollectionBehavior.html)

> *"There are three options that can be set for a window's Spaces collection behavior... Only one of these options may be used at a time."*

| Constant | Behavior |
|----------|----------|
| `NSWindowCollectionBehaviorDefault` | Associated with one space at a time |
| `NSWindowCollectionBehaviorCanJoinAllSpaces` | Appears on **all** spaces (like menu bar) |
| `NSWindowCollectionBehaviorMoveToActiveSpace` | Switches to active space when made active |

**Conclusion**: `CanJoinAllSpaces + MoveToActiveSpace` is an **invalid combination**.

### 2. fullScreenAuxiliary Flag

**Source**: [Apple Developer Documentation — fullScreenAuxiliary](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary)

> *"The window displays on the same space as the full screen window."*

### 3. canJoinAllSpaces Flag

**Source**: [Apple Developer Documentation — canJoinAllSpaces](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces)

> *"The window can appear in all spaces. The menu bar behaves this way."*

### 4. stationary Flag (Exposé Behavior — Separate Group)

**Source**: [Apple Developer Documentation — NSWindowCollectionBehaviorStationary](https://developer.apple.com/documentation/appkit/nswindowcollectionbehavior/nswindowcollectionbehaviorstationary)

> *"The window is unaffected by Exposé — i.e. it stays visible and does not move, like the desktop window."*

This belongs to the **Exposé collection behavior group** (separate from Spaces group), so it can be freely combined with Spaces flags.

---

## Real-World Tauri Implementations (Evidence)

### BongoCat (ayangweb/BongoCat) — Working HUD

**Source**: [src-tauri/src/core/setup/macos.rs](https://github.com/ayangweb/BongoCat/blob/master/src-tauri/src/core/setup/macos.rs)

```rust
panel.set_collection_behaviour(
    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
);
```

### ovim (tonisives/ovim) — Floating Indicator

**Source**: [src-tauri/src/window/indicator.rs](https://github.com/tonisives/ovim/blob/main/src-tauri/src/window/indicator.rs)

```rust
ns_window.setCollectionBehavior_(
    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
);
```

### screenpipe — Panel with `IgnoresCycle` Added

**Source**: [apps/screenpipe-app-tauri/src-tauri/src/commands.rs](https://github.com/screenpipe/screenpipe/blob/main/apps/screenpipe-app-tauri/src-tauri/src/commands.rs#L1057)

```rust
panel.set_collection_behaviour(
    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle |
    NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
);
```

---

## Flag Groups Summary

| Group | Flags | Mutually Exclusive Within Group? |
|-------|-------|----------------------------------|
| **Spaces** | `Default`, `CanJoinAllSpaces`, `MoveToActiveSpace` | ✅ Yes — pick ONE |
| **Exposé** | `Managed`, `Transient`, `Stationary` | ✅ Yes — pick ONE |
| **Window Cycling** | `ParticipatesInCycle`, `IgnoresCycle` | ✅ Yes — pick ONE |
| **Full Screen** | `FullScreenAuxiliary`, `FullScreenPrimary` | ⚠️ Can combine |

---

## Recommended Configuration for Tauri HUD

```rust
// CURRENT (BROKEN):
| NSWindowCollectionBehavior::CanJoinAllSpaces
| NSWindowCollectionBehavior::FullScreenAuxiliary
| NSWindowCollectionBehavior::MoveToActiveSpace;  // ❌ CONFLICT with CanJoinAllSpaces

// RECOMMENDED:
| NSWindowCollectionBehavior::CanJoinAllSpaces
| NSWindowCollectionBehavior::FullScreenAuxiliary
| NSWindowCollectionBehavior::Stationary;  // ✅ Works with CanJoinAllSpaces
```

**Optional addition** (based on screenpipe): Add `IgnoresCycle` to exclude from window cycling:

```rust
| NSWindowCollectionBehavior::CanJoinAllSpaces
| NSWindowCollectionBehavior::FullScreenAuxiliary
| NSWindowCollectionBehavior::Stationary
| NSWindowCollectionBehavior::IgnoresCycle;
```

---

## Official Apple Documentation Links

| Flag | URL |
|------|-----|
| `NSWindow.CollectionBehavior` overview | https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct |
| `canJoinAllSpaces` | https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces |
| `fullScreenAuxiliary` | https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary |
| `stationary` | https://developer.apple.com/documentation/appkit/nswindowcollectionbehavior/nswindowcollectionbehaviorstationary |
| `moveToActiveSpace` | https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior/1419120-movetoactivespace |
| Legacy doc (Spaces/Exposé groups) | https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/WinPanel/Articles/SettingWindowCollectionBehavior.html |

---

## Conclusion

1. **Do not combine `CanJoinAllSpaces` with `MoveToActiveSpace`** — they are mutually exclusive Spaces behaviors
2. **Use `Stationary` instead of `MoveToActiveSpace`** — it belongs to the Exposé group and does not conflict
3. **The combination `CanJoinAllSpaces + Stationary + FullScreenAuxiliary` is valid** and used by working Tauri HUD implementations (BongoCat, ovim)
4. **Window level** (`NSStatusWindowLevel` = 25) and `setHidesOnDeactivate(false)` are already correctly set in the current code
