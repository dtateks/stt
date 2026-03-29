# objc2-app-kit AppKit API Reference for macOS Tauri

**Research date:** 18.03_29-03-2026  
**Source:** [docs.rs/objc2-app-kit@0.3.2](https://docs.rs/objc2-app-kit/0.3.2/objc2_app_kit/) + [source](https://docs.rs/objc2-app-kit/0.3.2/src/objc2_app_kit/generated/NSWorkspace.rs.html) + [NSRunningApplication source](https://docs.rs/objc2-app-kit/0.3.2/src/objc2_app_kit/generated/NSRunningApplication.rs.html)

---

## 1. NSWorkspace.sharedWorkspace + frontmostApplication

**Evidence** ([NSWorkspace.rs lines 48-50, 295-298](https://docs.rs/objc2-app-kit/0.3.2/src/objc2_app_kit/generated/NSWorkspace.rs.html#48-50)):

```rust
// sharedWorkspace - class method (no &self)
extern_methods!(
    #[unsafe(method(sharedWorkspace))]
    #[unsafe(method_family = none)]
    pub fn sharedWorkspace() -> Retained<NSWorkspace>;

    // frontmostApplication - instance method on NSWorkspace
    #[cfg(feature = "NSRunningApplication")]
    #[unsafe(method(frontmostApplication))]
    #[unsafe(method_family = none)]
    pub fn frontmostApplication(&self) -> Option<Retained<NSRunningApplication>>;
);
```

**Implementation snippet:**
```rust
use objc2_app_kit::{NSRunningApplication, NSWorkspace};

let workspace = NSWorkspace::sharedWorkspace();
let frontmost = workspace.frontmostApplication();
if let Some(app) = frontmost {
    println!("Frontmost app: {:?}", app.localizedName());
}
```

**Required Cargo features:** `NSWorkspace` (for sharedWorkspace), `NSRunningApplication` (for frontmostApplication)

---

## 2. NSRunningApplication.processIdentifier + bundleIdentifier + localizedName

**Evidence** ([NSRunningApplication.rs](https://docs.rs/objc2-app-kit/0.3.2/src/objc2_app_kit/generated/NSRunningApplication.rs.html)):

```rust
// processIdentifier - returns libc::pid_t, requires feature "libc"
pub fn processIdentifier(&self) -> pid_t
// Available on crate feature `libc` only.

// bundleIdentifier - returns Option<Retained<NSString>>
pub fn bundleIdentifier(&self) -> Option<Retained<NSString>>

// localizedName - returns Option<Retained<NSString>>
pub fn localizedName(&self) -> Option<Retained<NSString>>
```

**Implementation snippet:**
```rust
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::NSString;

let app: Retained<NSRunningApplication> = /* ... */;

// Get PID
let pid: libc::pid_t = app.processIdentifier();

// Get bundle identifier
if let Some(bundle_id) = app.bundleIdentifier() {
    let bundle_str: String = bundle_id.to_string();
    println!("Bundle ID: {}", bundle_str);
}

// Get localized name  
if let Some(name) = app.localizedName() {
    let name_str: String = name.to_string();
    println!("Name: {}", name_str);
}
```

**Required Cargo features:** `NSRunningApplication` + `libc` (for processIdentifier)

---

## 3. NSRunningApplication.activateWithOptions

**Evidence** ([NSRunningApplication.rs activateWithOptions](https://docs.rs/objc2-app-kit/0.3.2/struct.NSRunningApplication.html#method.activateWithOptions)):

```rust
pub fn activateWithOptions(
    &self, 
    options: NSApplicationActivationOptions
) -> bool
```

**NSApplicationActivationOptions constants** ([source](https://docs.rs/objc2-app-kit/0.3.2/src/objc2_app_kit/generated/NSRunningApplication.rs.html#17-30)):

```rust
// In NSApplicationActivationOptions impl block:
pub const ActivateAllWindows: Self;
pub const ActivateIgnoringOtherApps: Self;  // Deprecated in macOS 14
```

**Implementation snippet:**
```rust
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

let app: Retained<NSRunningApplication> = /* ... */;

// Activate, ignoring other apps (brings this app to front)
let success = app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);

// Or with all windows:
let success = app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
```

**Required Cargo features:** `NSRunningApplication`

---

## 4. runningApplicationWithProcessIdentifier (lookup by PID)

**YES, objc2-app-kit has this binding.**

**Evidence** ([NSRunningApplication.rs](https://docs.rs/objc2-app-kit/0.3.2/struct.NSRunningApplication.html#method.runningApplicationWithProcessIdentifier)):

```rust
// Class method - called on NSRunningApplication itself, not an instance
pub fn runningApplicationWithProcessIdentifier(
    pid: pid_t
) -> Option<Retained<Self>>
// Available on crate feature `libc` only.
```

**Important distinction:** This is a **class method** (like `NSRunningApplication::runningApplicationWithProcessIdentifier(pid)`), not an instance method. It searches for any running app by PID.

**Implementation snippet:**
```rust
use objc2_app_kit::NSRunningApplication;
use libc::pid_t;

let target_pid: pid_t = 12345;

if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(target_pid) {
    println!("Found app: {:?}", app.localizedName());
    println!("PID: {}", app.processIdentifier());
    println!("Bundle: {:?}", app.bundleIdentifier());
} else {
    println!("No running app with PID {}", target_pid);
}
```

**Real-world usage from GitHub** ([char crate](https://github.com/fastrepl/char/blob/main/crates/bundle/src/bundle.rs#L38)):
```rust
#[cfg(all(feature = "objc2", not(feature = "cidre")))]
pub fn bundle_id_for_pid(pid: i32) -> Option<String> {
    use objc2_app_kit::NSRunningApplication;
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
    let bundle_id = app.bundleIdentifier()?;
    Some(bundle_id.to_string())
}
```

**Required Cargo features:** `NSRunningApplication` + `libc`

---

## 5. Cargo Features Summary

**Minimum for the above APIs:**
```toml
[dependencies]
objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication"] }
libc = "0.2"  # Required for pid_t type
```

**Feature breakdown:**

| Feature | Required for |
|---------|-------------|
| `NSWorkspace` | `sharedWorkspace()`, `frontmostApplication` (also needs `NSRunningApplication`) |
| `NSRunningApplication` | `frontmostApplication()`, `activateWithOptions()`, `bundleIdentifier()`, `localizedName()`, `runningApplicationWithProcessIdentifier()` |
| `libc` | `processIdentifier()` return type `pid_t` |
| `block2` | Async completion handler variants (not needed for sync APIs above) |

**Default-free:** `objc2-app-kit` default features are empty/minimal. You must explicitly enable what you use.

**From Cargo.toml** ([objc2-app-kit@crates.io](https://crates.io/crates/objc2-app-kit)):
> MSRV: 1.71  
> Latest version: 0.3.2

---

## Complete Tauri-Ready Example

```rust
// src/frontmost_app.rs
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

pub fn get_frontmost_app_info() -> Option<(String, libc::pid_t)> {
    let workspace = NSWorkspace::sharedWorkspace();
    let frontmost = workspace.frontmostApplication()?;
    let name = frontmost.localizedName()?.to_string();
    let pid = frontmost.processIdentifier();
    Some((name, pid))
}

pub fn activate_app_by_pid(pid: libc::pid_t) -> bool {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps)
    } else {
        false
    }
}
```

```toml
# Cargo.toml
[dependencies]
objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication"] }
libc = "0.2"
```
