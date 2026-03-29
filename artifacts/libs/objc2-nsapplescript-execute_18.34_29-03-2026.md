# `objc2_foundation::NSAppleScript` Implementation Guide

## Cargo Features Required

```toml
objc2-foundation = { version = "0.3", features = [
  "NSAppleScript",      # The NSAppleScript struct itself
  "NSAppleEventDescriptor", # Return type of executeAndReturnError
  "NSDictionary",       # Error dictionary type
  "NSString",           # Error keys and string handling
] }
```

Current project already has `NSString`, `NSData`, `NSArray` — only `NSAppleScript` and `NSAppleEventDescriptor` are new.

## Error Dictionary Keys

All keys are `&'static NSString` (available when `NSString` feature is enabled):

| Key | Type | Description |
|-----|------|-------------|
| `NSAppleScriptErrorMessage` | `NSString` | Detailed human-readable error description |
| `NSAppleScriptErrorNumber` | `NSNumber` | Raw AppleScript error code (e.g., `-128` = user canceled) |
| `NSAppleScriptErrorBriefMessage` | `NSString` | Shorter error message |
| `NSAppleScriptErrorAppName` | `NSString` | Name of the application that the script targeted |
| `NSAppleScriptErrorRange` | `NSValue` (NSRange) | Character range in the source where the error occurred |

**Evidence**: [NSAppleScript.rs lines 9-36](https://docs.rs/objc2-foundation/0.3.2/aarch64-apple-ios-macabi/objc2_foundation/generated/NSAppleScript.rs.html#9-36) — all five constants declared as `pub static NSAppleScriptError*: &'static NSString`.

## Core Pattern

```rust
use objc2::rc::Retained;
use objc2_foundation::{
    ns_string, NSAppleScript, NSAppleEventDescriptor, NSString,
    NSDictionary, NSNumber,
};

fn run_applescript(source: &str) -> Result<String, String> {
    // 1. Create the script from a string source
    //    initWithSource takes Allocated<Self> + &NSString
    let script = NSAppleScript::initWithSource(
        Allocated::new(),
        &ns_string!(source),
    )
    .expect("NSAppleScript::new should never fail");

    // 2. Execute and capture error dict
    //    error_info: Option<&mut Option<Retained<NSDictionary<NSString, AnyObject>>>>
    let mut error_info: Option<Retained<NSDictionary<NSString, AnyObject>>> = None;
    let result: Retained<NSAppleEventDescriptor> = unsafe {
        script.executeAndReturnError(&mut error_info)
    };

    // 3. Check if error occurred (error_info Some means failure)
    if let Some(error_dict) = error_info {
        let message = error_dict
            .get(&NSAppleScriptErrorMessage)
            .and_then(|v| v.downcast_ref::<NSString>())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "Unknown AppleScript error".into());

        let code = error_dict
            .get(&NSAppleScriptErrorNumber)
            .and_then(|v| v.downcast_ref::<NSNumber>())
            .map(|n| n.intValue())
            .unwrap_or(-1);

        return Err(format!("AppleScript error {}: {}", code, message));
    }

    // 4. Extract string result (if script returned text)
    //    NSAppleEventDescriptor has a stringValue method
    let output = result.stringValue().map(|s| s.to_string());
    Ok(output.unwrap_or_default())
}
```

**Evidence for API signatures**: [NSAppleScript.rs lines 76, 108-111](https://docs.rs/objc2-foundation/0.3.2/aarch64-apple-ios-macabi/objc2_foundation/generated/NSAppleScript.rs.html#76) — `initWithSource` takes `Allocated<Self>` and `&NSString`; [lines 108-111](https://docs.rs/objc2-foundation/0.3.2/aarch64-apple-ios-macabi/objc2_foundation/generated/NSAppleScript.rs.html#108-111) — `executeAndReturnError` takes `Option<&mut Option<Retained<NSDictionary<NSString, AnyObject>>>>` and returns `Retained<NSAppleEventDescriptor>`.

## Extracting String from `NSAppleEventDescriptor`

`executeAndReturnError` always returns a descriptor — even on error (it returns a "null" descriptor). Check `error_info` first, then extract:

```rust
// stringValue returns Option<Retained<NSString>>
let output: Option<Retained<NSString>> = result.stringValue();
```

If the script has no return value (`return` not called), the descriptor is still valid but `stringValue()` returns `None`.

## Minimal Complete Example

```rust
use objc2::rc::Allocated;
use objc2_foundation::{ns_string, NSAppleScript};

fn execute(script: &str) -> Result<String, String> {
    let script = NSAppleScript::initWithSource(Allocated::new(), &ns_string!(script))
        .ok_or("Failed to create NSAppleScript")?;

    let mut error_info = None;
    let descriptor = unsafe { script.executeAndReturnError(&mut error_info) };

    if let Some(err) = error_info {
        // Read NSAppleScriptErrorMessage from err
        return Err("AppleScript failed".into());
    }

    Ok(descriptor.stringValue()
        .map(|s| s.to_string())
        .unwrap_or_default())
}
```

## Key Safety Notes

- `executeAndReturnError` is `unsafe` — Apple's API can throw Objective-C exceptions on certain errors. Wrap in a catch-unsafe block or use `catch_unwind` at the Rust boundary.
- The `Allocated` pattern (partial initialization) is required — `initWithSource` is a `[unsafe(method)]` with `init` family. Use `Allocated::new()` then call the init method, exactly like `Retained::new()` but for APIs that require staged initialization.
- `executeAndReturnError` always returns a non-null descriptor; check `error_info` to know if it succeeded.

## Comparison to `/usr/bin/osascript` Process Execution

| Aspect | `NSAppleScript` | `std::process::Command` |
|--------|----------------|----------------------|
| Startup cost | None (in-process) | Fork+exec overhead |
| Error granularity | Parseable error dict | String stderr |
| Permissions | Same TCC enforcement | Same TCC enforcement |
| No shell involved | ✅ | ❌ (shell expands globs) |
| Requires Foundation | ✅ | ❌ |

## Entitlements

The app needs `com.apple.security.automation.apple-events` for System Events scripting. This is already listed in `src/Entitlements.plist`. No additional entitlement needed for `NSAppleScript` itself beyond what exists for `osascript` execution.
