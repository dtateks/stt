# AppleScript/System Events Runtime Error 36:68 Research Artifact

**Date**: 2026-03-29
**Topic**: osascript error `36: 68: execution error` for `System Events` keystroke commands

---

## Error Code Interpretation

**Format**: `36: 68: execution error: ...`

The osascript error output format is `<line_number>: <error_code>: <message>`. The `68` is not a standard AppleScript error number — it appears to be a **Cocoa/Carbon error code** or a **TCC permission denial code** reported through the AppleScript layer.

### Known AppleScript Error Codes for System Events Failures

| Error | Message | Root Cause |
|-------|---------|------------|
| `-1719` | "is not allowed assistive access" | Missing **Accessibility** permission |
| `-1728` | "osascript is not allowed assistive access" | osascript binary lacks Accessibility |
| `-1743` | "Not authorized to send Apple events to System Events" | Missing **Automation** permission for System Events |
| `-10004` | "A privilege error has occurred" | Permission boundary violation |

---

## Why `count processes` Succeeds but `keystroke` Fails

### Probe Operations (e.g., `count processes`, `get name of processes`)

- **Permission required**: Basic Apple Event dispatch
- **TCC bucket**: **Automation** only (lightweight)
- **Why it works**: Read-only queries to `System Events` only need the app to have Automation permission enabled in `System Settings > Privacy & Security > Automation`

### GUI Operations (e.g., `keystroke`, `key code`, `click`)

- **Permission required**: Both **Accessibility** AND **Automation**
- **TCC bucket**: Accessibility is a separate, stricter bucket
- **Why it fails**: GUI scripting commands (`keystroke`, `key code 36`) require the calling app to be granted **Accessibility** permission in `System Settings > Privacy & Security > Accessibility`. Automation alone is insufficient.

### The Two-Stage TCC Model

```
count processes  →  System Events  →  Automation permission (ON)
keystroke        →  System Events  →  Automation (ON) + Accessibility (FAIL)
```

---

## Likely Causes for `36: 68: execution` Error

### Primary: Missing Accessibility Permission

The `68` error code often maps to `kARightsError` or a permission denial in the Accessibility subsystem. When osascript runs a `keystroke` or `key code` command:

1. The app must have **Automation > System Events** enabled
2. The app must have **Accessibility** permission (listed in the Accessibility pane)

Without Accessibility, the GUI scripting commands fail with a permission error that may surface as `68` through the AppleScript error reporting layer.

### Secondary: Target App Not Frontmost

`keystroke` sends to the **frontmost application**, not necessarily the target of System Events. If the target app:
- Is not frontmost
- Is in the background
- Does not accept keyboard input

The command fails even with correct permissions.

### Tertiary: System Events Process State

System Events must be able to control the target application. If:
- The target app is `launchd` or a system process
- The target app has restricted accessibility (e.g., Safari with certain security settings)
- The session is remote (screen sharing, VNC)

GUI scripting may be blocked.

---

## Runtime Precondition Differences: Probe vs Keystroke

| Operation | Permission Bucket | TCC Check | Target App State |
|-----------|------------------|-----------|------------------|
| `count processes` | Automation | Lightweight Apple Event dispatch | No frontmost requirement |
| `get name of every process` | Automation | Lightweight Apple Event dispatch | No frontmost requirement |
| `keystroke "v" using command down` | Accessibility + Automation | GUI scripting + event dispatch | **Target must be frontmost** |
| `key code 36` | Accessibility + Automation | GUI scripting + event dispatch | **Target must be frontmost** |
| `click` | Accessibility + Automation | GUI scripting + event dispatch | **Target must be frontmost** |

**Key insight**: `count processes` is a metadata query against System Events itself. `keystroke` is a GUI scripting command that must target another application's window server connection.

---

## osascript Error Output Format Reference

```
<line_number>: <os_status>: <error_prefix>: <detailed_message>
```

- `36` — Line number in the source script where error occurred
- `68` — macOS error code (often `nsCocoaError` domain or similar)
- `execution error:` — Standard AppleScript runtime error prefix
- Full example: `36: 68: execution error: System Events got an error: AppleEvent timed out. (-1713)`

---

## macOS TCC Permission Locations

### Automation Permission (for System Events)

```
System Settings > Privacy & Security > Automation
  └── [Your App] > System Events (allow)
```

### Accessibility Permission (for GUI Scripting)

```
System Settings > Privacy & Security > Accessibility
  └── [Your App] (must be checked ON)
```

**Critical note**: On macOS Ventura+, adding an app to Accessibility does NOT automatically grant it to child processes like `osascript` run via `system()` or `NSTask`. The **calling app** (e.g., Terminal, your app) needs the permission.

---

## Evidence Sources

- [Apple Developer Forums: Error -1743 Not authorized to send Apple events](https://developer.apple.com/forums/thread/8634)
- [Stack Overflow: AppleScript Application is not allowed to send keystrokes](https://stackoverflow.com/questions/54973241)
- [Apple Stack Exchange: Fixing "not allowed to send keystrokes" error](https://apple.stackexchange.com/questions/457806)
- [Doug's Scripts: System Events Error and the Fix](https://dougscripts.com/itunes/2021/12/system-events-error-and-the-fix/)
- [Apple Developer: AppleScript Error Codes](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_error_codes.html)
- [iBoysoft: Not authorized to send Apple events to System Events fix](https://iboysoft.com/tips/not-authorized-to-send-apple-events-to-system-events.html)

---

## Summary

The error `36: 68: execution error` with `keystroke`/`key code` commands is almost certainly a **missing Accessibility permission** for the calling app/process. The `68` is likely a macOS permission denial code reported through the AppleScript runtime.

**Why `count processes` works but `keystroke` fails**:
- `count processes` is a read-only Apple Event query requiring only Automation permission
- `keystroke`/`key code` are GUI scripting operations requiring both Automation AND Accessibility
- These are separate TCC permission buckets; having one does not grant the other

**Fix path**: Add the calling app (Terminal, your app's binary, or `osascript`) to `System Settings > Privacy & Security > Accessibility`.
