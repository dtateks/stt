# Global Mouse Location on macOS via core-graphics

## Cargo.toml Dependency

```toml
core-graphics = "0.23"
```

## Complete Rust Implementation (Edition 2021)

```rust
use core_graphics::event::{CGEvent, CGEventTapLocation};
use core_graphics::geometry::CGPoint;

/// Returns the current global mouse position in **screen coordinates** (top-left origin).
///
/// # Coordinate System
/// - **Origin**: Top-left corner of the primary display
/// - **X**: Increases rightward
/// - **Y**: Increases **downward** (standard screen coordinates, NOT Cartesian)
///
/// For a bottom-left origin (Y increases upward), use `get_mouse_location_unflipped()`.
///
/// # Tauri Background Usage
/// When running as a background Tauri command, this does NOT require the app to be
/// focused. The returned coordinates are absolute screen coordinates that can be
/// compared directly against monitor bounds from `core_graphics::display::CGDisplay`.
///
/// # Example — Determine Which Monitor the Mouse Is On
/// ```ignore
/// use core_graphics::display::{CGDisplay, CGMainDisplayID, CGDirectDisplayID};
///
/// fn active_monitor_for_mouse() -> Option<CGDirectDisplayID> {
///     let point = get_mouse_location();
///     let displays = CGDisplay::all_displays();
///     for display in displays {
///         let bounds = display.bounds();
///         if point.x >= bounds.origin.x
///             && point.x < bounds.origin.x + bounds.size.width
///             && point.y >= bounds.origin.y
///             && point.y < bounds.origin.y + bounds.size.height
///         {
///             return Some(display.id());
///         }
///     }
///     None
/// }
/// ```
pub fn get_mouse_location() -> CGPoint {
    // CGEventCreate(null) returns the current mouse state without needing a source event
    let event = CGEvent::new(CGEventTapLocation::HIDSystemState, None)
        .expect("CGEvent::new failed");
    event.location()
}

/// Returns the current global mouse position with bottom-left origin (unflipped).
///
/// # Coordinate System
/// - **Origin**: Bottom-left corner of the primary display
/// - **X**: Increases rightward
/// - **Y**: Increases **upward** (Cartesian-style)
///
/// Use this when you need standard Cartesian coordinates for comparing against
/// display bounds that also use bottom-left origin.
pub fn get_mouse_location_unflipped() -> CGPoint {
    let event = CGEvent::new(CGEventTapLocation::HIDSystemState, None)
        .expect("CGEvent::new failed");
    event.unflipped_location()
}
```

## Lower-level FFI Alternative (without core-graphics event wrapper)

If you prefer raw FFI without the `core-graphics` event wrapper:

```rust
use core_graphics::geometry::CGPoint;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const std::ffi::c_void) -> *mut core_graphics::sys::CGEvent;
    fn CGEventGetLocation(event: *const core_graphics::sys::CGEvent) -> CGPoint;
    fn CGEventSourceButtonState(stateID: u32, button: u32) -> bool;
    fn CFRelease(cf: *const std::ffi::c_void);
}

/// Returns the global mouse cursor position.
/// Pass `None` as source to get current mouse state without creating a specific event.
pub fn get_mouse_location_raw() -> Option<CGPoint> {
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let point = CGEventGetLocation(event);
        CFRelease(event as *const std::ffi::c_void);
        Some(point)
    }
}
```

## Monitor Detection Helper (full working example)

```rust
use core_graphics::display::{CGDisplay, CGMainDisplayID, CGDirectDisplayID};
use core_graphics::geometry::{CGPoint, CGRect};

pub struct Monitor {
    pub id: CGDirectDisplayID,
    pub bounds: CGRect,
}

impl Monitor {
    /// Returns all displays with the mouse cursor over them (may be multiple for mirrored screens).
    pub fn displays_at_mouse() -> Vec<Monitor> {
        let point = get_mouse_location(); // top-left origin
        let all = CGDisplay::all_displays();
        all.into_iter()
            .filter(|d| {
                let b = d.bounds();
                // Strict containment check
                point.x >= b.origin.x
                    && point.x < b.origin.x + b.size.width
                    && point.y >= b.origin.y
                    && point.y < b.origin.y + b.size.height
            })
            .map(|d| Monitor { id: d.id(), bounds: d.bounds() })
            .collect()
    }

    /// Returns the primary display containing the mouse.
    pub fn primary_at_mouse() -> Option<Monitor> {
        let point = get_mouse_location();
        let main = CGDisplay::main().id();
        let displays = CGDisplay::all_displays();
        
        for d in displays {
            let b = d.bounds();
            if point.x >= b.origin.x
                && point.x < b.origin.x + b.size.width
                && point.y >= b.origin.y
                && point.y < b.origin.y + b.size.height
            {
                return Some(Monitor { id: d.id(), bounds: b });
            }
        }
        None
    }
}

fn get_mouse_location() -> CGPoint {
    use core_graphics::event::{CGEvent, CGEventTapLocation};
    CGEvent::new(CGEventTapLocation::HIDSystemState, None)
        .expect("CGEvent::new failed")
        .location()
}
```

## Key Facts

| Aspect | Detail |
|--------|--------|
| **Crate** | `core-graphics = "0.23"` |
| **Returns** | `CGPoint { x: f64, y: f64 }` |
| **Origin** | Top-left of primary display |
| **Y-axis direction** | Increases **downward** |
| **Background operation** | Works in Tauri background context |
| **Permission required** | None for reading current position (writing requires Accessibility) |
| **Primary monitor** | `CGDisplay::main()` from `core_graphics::display` |

## Coordinate System Diagram

```
TOP-LEFT ORIGIN (CGEventGetLocation / event.location()):

(0,0) ──────────────────────→ X+
  │
  │   Primary Display
  │
  │         ●(x, y)  ← mouse
  │
  ▼
  Y+
  (increases downward)


BOTTOM-LEFT ORIGIN (CGEventGetUnflippedLocation / event.unflipped_location()):

Y+
(increases upward)
  │
  │         ●(x, y)  ← mouse
  │
  │   Primary Display
  │
  ▼
(0,0) ──────────────────────→ X+
```

## Tauri Command Registration

To expose this as a Tauri command in your `src-tauri/src/commands.rs`:

```rust
use core_graphics::event::{CGEvent, CGEventTapLocation};
use core_graphics::geometry::CGPoint;

#[tauri::command]
fn get_mouse_position() -> Result<CGPoint, String> {
    let event = CGEvent::new(CGEventTapLocation::HIDSystemState, None)
        .map_err(|e| e.to_string())?;
    Ok(event.location())
}

#[tauri::command]
fn get_mouse_position_unflipped() -> Result<CGPoint, String> {
    let event = CGEvent::new(CGEventTapLocation::HIDSystemState, None)
        .map_err(|e| e.to_string())?;
    Ok(event.unflipped_location())
}
```

Register in your Tauri app's `lib.rs` or `main.rs` as normal. The command works from the background window without requiring the app to be focused.