# Global Cursor Position in Tauri v2 macOS Background App

## Problem

`app.cursor_position()` in Tauri/tao uses `NSEvent.mouseLocation` internally, which only tracks events delivered to the app's windows. When the app is background/unfocused (e.g., triggered by a global shortcut from another app), no events are delivered, so `cursor_position()` returns an error, causing the HUD to fall back to the primary monitor.

**Evidence** ([lib.rs:232](file:///Users/dta.teks/dev/stt/src/src/lib.rs#L232)):
```rust
let monitor_from_cursor = app.cursor_position().ok().and_then(|cursor| {
    app.monitor_from_point(cursor.x, cursor.y)
        .ok()
        .and_then(|monitor| monitor)
});
```

## Solution: CGEventSource.absoluteMouseLocation()

**Why this works**: `CGEventSource` reads mouse position directly from the HID subsystem, independent of app focus. It works even when your app is background.

### Required Import

The `core-graphics` crate is already a transitive dependency of Tauri. No new dependencies needed.

### Minimal Rust Snippet

```rust
#[cfg(target_os = "macos")]
fn get_global_mouse_location() -> Option<(f64, f64)> {
    use std::mem::MaybeUninit;
    
    // CGEventSourceGlobalCoordinates struct:
    // typedef struct { double x; double y; } CGEventSourceGlobalCoordinates;
    #[repr(C)]
    struct CGEventSourceGlobalCoordinates {
        x: f64,
        y: f64,
    }
    
    // kCGEventSourceLocation = CGEventSourceRef -> get absoluteMouseLocation
    // We use CGEventSourceCreate with kCGEventSourceIDHIDSystemPrimary
    let event_source: ::core_graphics::CGEventSource = unsafe {
        ::core_graphics::CGEventSource::from_id(::core_graphics::CGEventSourceID::from_raw(0))
    };
    
    let location = event_source.absolute_mouse_location().ok()?;
    Some((location.x, location.y))
}
```

**Alternative via NSEvent (simpler but must be called on main thread)**:

```rust
#[cfg(target_os = "macos")]
fn get_global_mouse_location_via_nsevent() -> Option<(f64, f64)> {
    use objc2::msg_send;
    use objc2::foundation::NSPoint;
    use objc2::AppKit::NSEvent;
    
    let point: NSPoint = unsafe { msg_send![NSEvent::class(), mouseLocation] };
    Some((point.x, point.y))
}
```

## Coordinate Space Conversion

**Critical difference**:

| System | Y=0 origin | Notes |
|--------|-------------|-------|
| macOS screen coords (CGEvent/NSEvent) | **Bottom-left** of primary display | Increasing Y goes **up** |
| Tauri `monitor_from_point()` | **Top-left** of virtual screen | Increasing Y goes **down** |

### Conversion Required

Before passing to `app.monitor_from_point(x, y)`, you must flip Y:

```rust
#[cfg(target_os = "macos")]
fn tauri_cursor_position() -> Option<(i32, i32)> {
    use core_graphics::display::CGDisplay::main;
    
    let location = get_global_mouse_location()?;
    
    // Get primary display height for Y flip
    let display_height = unsafe { main().screen_size().height };
    
    // Flip Y from bottom-left origin (macOS) to top-left origin (Tauri)
    let x = location.0 as i32;
    let y = (display_height - location.1) as i32;
    
    Some((x, y))
}
```

## Updated position_bar_window_bottom_center

Replace the fallback logic with:

```rust
pub(crate) fn position_bar_window_bottom_center(
    app: &AppHandle,
    bar_window: &WebviewWindow,
) -> tauri::Result<()> {
    // Try global mouse location first (works in background)
    let monitor_from_cursor = tauri_cursor_position()
        .and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten());

    let monitor = match monitor_from_cursor {
        Some(monitor) => Some(monitor),
        None => app.primary_monitor()?,  // fallback
    };
    // ... rest unchanged
}

#[cfg(target_os = "macos")]
fn tauri_cursor_position() -> Option<(i32, i32)> {
    use core_graphics::display::CGDisplay::main;
    use core_graphics::CGEventSource::from_id;
    
    let location = unsafe {
        from_id(core_graphics::CGEventSourceID::from_raw(0))
            .absolute_mouse_location()
            .ok()?
    };
    
    let display_height = unsafe { main().screen_size().height };
    let x = location.x as i32;
    let y = (display_height - location.y) as i32;
    
    Some((x, y))
}
```

## Key Findings

1. **Why cursor_position fails in background**: `NSEvent.mouseLocation` only updates when events are delivered to app windows. Background apps receive no events.

2. **Correct API**: `CGEventSource.absoluteMouseLocation()` reads HID subsystem directly, works regardless of focus.

3. **Coordinate flip**: macOS Y=0 at **bottom-left**, Tauri Y=0 at **top-left**. Must flip before `monitor_from_point()`.

4. **No new dependencies**: `core_graphics` is a transitive dependency of Tauri; already available via `tauri` crate re-export.

## References

- [CGEventSource documentation](https://developer.apple.com/documentation/coregraphics/cgeventsource)
- [CGEventSource.absoluteMouseLocation()](https://developer.apple.com/documentation/coregraphics/cgeventsource/1454430-absolute_mouse_location)
- [Coordinate system notes](https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Architecture/Architecture.html)
