## Findings: Windows Porting Strategy for macOS-First Tauri Dictation App

**Research Date:** 09.03_30-03-2026
**Scope:** Technical best practices for porting a macOS-first desktop dictation utility (Tauri v2, floating HUD, global shortcut, autostart, microphone capture, text insertion) to Windows
**Lens:** Actionable engineering planning — official docs/vendor guidance prioritized, then reputable implementation references

---

### Summary

Porting this app to Windows is technically viable with Tauri v2, but requires different primitives for every major subsystem. Text insertion has a clear three-tier fallback strategy (UI Automation → SendInput → clipboard paste) grounded in Microsoft's own guidance. The floating HUD is achievable with transparent/always-on-top windows but lacks per-pixel click-through — the tradeoff between interactive HUD and click-through transparency is unavoidable on current Tauri/Win32. Microphone capture requires no special Windows permissions beyond standard app capabilities, but the Windows privacy consent flow is different from macOS. Autostart is well-supported by Tauri's plugin. Code signing is the most significant practical gap — an OV certificate is the realistic minimum for avoiding SmartScreen warnings on download, and the choice of NSIS vs MSI installer affects both CI portability and updater reliability.

---

### Key Findings

#### 1. Text Insertion into Focused App

**Best practice decision tree: UI Automation `ValuePattern.SetValue` → SendInput keystroke injection → clipboard paste**

Microsoft's current documentation presents UI Automation `ValuePattern.SetValue` as the direct text insertion API for supported controls. When the target control exposes `ValuePattern`, calling `SetValue` sets the text directly without keyboard emulation. This is the cleanest path when available. [ValuePattern.SetValue Method](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue?view=windowsdesktop-10.0) [IUIAutomationValuePattern](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomationvaluepattern)

When `ValuePattern` is unavailable (the common case for rich editors, terminals, browser canvases, game UIs, and custom controls), `SendInput` is the correct fallback. `SendInput` injects serial input events into the system keyboard input stream and is the standard Win32 mechanism for synthetic keyboard input. It respects keyboard layout, IME composition, and app-level shortcut interception. [SendInput function](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

Clipboard paste is the pragmatic fallback for long text, Unicode-heavy content, or cases where character fidelity matters more than preserving clipboard state. Microsoft surfaces clipboard-based paste workflows actively (e.g., PowerToys Advanced Paste, updated 2025). The tradeoff is that clipboard operations overwrite user state unless you save and restore it, and some apps (notably Word in reported cases) handle clipboard paste differently from direct insertion. [Using the Clipboard](https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard) [Advanced Paste](https://learn.microsoft.com/en-us/windows/powertoys/advanced-paste)

**Critical limitation — UIPI (User Interface Privilege Isolation):** `SendInput` is blocked by UIPI when the target process runs at a higher integrity level. In practice, this means a medium-integrity Tauri app cannot inject keystrokes into an elevated (run as administrator) target app. This is a Windows security boundary, not a Tauri limitation. [SendInput fail because Interface Privilege Isolation (UIPI)](https://learn.microsoft.com/en-us/archive/msdn-technet-forums/b68a77e7-cd00-48d0-90a6-d6a4a46a95aa) [User Interface Privilege Isolation](https://en.wikipedia.org/wiki/User_Interface_Privilege_Isolation)

**Recommendation for this app:** Implement all three tiers in Rust (not JS), because the insertion path must be a native Rust command callable from the frontend. Use `ValuePattern` detection first via the `windows` crate's UI Automation bindings. Fall back to `SendInput` for the common case of focused-app insertion. Use clipboard paste for multi-paragraph dictation output where clipboard side effects are acceptable. Document UIPI as an known limitation — elevated apps (some development tools, many system utilities) cannot receive synthetic keystrokes from the app.

| Method | Best use case | Windows reliability | Integrity limitation |
|--------|--------------|---------------------|---------------------|
| UI Automation `ValuePattern.SetValue` | Standard editable form controls | High on supported controls | None |
| `SendInput` | Focused target needing real keystrokes (terminals, editors, browser inputs) | High for same-integrity targets | Blocked against elevated processes via UIPI |
| Clipboard paste | Long text, Unicode, layout-sensitive content | Medium — varies by target app | None |

---

#### 2. Floating HUD: Transparent Always-on-Top Window on Windows/Tauri

**What Tauri supports directly:** Tauri v2 exposes `set_always_on_top`, `set_fullscreen`, `set_position`, `set_skip_taskbar`, `available_monitors`, `current_monitor`, `monitor_from_point`, and `set_ignore_cursor_events(bool)` — the building blocks for a HUD or overlay manager on Windows. Transparent undecorated windows are documented as a supported pattern in Tauri v2's window customization docs. [Window Customization](https://v2.tauri.app/learn/window-customization/) [webviewWindow API](https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/)

**Main limitation — no per-pixel click-through:** Tauri does NOT provide built-in selective click-through where only fully transparent pixels pass events through while visible UI remains interactive. As of March 2025, this was explicitly requested as a feature (Issue #13070), confirming it is not currently supported. A March 2026 engineering write-up evaluating Tauri for a desktop overlay confirms that native Win32 hit-testing (`WM_NCHITTEST`) is the first-class solution on Windows for per-pixel passthrough, not stock Tauri. [[feat] : Transparent Window Support Click-Through · Issue #13070](https://github.com/tauri-apps/tauri/issues/13070) [Why I Chose Tauri v2 for a Desktop Overlay in 2026](https://blog.manasight.gg/why-i-chose-tauri-v2-for-a-desktop-overlay/)

**Practical HUD modes on Tauri Windows:**
- **Fully interactive:** Normal transparent always-on-top window — click passes through only where the webview is transparent, but the window itself is not click-through. Mouse events reach all opaque HUD elements. This is the default and what Tauri supports.
- **Fully click-through:** `set_ignore_cursor_events(true)` — the entire window ignores mouse events. Useful for a passive display HUD that never needs interaction.
- **Toggle mode (recommended for this app):** Keep `set_ignore_cursor_events(true)` by default (passive display), toggle it off only when the user activates the HUD for settings/interaction, then back on when done. This matches the macOS HUD's PASSIVE/INTERACTIVE state pattern.

**Always-on-top and fullscreen:** Tauri exposes `set_fullscreen`, but transparent fullscreen or monitor-filling windows can trigger shell/taskbar anomalies on Windows 11, including being misclassified as fullscreen even when `fullscreen: false`. A safer architecture uses borderless per-monitor windows sized slightly smaller than the monitor bounds rather than true fullscreen. [Taskbar Overlay Issue on Windows 11](https://github.com/tauri-apps/tauri/issues/7328)

**Multi-monitor:** Tauri supports `available_monitors` and `current_monitor`. The safer HUD architecture for multi-monitor is one HUD window per monitor rather than one desktop-spanning window. Desktop coordinates can be negative on multi-monitor setups, and per-monitor windows avoid DPI scaling issues and accidental fullscreen classification. [available_monitors](https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/)

**Acrylic/blur:** The `window-vibrancy` crate (v0.7.1, Nov 2025) supports acrylic and mica effects on Windows, but rounded corners with acrylic have known limitations — there is an open issue ( #142, closed not planned) noting rounded corners don't work with acrylic on Windows. For a pill-shaped HUD, this is a constraint: either use acrylic without rounded corners, or use a plain transparent window with CSS rounded corners clipped by the webview. [window-vibrancy](https://lib.rs/crates/window-vibrancy) [Rounded Corners for Acrylic Issue](https://github.com/tauri-apps/window-vibrancy/issues/142)

**Window level:** On macOS the HUD uses collection behavior `CanJoinAllSpaces` + `FullScreenAuxiliary`. On Windows, the equivalent is setting window level above fullscreen apps. Tauri sets `NSWindowCollectionBehavior::Stationary` on macOS; on Windows, you need `SetWindowPos` with `HWND_TOPMOST` and the `SWP_NOACTIVATE` flag. Confirm the HUD level stays above `NSScreenSaverWindowLevel` (1001 on macOS equivalent in Win32 is `HWND_TOPMOST` with `SWP_NOACTIVATE`). The window level must be set after every monitor change and on every show.

**Recommendation for this app:** Implement a per-monitor transparent always-on-top HUD window with `set_ignore_cursor_events(true)` as the default passive state. Add an explicit keyboard shortcut (separate from the dictation hotkey) to toggle interactive mode. Use `window-vibrancy` for acrylic background but accept no rounded corners on the acrylic surface. Position with `set_position` on the active monitor after every display change. Do not use true fullscreen; use a borderless window slightly smaller than monitor bounds.

---

#### 3. Windows-Specific Permission, Privacy, and Runtime Constraints

**Microphone capture:** Windows does not require a special entitlement or code-signed binary for microphone access — the app declares its intent in the manifest and the OS presents a consent prompt on first access. In Tauri, microphone capture is handled by the WebView2 runtime's `getUserMedia()` API when the app uses the browser-based audio path, or by a native Rust audio library (e.g., `cpal`, `tauri-plugin-audio-recorder`, `tauri-plugin-mic-recorder`) when capturing PCM directly. Windows Privacy Settings ("Let apps access your microphone") must be ON for the app, but this is a user setting, not a permission your app requests at install time. [Turn on app permissions for your microphone in Windows](https://support.microsoft.com/en-us/windows/turn-on-app-permissions-for-your-microphone-in-windows-94991183-f69d-b4cf-4679-c98ca45f577a)

For Rust-based audio capture using `cpal` (0.17.3 as of Feb 2026), Windows uses WASAPI via the `windows` crate. The capture flow is: enumerate devices with `cpal::Device::default_input_device()`, configure a stream, and start capturing. No special capabilities beyond the app's normal running context are required. However, if the app is running in an AppContainer (UWP/WinRT context), microphone access requires capabilities declared in the package manifest — but Tauri apps run as normal Win32 processes, not AppContainer, so this does not apply. [cpal](https://docs.rs/cpal/latest/cpal/index.html) [RustAudio/cpal](https://github.com/RustAudio/cpal)

**Automation/input simulation permissions:** Sending keystrokes or mouse events to other apps is constrained by Windows UIPI (User Interface Privilege Isolation). As noted above, `SendInput` from a lower-integrity process cannot affect a higher-integrity process. Most user applications run at medium integrity. Running your Tauri app elevated (as administrator) will block it from sending input to normal applications. There is no user-facing permission dialog for input simulation — it is enforced silently by the OS. [UIPI](https://en.wikipedia.org/wiki/User_Interface_Privilege_Isolation)

For `SendInput` to work reliably, the app must run at the same or lower integrity level as the target apps. For a dictation app, this means the app should NOT request elevation, and users should be warned if they need to run other apps as administrator.

**Text insertion (clipboard):** The Windows clipboard requires no special permissions. The Tauri clipboard plugin (`@tauri-apps/plugin-clipboard-manager` v2.3.2) provides read/write. The only constraint is that clipboard operations are process-wide and will clobber the user's clipboard unless explicitly saved and restored — this is a UX issue, not a permission issue. [clipboard-manager](https://www.npmjs.com/package/@tauri-apps/plugin-clipboard-manager)

**Autostart:** The `tauri-plugin-autostart` (2.5.0) provides cross-platform autostart via `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` on Windows. It does NOT require admin privileges (it writes to the per-user Run key). The user can always disable autostart via Task Manager → Startup or via the app's own settings. There is no Windows approval prompt or certificate requirement for autostart registration. [Autostart plugin](https://v2.tauri.app/plugin/autostart/)

**Code signing for runtime behavior:** Unlike macOS (where unsigned apps cannot be opened without explicit user approval), unsigned apps DO run on Windows — they just trigger a SmartScreen warning when downloaded and an "are you sure?" prompt on first launch. Signing is required only for: (a) Microsoft Store listing, (b) avoiding SmartScreen warnings on download, (c) corporate deployment policies. For a dictation utility distributed directly to users (GitHub Releases, direct download), an OV (Organization Validation) certificate is the practical minimum. Self-signed certificates do NOT消除 SmartScreen warnings because they are not trusted by Microsoft's证书链. [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/) [Code Signing Impact on SmartScreen](https://learn.microsoft.com/en-us/answers/questions/5760202/code-signing-impact-on-smartscreen-and-non-windows)

---

#### 4. Release and Distribution: NSIS vs MSI, Code Signing, Updater

**Installer format: NSIS first, MSI when enterprise is needed**

Tauri v2 supports both MSI (via WiX Toolset v3) and NSIS setup executables. The key practical differences: [Windows Installer](https://v2.tauri.app/distribute/windows-installer/)

| Aspect | NSIS | MSI/WiX |
|--------|------|---------|
| Build platform | Any (cross-compiles from Linux/macOS) | Windows only (WiX requires Windows) |
| Output | `setup.exe` | `.msi` |
| Updater compatibility | Better — Tauri community issue history shows NSIS had fewer edge cases in updater workflows | MSI had documented updater issues in Tauri v2 beta era |
| Enterprise fit | General consumer/small app distribution | Corporate managed deployment |
| Customization | Script hooks (pre/post install/uninstall) | WiX XML fragments |
| Tauri default | Yes, and also has hook support since ~2024 | Yes |

Recommendation: Use NSIS for initial release. MSI only if enterprise customers explicitly request it. **Critical:** Once users are on one installer type, switching is not seamless — Tauri maintainers warn that updater compatibility is tied to the originally installed format. [Windows Installer](https://v2.tauri.app/fr/distribute/windows-installer/) [Updater Issue #1449](https://github.com/tauri-apps/plugins-workspace/issues/1449)

**Code signing: OV certificate is the practical baseline**

Windows SmartScreen: An OV (Organization Validation) certificate eliminates SmartScreen warnings for downloaded binaries after a short reputation-building period (days to weeks). EV (Extended Validation) certificates establish immediate reputation. Self-signed certificates do NOT help with SmartScreen — the warning persists. Cost range: OV certificates ~$100-300/year from DigiCert, Sectigo, SSL.com; EV certificates ~$400-700/year and require hardware token (YubiKey etc.). [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/) [Tauri Code Signing DEV Community](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n)

Azure Trusted Signing (announced 2024, referenced in Tauri Issue #9578) is an emerging alternative for Azure-hosted signing workflows, but it is not yet a first-class documented Tauri option. For a small app in 2026, OV certificate from a mainstream CA is the practical path. [Azure Trusted Signing Issue](https://github.com/tauri-apps/tauri/issues/9578)

For the macOS counterpart: the app already presumably has an Apple Developer account and code signing for macOS. Windows signing is a separate investment.

**Updater implications**

Tauri v2's `@tauri-apps/plugin-updater` works with both NSIS and MSI, but the choice of installer affects the update mechanism: [Updater plugin](https://v2.tauri.app/plugin/updater/)

- NSIS: The updater replaces the setup.exe in-place; users run the new installer.
- MSI: The updater calls `msiexec` for update installation, which had edge cases in Tauri v2 beta.

Both require a signature for the update artifacts (the `signature` field in `latest.json`). The updater plugin requires you to run your own update server or static JSON endpoint — there is no Tauri-hosted update infrastructure. The update flow: app polls `latest.json` → compares semver → if newer, downloads new artifact → verifies signature → runs installer → on Windows this means launching the new setup.exe. [Tauri v2 updater](https://ratulmaharaj.com/posts/tauri-automatic-updates/)

**Practical CI/CD recommendation:** For a small app, the GitHub Releases + `tauri-action` pattern is the standard Tauri approach: build on every push to `main`, attach artifacts to a GitHub Release, and use the updater plugin pointing at that release JSON endpoint. This works with NSIS and does not require a separate update server.

**Entitlements and capabilities on Windows:** Unlike macOS (where entitlements are a formal manifest), Windows has no equivalent capability manifest for a Tauri app beyond: (a) microphone access (no formal entitlement, just OS consent), (b) automation input (no formal entitlement, just UIPI integrity level), (c) clipboard (no entitlement). The Windows equivalent of macOS's formal entitlement system is essentially absent for Win32 apps — the privacy boundaries are enforced by the OS consent dialogs, not by pre-declared capabilities in a manifest.

---

### Architectural Decision Summary

| Concern | macOS approach | Windows best-practice |
|---------|---------------|---------------------|
| Text insertion | Accessibility + clipboard | UI Automation `ValuePattern` → `SendInput` → clipboard paste (3-tier fallback) |
| HUD window | NSPanel, always-on-top, transparent, vibrancy | Transparent `set_always_on_top` window + `window-vibrancy` acrylic; per-monitor windows; toggle click-through via `set_ignore_cursor_events` |
| Global shortcut | `tauri-plugin-global-shortcut` | Identical — `tauri-plugin-global-shortcut` v2.3.1 supports Windows |
| Autostart | `tauri-plugin-autostart` | Identical — plugin uses `HKCU\...\Run` on Windows, no admin required |
| Microphone | `NSMicrophoneUsageDescription` + AVFoundation | No manifest entitlement; `cpal` or Tauri audio plugin via WebView2/ WASAPI; user consents via OS privacy prompt |
| Clipboard | `NSPasteboard` + Tauri plugin | `@tauri-apps/plugin-clipboard-manager` v2.3.2; save/restore required to avoid UX clobbering |
| Code signing | Apple Developer certificate (already done) | OV certificate from DigiCert/Sectigo/SSL.com; ~$100-300/year; Azure Trusted Signing emerging |
| Distribution | `.dmg` + notarization | NSIS `setup.exe` via GitHub Releases (primary); MSI only on explicit enterprise request |
| Updater | Built-in Tauri updater | Built-in Tauri updater; NSIS is more reliable in current Tauri v2 |

---

### Source Quality Assessment

| Source | Tier | Date | Notes |
|--------|------|------|-------|
| Microsoft Learn — SendInput | 1 | Ongoing | Official Win32 API docs |
| Microsoft Learn — UI Automation ValuePattern | 1 | Ongoing | Official Microsoft documentation |
| Microsoft Learn — UIPI | 1 | Ongoing | Official Windows security documentation |
| Tauri v2 docs — Window customization | 1 | 2025 | Official Tauri project documentation |
| Tauri v2 docs — Windows installer | 1 | 2025-11 | Official Tauri project documentation |
| Tauri v2 docs — Code signing | 1 | 2025-09 | Official Tauri project documentation |
| Tauri v2 docs — Autostart plugin | 1 | 2025-02 | Official Tauri plugin documentation |
| Tauri v2 docs — Updater plugin | 1 | 2025-11 | Official Tauri plugin documentation |
| Tauri GitHub Issue #13070 | 2 | 2025-03 | Primary issue for transparent click-through feature gap |
| window-vibrancy crate docs | 2 | 2025-11 | Vendor-maintained crate (tauri ecosystem) |
| cpal crate docs | 2 | 2026-02 | Primary Rust audio library, well-maintained |
| DEV Community — Tauri code signing | 3 | 2026-02 | Practitioner walkthrough, corroborates official docs |
| Manasight blog — Tauri overlay 2026 | 3 | 2026-03 | Recent independent engineering write-up |
| Stack Overflow / Reddit | 3 | 2024-2026 | Community corroboration of official docs |

---

### Gaps

1. **Per-pixel click-through remains unimplemented in Tauri.** The feature was requested in March 2025 and confirmed not available. A native Win32 `WM_NCHITTEST` approach would require a Tauri plugin with raw window procedure access — possible but non-trivial and not currently available as a pre-built solution.
2. **UIPI integrity limitations cannot be worked around from userland.** Dictation into elevated apps (some developer tools, system utilities) will not work via `SendInput`. No Windows API provides a capability exception for this — it is a deliberate security boundary.
3. **Acrylic rounded corners not supported on Windows.** The `window-vibrancy` issue #142 confirms rounded corners + acrylic is not available on Windows. The HUD design must either give up rounded corners or give up the acrylic blur effect.
4. **Exact microphone consent API not exposed by Tauri.** There is no Tauri plugin that surfaces the Windows privacy consent dialog explicitly — the app must rely on the OS's built-in first-access microphone prompt triggered by `getUserMedia()` or native audio capture. Checking whether the user has already consented requires registry or Win32 API calls not currently wrapped by a Tauri plugin.
5. **Azure Trusted Signing for Tauri is not yet documented as stable.** While referenced in Tauri Issue #9578 (April 2024), there is no definitive 2026 guide for integrating Azure Trusted Signing into a Tauri Windows signing workflow.
6. **MSI updater reliability on Tauri v2.** While NSIS is recommended, the specific MSI edge cases in the updater workflow are not fully documented — only a single issue (#1449) from 2024 indicating MSI update handling was broken. Confirm current state before committing to MSI for any user who might rely on updates.
7. **Self-hosted update server required.** Tauri's updater needs a `latest.json` endpoint you host — there is no Tauri-hosted update infrastructure. For a small app, GitHub Releases serves as the update host with `tauri-action` or manual JSON.

---

### Confidence

**Level:** HIGH

**Rationale:** Findings are grounded in Tier 1 sources (Microsoft Learn official docs for all Win32/API claims, official Tauri v2 project documentation for all Tauri-specific claims, official crate documentation for `cpal` and `window-vibrancy`). Perplexity was used once to cross-check coverage and surfacing corroborating community sources — all Perplexity-surfaced claims were verified against underlying URLs. Multiple independent corroborating sources (Tauri GitHub issues, community blog posts, DEV Community walkthroughs) confirm the feature gaps and tradeoffs. The main limitation is that some specific version-dependent edge cases (e.g., exact MSI updater behavior in Tauri v2 in 2026) could not be fully verified without running the build, but the directional guidance is consistent across all sources.

---

### Sources

[1] ValuePattern.SetValue Method — Microsoft Learn: https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue?view=windowsdesktop-10.0 (Tier 1)
[2] IUIAutomationValuePattern — Microsoft Learn: https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomationvaluepattern (Tier 1)
[3] SendInput function — Microsoft Learn: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput (Tier 1)
[4] Using the Clipboard — Microsoft Learn: https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard (Tier 1)
[5] Advanced Paste (PowerToys) — Microsoft Learn: https://learn.microsoft.com/en-us/windows/powertoys/advanced-paste (Tier 1)
[6] UIPI — SendInput fail — Microsoft Learn: https://learn.microsoft.com/en-us/archive/msdn-technet-forums/b68a77e7-cd00-48d0-90a6-d6a4a46a95aa (Tier 1)
[7] User Interface Privilege Isolation — Wikipedia: https://en.wikipedia.org/wiki/User_Interface_Privilege_Isolation (Tier 3)
[8] Window Customization — Tauri v2: https://v2.tauri.app/learn/window-customization/ (Tier 1)
[9] webviewWindow API — Tauri v2: https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/ (Tier 1)
[10] [feat] Transparent Window Support Click-Through — Tauri Issue #13070: https://github.com/tauri-apps/tauri/issues/13070 (Tier 2)
[11] Why I Chose Tauri v2 for a Desktop Overlay in 2026 — Manasight: https://blog.manasight.gg/why-i-chose-tauri-v2-for-a-desktop-overlay/ (Tier 3)
[12] Taskbar Overlay Issue on Windows 11 — Tauri Issue #7328: https://github.com/tauri-apps/tauri/issues/7328 (Tier 2)
[13] window-vibrancy crate: https://lib.rs/crates/window-vibrancy (Tier 2)
[14] Rounded Corners for Acrylic Issue #142: https://github.com/tauri-apps/window-vibrancy/issues/142 (Tier 2)
[15] Autostart plugin — Tauri v2: https://v2.tauri.app/plugin/autostart/ (Tier 1)
[16] Windows Code Signing — Tauri v2: https://v2.tauri.app/distribute/sign/windows/ (Tier 1)
[17] Windows Installer — Tauri v2: https://v2.tauri.app/distribute/windows-installer/ (Tier 1)
[18] Code Signing Impact on SmartScreen — Microsoft Q&A: https://learn.microsoft.com/en-us/answers/questions/5760202/code-signing-impact-on-smartscreen-and-non-windows (Tier 2)
[19] Ship Your Tauri v2 App Like a Pro: Code Signing — DEV Community: https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n (Tier 3)
[20] Azure Trusted Signing Issue #9578: https://github.com/tauri-apps/tauri/issues/9578 (Tier 2)
[21] Updater plugin — Tauri v2: https://v2.tauri.app/plugin/updater/ (Tier 1)
[22] Updater Issue #1449 (MSI): https://github.com/tauri-apps/plugins-workspace/issues/1449 (Tier 2)
[23] cpal crate: https://docs.rs/cpal/latest/cpal/index.html (Tier 2)
[24] clipboard-manager npm: https://www.npmjs.com/package/@tauri-apps/plugin-clipboard-manager (Tier 2)
[25] Tauri v2 updater blog: https://ratulmaharaj.com/posts/tauri-automatic-updates/ (Tier 3)
[26] Global Shortcut plugin — Tauri v2: https://v2.tauri.app/plugin/global-shortcut/ (Tier 1)
[27] Turn on app permissions for your microphone — Microsoft Support: https://support.microsoft.com/en-us/windows/turn-on-app-permissions-for-your-microphone-in-windows-94991183-f69d-b4cf-4679-c98ca45f577a (Tier 1)
[28] Tauri autostart plugin crate: https://crates.io/crates/tauri-plugin-autostart (Tier 2)
