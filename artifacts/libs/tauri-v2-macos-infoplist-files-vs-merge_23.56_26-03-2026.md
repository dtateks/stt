# Tauri v2 macOS Bundle: Info.plist Replacement vs Merge

**Date:** 26-03-2026  
**Commit SHA:** 5dc2cee60370665af88c185684432e425b1c987d  
**Source:** [Tauri v2 macOS App Bundle](https://v2.tauri.app/distribute/macos-application-bundle/), [bundle/settings.rs](https://github.com/tauri-apps/tauri/blob/5dc2cee60370665af88c185684432e425b1c987d/crates/tauri-bundler/src/bundle/settings.rs), [macOS app.rs](https://github.com/tauri-apps/tauri/blob/5dc2cee60370665af88c185684432e425b1c987d/crates/tauri-bundler/src/bundle/macos/app.rs), [interface/rust.rs](https://github.com/tauri-apps/tauri/blob/5dc2cee60370665af88c185684432e425b1c987d/crates/tauri-cli/src/interface/rust.rs)

---

## 1. Decisive Recommendation

**`bundle.macOS.files { "Info.plist": "./Info.plist" }` DOES replace the generated Info.plist, dropping all required keys including `CFBundleExecutable`.**

**Correct approach:** Remove the `files` entry for Info.plist entirely. Tauri v2 has **auto-discovery** that merges `Info.plist` from the tauri dir automatically — no explicit config needed for usage descriptions.

---

## 2. Root Cause Analysis

### What the buggy config does

```json
// WRONG - this REPLACES the generated Info.plist
"macOS": {
  "files": {
    "Info.plist": "./Info.plist"   // <-- raw copy, no merge
  }
}
```

**Evidence** ([app.rs lines 105, 175-200](https://github.com/tauri-apps/tauri/blob/5dc2cee60370665af88c185684432e425b1c987d/crates/tauri-bundler/src/bundle/macos/app.rs#L105-L200)):
```rust
// Line 82-83: Generate full Info.plist FIRST
create_info_plist(&bundle_directory, bundle_icon_file, settings)
  .with_context(|| "Failed to create Info.plist")?;

// Line 105: THEN copy_custom_files_to_bundle OVERWRITES it
copy_custom_files_to_bundle(&bundle_directory, settings)?;
```

`copy_custom_files_to_bundle` at line 189 does a **raw file copy**:
```rust
fs_utils::copy_file(path, &bundle_directory.join(contents_path))
```

This means your `Info.plist` replaces the generated one completely, losing `CFBundleExecutable`, `CFBundleIdentifier`, `CFBundleName`, `CFBundleVersion`, etc.

### What the packaged Info.plist actually contains

From your built app at `Voice to Text.app/Contents/Info.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSMicrophoneUsageDescription</key>
  <string>Voice to Text needs microphone access for speech-to-text.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>Voice to Text needs accessibility to paste text into other apps.</string>
</dict>
</plist>
```

**Missing required keys:** `CFBundleExecutable`, `CFBundleIdentifier`, `CFBundleName`, `CFBundleVersion`, `CFBundlePackageType`, `LSMinimumSystemVersion`, etc.

### The correct mechanism: auto-discovery + merge

**Evidence** ([interface/rust.rs lines 1633-1647](https://github.com/tauri-apps/tauri/blob/5dc2cee60370665af88c185684432e425b1c987d/crates/tauri-cli/src/interface/rust.rs#L1633-L1647)):
```rust
#[cfg(target_os = "macos")]
info_plist: {
  let mut src_plists = vec![];

  // AUTO-DISCOVERY: check for Info.plist in tauri dir
  let path = tauri_dir.join("Info.plist");
  if path.exists() {
    src_plists.push(path.into());
  }
  // Explicit config also merged
  if let Some(info_plist) = &config.macos.info_plist {
    src_plists.push(info_plist.clone().into());
  }

  // MERGE (later entries override earlier)
  Some(tauri_bundler::bundle::PlistKind::Plist(
    crate::helpers::plist::merge_plist(src_plists)?,
  ))
},
```

This is the **merge path**, not the `files` path.

---

## 3. Required Keys in Generated Info.plist

**Evidence** ([app.rs lines 209-254](https://github.com/tauri-apps/tauri/blob/5dc2cee60370665af88c185684432e425b1c987d/crates/tauri-bundler/src/bundle/macos/app.rs#L209-L254)):

```rust
fn create_info_plist(...) {
  let mut plist = plist::Dictionary::new();
  plist.insert("CFBundleDevelopmentRegion".into(), "English".into());
  plist.insert("CFBundleDisplayName".into(), settings.product_name().into());
  plist.insert("CFBundleExecutable".into(), settings.main_binary_name()?.into());
  plist.insert("CFBundleIdentifier".into(), settings.bundle_identifier().into());
  plist.insert("CFBundleInfoDictionaryVersion".into(), "6.0".into());
  plist.insert("CFBundleName".into(), bundle_name.into());
  plist.insert("CFBundlePackageType".into(), "APPL".into());
  plist.insert("CFBundleShortVersionString".into(), settings.version_string().into());
  plist.insert("CFBundleVersion".into(), settings.macos().bundle_version...into());
  plist.insert("CSResourcesFileMapped".into(), true.into());
  plist.insert("LSMinimumSystemVersion".into(), version.into());
  plist.insert("LSRequiresCarbon".into(), true.into());
  plist.insert("NSHighResolutionCapable".into(), true.into());
  // ... then user plist entries are MERGED at lines 422-432
}
```

---

## 4. Minimal Correct Configuration

### Remove the `files` entry for Info.plist

**Before (broken):**
```json
{
  "bundle": {
    "macOS": {
      "entitlements": "./Entitlements.plist",
      "files": {
        "Info.plist": "./Info.plist"   // WRONG: raw copy replaces generated
      }
    }
  }
}
```

**After (correct):**
```json
{
  "bundle": {
    "macOS": {
      "entitlements": "./Entitlements.plist"
      // NO files entry for Info.plist - auto-discovery handles it
    }
  }
}
```

### Keep your Info.plist at `src/Info.plist`

Place your `Info.plist` with usage descriptions in the **same directory as `tauri.conf.json`** (i.e., `src/Info.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSMicrophoneUsageDescription</key>
  <string>Voice to Text needs microphone access for speech-to-text.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>Voice to Text needs accessibility to paste text into other apps.</string>
</dict>
</plist>
```

Tauri will **automatically discover** and **merge** this with its generated Info.plist (which contains all required keys).

### Optional: explicit info_plist path (if you want to be explicit)

If you prefer being explicit over auto-discovery, use `info_plist` instead of `files`:

```json
{
  "bundle": {
    "macOS": {
      "entitlements": "./Entitlements.plist",
      "info_plist": "./Info.plist"   // CORRECT: this MERGES, not replaces
    }
  }
}
```

---

## 5. Why the Executable Appears "Missing"

When macOS launches an app, it reads `CFBundleExecutable` from `Info.plist` to find the actual binary. Since your custom `Info.plist` replaced the generated one entirely, `CFBundleExecutable` was **absent**. macOS then could not locate the executable and reported it as missing.

The executable `voice_to_text` **exists** at `Contents/MacOS/voice_to_text` — it's just that `Info.plist` no longer tells macOS where to find it.

---

## 6. Summary

| Config | Behavior | Result |
|--------|----------|--------|
| `bundle.macOS.files { "Info.plist": "./Info.plist" }` | **Raw copy** to `Contents/Info.plist` | **REPLACES** generated plist — breaks app launch |
| `bundle.macOS.info_plist: "./Info.plist"` | **Merge** with generated plist | Adds keys to generated plist — **works** |
| No config (auto-discovery) | **Auto-merge** `Info.plist` in tauri dir | Adds keys to generated plist — **works** |

**The `files` mechanism is for arbitrary files** (provisioning profiles, docs, etc.) — **not for Info.plist extension**.
