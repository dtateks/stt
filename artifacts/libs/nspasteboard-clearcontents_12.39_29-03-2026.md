# NSPasteboard clearContents Research Findings

**Date:** 12.39_29-03-2026

---

## Question 1: Return Type — BOOL or Integer/Change Count?

**Answer: Returns `Int` (not BOOL).**

**Evidence** ([Apple Developer Documentation](https://developer.apple.com/documentation/appkit/nspasteboard/clearcontents())):

```swift
func clearContents() -> Int
```

The official Swift declaration shows the return type is `Int`, specifically the **change count** of the pasteboard.

---

## Question 2: What Does a Return Value of 0 Mean?

**Answer: The return value is the pasteboard's change count after clearing.**

A return of `0` means the change count is 0 — the pasteboard was already empty, or this is the first write since the pasteboard server started.

From Apple's documentation:

> **Return Value**
> The change count of the receiver.

**Discussion** (from Apple docs):
> Clears the existing contents of the pasteboard, preparing it for new contents. This is the first step in providing data on the pasteboard.

---

## Summary

| Aspect | Finding |
|--------|---------|
| **Return type** | `Int` (not `Bool`) |
| **Meaning of return** | Pasteboard change count *after* clearing |
| **0 return** | Change count is 0 — pasteboard was empty or this is the first write |

---

## Source Citation

- **Primary:** [Apple Developer Documentation — `clearContents()`](https://developer.apple.com/documentation/appkit/nspasteboard/clearcontents())
  - Declared as: `func clearContents() -> Int`
  - Return Value documented as: "The change count of the receiver."

---

## Note on Local Code

The local project (`src/src/text_inserter.rs`) wraps `clearContents` and treats `0` as failure:

```rust
let result = general_pasteboard.clear_contents();
if result == 0 {
    // treats 0 as failure
}
```

This may be a misinterpretation — `0` from `clearContents()` is a valid change count, not an error indicator. The Apple's API returns the *new* change count, not a success/failure boolean. If the pasteboard was already empty (change count 0), `clearContents()` would return `0` — which is valid, not an error.

Whether `0` is a legitimate scenario worth treating as "failure" depends on the specific use case, but strictly speaking from the API contract, a `0` return is valid and indicates the pasteboard's change count is 0 after the operation.
