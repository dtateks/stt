# objc2 Ownership Semantics: `Retained::from_raw` vs Autoreleased Returns

**Date:** 19.12_27-03-2026  
**Source:** [madsmtm/objc2](https://github.com/madsmtm/objc2) (commit analyzed)

---

## Summary

**`Retained::from_raw` is INCORRECT for autoreleased returns** like `NSPasteboard::generalPasteboard`, `objectAtIndex:`, `dataForType:`, and `types`.

The correct pattern is to use `msg_send!` which automatically handles the ownership semantics, or use `Retained::retain_autoreleased()` for raw pointer scenarios.

---

## The Core Rule: Method Families Determine Ownership

Objective-C methods are classified into families based on their **selector name**. The first keyword of the selector determines the memory management behavior:

| Method Family | Example Selectors | Ownership | Correct `Retained` construction |
|---------------|-------------------|-----------|--------------------------------|
| `new` | `new`, `newWithX:` | +1 retain (caller owns) | `Retained::from_raw(ptr)` |
| `alloc` | `alloc`, `allocWithZone:` | +1 retain | `Allocated::new(ptr)` |
| `init` | `init`, `initWithX:` | +1 retain (consumes receiver) | `Retained::from_raw(ptr)` |
| `copy` | `copy`, `copyWithZone:` | +1 retain | `Retained::from_raw(ptr)` |
| `mutableCopy` | `mutableCopy`, `mutableCopyWithZone:` | +1 retain | `Retained::from_raw(ptr)` |
| **`none`** | Everything else: `generalPasteboard`, `objectAtIndex:`, `dataForType:`, `types` | **autoreleased** | **`Retained::retain_autoreleased(ptr)`** |

This is enforced in [retain_semantics.rs lines 53-63](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/__macros/retain_semantics.rs#L53-L63):

```text
/// # Summary
///
/// ```text
/// new:         Receiver       -> Option<Retained<Return>>
/// alloc:       &AnyClass      -> Allocated<Return>
/// init normal: Allocated<T>   -> Option<Retained<T>>
/// init super:  PartialInit<T> -> Option<Retained<T>>
/// copy:        Receiver       -> Option<Retained<Return>>
/// mutableCopy: Receiver       -> Option<Retained<Return>>
/// none:        Receiver       -> Option<Retained<Return>> (autoreleased)
/// ```
```

---

## Why `from_raw` Is Wrong for Autoreleased Returns

### The `from_raw` Contract

From [retained.rs lines 168-186](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/rc/retained.rs#L168-L186):

```rust
/// Construct an [`Retained`] from a pointer that already has +1 retain count.
///
/// This is useful when you have a retain count that has been handed off
/// from somewhere else, usually Objective-C methods like `init`, `alloc`,
/// `new`, `copy`, or methods with the `ns_returns_retained` attribute.
///
/// If you do not have +1 retain count, such as if your object was
/// retrieved from other methods than the ones noted above, use
/// [`Retained::retain`] instead.
```

### What Happens When You Misuse `from_raw`

When you call `Retained::from_raw()` on an autoreleased pointer:

1. `Retained` assumes it owns the object (+1 retain count)
2. When `Retained` drops, it calls `objc_release` (-1 retain count)
3. But the original autoreleased object will **also** be released when the autorelease pool drains
4. **Double-release → use-after-free → crash**

### The Correct Alternative: `retain_autoreleased`

From [retain_semantics.rs lines 735-752](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/__macros/retain_semantics.rs#L735-L752):

```rust
impl<T: Message> ConvertReturn<NoneFamily> for Option<Retained<T>> {
    type Inner = *mut T;

    #[inline]
    unsafe fn convert_message_return(
        inner: Self::Inner,
        _receiver_ptr: *mut AnyObject,
        _sel: Sel,
    ) -> Self {
        // NOTE: All code between the message send and `retain_autoreleased`
        // must be able to be optimized away for it to work optimally.

        // SAFETY: The selector is not `new`, `alloc`, `init`, `copy` nor
        // `mutableCopy`, so the object must be manually retained.
        //
        // Validity of the pointer is upheld by the caller.
        unsafe { Retained::retain_autoreleased(inner) }
    }
}
```

The `retain_autoreleased` function (defined at [retained.rs lines 476-558](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/rc/retained.rs#L476-L558)) uses `objc_retainAutoreleasedReturnValue` - Apple's fast autorelease scheme that avoids an extra retain/release pair when the caller and callee are in the same call chain.

---

## NSPasteboard Methods: Correct Usage

Based on the example in [examples/pasteboard/nspasteboard.rs](https://github.com/madsmtm/objc2/blob/main/examples/pasteboard/nspasteboard.rs):

```rust
// CORRECT: Let msg_send! handle the ownership
let pasteboard = NSPasteboard::generalPasteboard();  // Returns Retained<NSPasteboard>

// CORRECT: Framework methods return Retained directly
pub fn get_text_1(pasteboard: &NSPasteboard) -> Option<Retained<NSString>> {
    pasteboard.stringForType(unsafe { NSPasteboardTypeString })
    //     ^-- returns Option<Retained<NSString>>, not a raw pointer
}
```

**The framework methods already return `Retained<T>`** - you don't need to manually construct `Retained` from raw pointers. The `msg_send!` macro inside the framework bindings handles the correct ownership semantics.

---

## Safe Patterns for Raw Pointer Scenarios

If you must work with raw pointers (e.g., using `msg_send!` directly):

```rust
// CORRECT: For methods in new/alloc/init/copy/mutableCopy families
let obj: *mut NSObject = unsafe { msg_send![NSObject::class(), new] };
let retained: Retained<NSObject> = unsafe { Retained::from_raw(obj).unwrap() };

// CORRECT: For methods in the NONE family (generalPasteboard, objectAtIndex:, etc.)
let ptr: *mut NSObject = unsafe { msg_send![pasteboard, generalPasteboard] };
let retained: Retained<NSObject> = unsafe { Retained::retain_autoreleased(ptr).unwrap() };
```

---

## The `msg_send!` Macro Is Your Friend

The `msg_send!` macro automatically determines the method family and calls the correct conversion. From [msg_send/retained.rs](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/__macros/msg_send/retained.rs):

```rust
impl<Receiver, Return, MethodFamily> MsgSend<Receiver, Return> for MethodFamily
where
    MethodFamily: RetainSemantics<Receiver, Return, KindSendMessage>,
{
    #[inline]
    unsafe fn send_message<A: ConvertArguments>(receiver: Receiver, sel: Sel, args: A) -> Return {
        // ... message send ...
        
        // SAFETY: The pointers are valid
        unsafe { Self::convert_message_return(ret, ptr, sel) }
        //     ^-- calls the correct RetainSemantics implementation based on MethodFamily
    }
}
```

**Best practice:** Always use `msg_send!` with typed return values, or use framework bindings that already do this correctly.

---

## Example: What NOT to Do

```rust
// WRONG: Using from_raw on an autoreleased return
let ptr: *mut NSArray = unsafe { msg_send![pasteboard, arrayWithObjects:count:] };
//     ^-- This selector starts with "arrayWithObjects", NOT "new", "alloc", "init", "copy", or "mutableCopy"
//     So it returns autoreleased, NOT +1 retain
let array: Retained<NSArray> = unsafe { Retained::from_raw(ptr).unwrap() };
//     ^-- WRONG! This will cause double-release when array is dropped
```

---

## Verification: How to Check Method Family

The method family is determined by the **first keyword** of the Objective-C selector:

| Selector starts with... | Family |
|------------------------|--------|
| `new`, `alloc`, `copy`, `mutableCopy` followed by uppercase | That family |
| `init` | `init` |
| **Anything else** | `none` (autoreleased) |

For example:
- `generalPasteboard` → `none` family → autoreleased
- `objectAtIndex:` → `none` family → autoreleased
- `dataForType:` → `none` family → autoreleased
- `types` → `none` family → autoreleased
- `stringForType:` → `none` family → autoreleased
- `newObject` → `new` family → +1 retain
- `copyWithZone:` → `copy` family → +1 retain
- `mutableCopyWithZone:` → `mutableCopy` family → +1 retain

---

## References

1. [objc2 retain_semantics.rs - Method family definitions](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/__macros/retain_semantics.rs#L53-L63)
2. [objc2 retained.rs - Retained::from_raw documentation](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/rc/retained.rs#L168-L186)
3. [objc2 retained.rs - Retained::retain_autoreleased implementation](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/rc/retained.rs#L476-L558)
4. [objc2 retain_semantics.rs - NoneFamily implementation](https://github.com/madsmtm/objc2/blob/main/crates/objc2/src/__macros/retain_semantics.rs#L735-L752)
5. [Apple ARC Memory Management Rules](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/MemoryMgmt/Articles/mmRules.html)
6. [clang ARC documentation - method families](https://clang.llvm.org/docs/AutomaticReferenceCounting.html#method-families)
