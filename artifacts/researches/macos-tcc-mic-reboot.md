# macOS TCC Microphone-Reset-on-Reboot Bug (Tauri v2)

Cited research report. Each major claim carries a **confidence** rating and an **adversarial verdict** (confirmed / refuted / uncertain) from independent verification against the cited sources.

## Local Root-Cause Context (this app)

Established locally via codesign evidence; **not** independently verified by the literature pass below — treat as the observed local state this report explains:

- App bundle id `com.voicetotext.stt`.
- `/Applications/Voice to Text.app` — **stable self-signed cert** (DR: `identifier` + `certificate leaf H"d9e394…"`).
- `/Users/dta.teks/dev/stt/src/target/release/bundle/macos/Voice to Text.app` — **ad-hoc** signed (DR: `cdhash H"d7bd53…"`).
- `~/Library/LaunchAgents/Voice to Text.plist` (`RunAtLoad=true`) points at the **ad-hoc dev-build** binary.
- Net effect: **reboot** (launchd LaunchAgent) launches the ad-hoc copy; **manual reopen** launches the `/Applications` stable-cert copy. Mic was granted to the stable-cert identity; reboot re-prompts because the ad-hoc identity does not satisfy the stored grant.

This local diagnosis is consistent with — and explained by — the TCC identity model documented below.

---

## 1. TCC Identity Model for the Microphone; Ad-Hoc vs Stable-Cert Persistence

### 1.1 The grant is keyed to *code identity* (a Designated Requirement), not path or bundle ID alone

macOS TCC keys a microphone grant (`kTCCServiceMicrophone`) to an app's **code identity**, expressed as a compiled code-signing requirement (the `csreq` blob, magic header `0xFADE0C00`) stored in the `access` table of the TCC database. The stored row records `service`, `client` (bundle id with `client_type=0`, or absolute path with `client_type=1`), `auth_value` (allowed = `2`), and the `csreq` BLOB holding the app's Designated Requirement (DR) **at grant time**. On every microphone access, `tccd` builds a live `SecStaticCode`/`SecCodeRef` for the requesting PID and checks it satisfies the stored `csreq`. The bundle id alone never authorizes — the live code must satisfy the recorded DR.

- **Claim:** TCC records the app's DR in its database of mic-authorized apps and re-checks that the running app satisfies the original DR on every mic access; the DR *is* the app's code identity.
  **Confidence: high. Verdict: CONFIRMED.** Apple TN3127 verbatim: *"macOS solves this problem by recording your app's DR in its database of apps authorized to access the microphone. Each time your app tries to access the microphone, macOS checks that this version of the app satisfies the original DR."* and *"In short, the DR is all about code identity."* Corroborated by TN2206 and "Understanding the Code Signature." (Minor wording nuance: the DR *establishes* code identity rather than being literally synonymous with it — a faithful paraphrase, not a contradiction.)

- **Claim:** The grant is keyed to code identity (`csreq`), not on-disk path; the path/bundle-id in `client` is only the lookup key. Two builds with the same bundle id but different signatures are different identities. Apple advises a stable identity to avoid TCC churn.
  **Confidence: high. Verdict: CONFIRMED.** Rainforest QA: the `csreq` column is *"the code signing requirement blob that the client must satisfy … used to prevent spoofing/impersonation if another program uses the same bundle identifier."* HackTricks: *"other applications using the same name and bundle ID won't be able to access granted permissions given to other apps."* Apple engineer Quinn (Forum 730043): *"a key factor is your app's designated requirement. See TN3127 … sign your code with a stable signing identity … radically cut down on the amount of TCC thrash."*

- **Claim:** On each protected request `tccd` builds a live `SecCodeRef` for the calling PID and validates the running code against the stored requirement (`SecStaticCodeCheckValidity` / `matchesCodeRequirementData`) — observable in the unified log.
  **Confidence: high. Verdict: CONFIRMED (with caveat).** Eclectic Light log trace shows `Created SecCodeRef … for PID[28287]`, `SecTrustEvaluateIfNecessary`, and `matchesCodeRequirementData: SecStaticCodeCheckValidity() … result: 0` before the grant. **Caveat:** the cited log example is a *Calendar* (`kTCCServiceCalendar`) access, not literally microphone; the mechanism is service-agnostic so it generalizes, but the literal evidence is a Calendar grant.

- **Claim:** The `csreq` blob is a compiled requirement (magic `0xFADE0C00`) round-trippable with the `csreq` tool; a stable-identity `csreq` decodes to `identifier "…" and anchor apple generic and certificate leaf…` (e.g. Telegram `… subject.OU = "6N38VWS5BX" … identifier "ru.keepcoder.Telegram"`).
  **Confidence: high. Verdict: CONFIRMED.** Verified against Apple Security.framework source (`class Requirement: public Blob<…, 0xfade0c00>`), `man csreq`, the StackOverflow/Rainforest answer, HackTricks (exact Telegram decode), and local `csreq`+`xxd` round-trip execution. **Cosmetic caveat:** the Telegram blob was loosely labeled "microphone-class" in the source notes — a `csreq` encodes only code identity, not the TCC service, so that label is inaccurate but irrelevant to format/round-trip facts.

### 1.2 Why a stable cert persists and ad-hoc does not

A **stable** identity (self-signed / Apple Development / Developer ID) produces a DR of the form `identifier "…" and anchor apple generic and certificate leaf…` — tied to the bundle id **plus the signing certificate**, *not* the exact build bytes. A rebuilt binary signed with the same identity still satisfies the recorded `csreq`, so the grant **persists** across versions with no new prompt.

An **ad-hoc** signature (`codesign -s -`, Xcode "Sign to Run Locally") has a DR consisting only of `cdhash H"…"` (the code-directory hash). The cdhash changes on any non-trivial code change, so a recompiled ad-hoc binary no longer satisfies the recorded `csreq` → TCC treats it as a different identity and **re-prompts**. Unsigned code has no DR (the OS may synthesize an ad-hoc cdhash), giving the same churn.

- **Claim:** Ad-hoc signed code has a DR tied to that specific version's cdhash; unsigned code has no DR; in both cases macOS cannot track identity across versions, so tweak-and-rerun re-triggers the mic prompt.
  **Confidence: high. Verdict: CONFIRMED.** TN3127 verbatim: *"Unsigned code has no DR. Ad hoc signed code, called Sign to Run Locally by Xcode, has a DR but it's tied to that specific version of the code … If you tweak the code and run it again, macOS repeats that prompt. Without a DR, macOS can't track this authorization across versions of your app."* ("cdhash" is the verifier's accurate gloss; TN3127 says "tied to that specific version.")

- **Claim:** An ad-hoc DR is literally a cdhash-only requirement (e.g. `designated => cdhash H"70212a41…"`), and the cdhash changes whenever the program changes non-trivially — so an ad-hoc grant does not survive a rebuild.
  **Confidence: high. Verdict: CONFIRMED.** The cited StackOverflow/Rainforest decode shows exactly `designated => cdhash H"70212a41efea9849e7a88afa946afa3e1b559cbe" or cdhash H"9044184bcced89d2f4bf1d75ec61a7537871eee7"` (cdhash-OR-cdhash across hash algorithms, no cert/anchor). Apple Requirement Language doc: *"Because the code directory changes whenever the program changes in a nontrivial way, this test can be used to unambiguously identify one specific version of a program."* TN3126: cdhash *"uniquely identifies the code being signed."* **Caveat:** the precise "computes the canonical hash…" wording is from the Requirement Language doc, not TN2206 as one source attribution loosely implied.

- **Claim:** A stable identity produces a DR of the form `identifier "…" and … certificate …`, and these default/Xcode DRs are designed so a privilege like mic access acquired by one version is still available to a new version while preventing other teams from impersonating the app.
  **Confidence: high. Verdict: CONFIRMED.** TN3127 design goals verbatim: *"A privilege, like microphone access, acquired by an existing version of your app is still available to a new version"* and *"Other teams can't sign an app that impersonates your app …"* TN2206: a program's DR *"should also be satisfied by updates, i.e., new versions of that code, and by nothing else."* **Flagged imprecision:** the shorthand `certificate leaf = H"…"` (a pinned cert hash) is *not* the real default-DR syntax — real defaults use `anchor apple generic` + Apple-OID checks + `subject.OU`/`subject.CN`. The pinned form is the rigid style TN3127 cautions against hand-writing. Does not affect the persistence conclusion.

- **Claim:** Ad-hoc/unsigned builds re-prompt on every rebuild and accumulate stale TCC rows; a stable identity (Apple Development for dev, Developer ID for distribution) makes the mic grant survive rebuilds/updates. Switching identity *type* (Apple Development ↔ Developer ID ↔ Mac App Store) also re-prompts because the default DRs are NOT mutually compatible unless a custom DR is supplied.
  **Confidence: high. Verdict: CONFIRMED.** TN3127 verbatim on type-incompatibility: *"if you run an Apple Development variant … and then run a Developer ID or Mac App Store variant, the system will display a prompt …"* and mutual compatibility *"must be custom-engineered."* Forum 730043 user reports *"TCC gets confused over time and simply treats the permissions as not granted"* (ad-hoc + Developer ID, same bundle id), resolved by Quinn's stable-identity advice.

### 1.3 Ad-hoc signature cache survives `tccutil reset`

- **Claim:** TCC stores ad-hoc signature data in an `AdhocSignatureCache` folder alongside the TCC.db (system `/Library/…/com.apple.TCC/AdhocSignatureCache` and user `~/Library/…/com.apple.TCC/AdhocSignatureCache`); `tccutil` reset does not flush/remove it, leaving stale ad-hoc artifacts.
  **Confidence: high. Verdict: CONFIRMED (with caveat).** Eclectic Light verbatim: `tccutil` *"doesn't flush or remove the AdhocSignatureCache folder alongside its database either"* and ad-hoc signatures at `~/Library/Application Support/com.apple.TCC/AdhocSignatureCache` *"are left intact."* **Caveat:** the cited sources explicitly name only the **user** path; the **system** `/Library` path is inferred from a system-DB-centric paragraph, not stated side-by-side. Single author (Howard Oakley / Eclectic Light), not independent corroboration; behavior may vary by macOS version.

---

## 2. Why Reboot (launchd LaunchAgent) vs Relaunch (LaunchServices) Differ

### 2.1 What is solidly established

- **Claim:** Two bundles with the same `CFBundleIdentifier` but different signatures (stable-cert Developer ID vs ad-hoc) have incompatible DRs and do not share a grant; mutually compatible DRs are required for two variants/copies to share privacy resources.
  **Confidence: high. Verdict: CONFIRMED.** TN3127: *"Two apps … have mutually compatible designated requirements if app A satisfies app B's DR and app B satisfies app A's DR … If these apps have mutually compatible DRs then they share access to privacy-protected resources."* TN3127 also states a development build signed with Apple Development *"gets a different DR than a distribution build signed with your Developer ID."* Eclectic Light (Catalina guide): two copies in different folders share access *"so long as they have the same identifier, and that matches their signatures."* This is the **core, well-supported reason** reboot vs relaunch diverge **in this app**: the two launch paths invoke two differently-signed binaries.

- **Claim:** Working `tauri-plugin-autostart` LaunchAgent plists point `ProgramArguments[0]` at the `.app` **inner executable** (`…/Contents/MacOS/<bin>`), not the bare `.app` path.
  **Confidence: high. Verdict: CONFIRMED.** plugins-workspace issue #1115: the bare `.app` path *"does not work"*; restoring `Contents/macOS/APP` works.

- TCC tracks a **responsible process** via a parent-inheritance chain (`p_responsible_pid`, set in `fork1_internal`, inherited parent→child). Launching from a terminal makes the **terminal** responsible; `open`/Finder make the **app** responsible. (Qt blog; torarnv/disclaim; HackTricks XNU internals.) **These mechanism facts are confirmed.**

### 2.2 What is NOT established — flagged uncertain

- **Claim:** TCC attributes each access by walking the parent launch tree; a launchd LaunchAgent that execs the raw inner Mach-O makes the *parent* responsible while Finder/`open`/LaunchServices makes the *app* responsible, so boot-time autostart attribution differs from interactive launch.
  **Confidence: medium (as asserted). Verdict: UNCERTAIN.** The responsible-process mechanism and the working-plist fact are real, but **no cited source discusses LaunchAgents, autostart, or boot-time launch**, and the inference is questionable: a LaunchAgent-spawned process is a child of `launchd`, so the "responsible parent" would be `launchd` itself, not a meaningful app — the framing maps poorly onto the LaunchAgent case. Two evidence items were **misattributed**: issue #1115 says nothing about LaunchServices / TCC / app-init bypass (it concerns plist path forms), and t3code issue #728's own root cause is an **invalidated code signature + missing usage-description keys**, not the attribution mechanism it was cited to support.

**Conclusion for §2.** The reboot-vs-relaunch divergence in *this* app is **most reliably explained by the identity mismatch** (§1): reboot runs the ad-hoc binary, relaunch runs the stable-cert binary, and those have incompatible DRs. The additional theory that LaunchAgent vs LaunchServices changes the *responsible-process attribution* for the same binary is **not supported by the cited sources and should not be stated as fact.** If both launch paths pointed at the *same* stable-cert binary, the cited evidence does **not** establish that reboot alone would re-prompt.

---

## 3. Why Microphone Resets While Apple Events / Accessibility Persist Under Identity Mismatch

**Important framing (confidence: medium; synthesis).** In the *pure* case — only the leaf cert / DR changed, bundle id constant, `csreq` in the loose `identifier "X" and anchor …` form — all services re-validate identically, and a true identity mismatch would break **all** of them. A strict cdhash-form DR mismatch (the ad-hoc case here) likewise breaks all three. No source claims the mic `csreq` is compared against a *stricter* requirement string. The observed asymmetry is **gate + timing + caching + storage**, not `csreq` strictness. Four concrete differences:

- **Claim (1) — Hardened Runtime entitlement preflight (the primary mic differentiator).** Capture additionally requires `com.apple.security.device.audio-input`; TCC denies/re-prompts at that gate **independently** of the `csreq` DR match. Apple Events is gated on `com.apple.security.automation.apple-events`; Accessibility on neither — so dropping `audio-input` hits **only** the mic path.
  **Confidence: high. Verdict: CONFIRMED.** openai/codex tccd log: *"Prompting policy for hardened runtime; service: kTCCServiceMicrophone requires entitlement com.apple.security.device.audio-input but it is missing"* (same helper had apple-events automation + Accessibility + Screen Recording but lacked audio-input). hush docs and electron-builder #9529 corroborate.

- **Claim (2) — Apple Events keyed/validated differently.** `kTCCServiceAppleEvents` uses `indirect_object_identifier` (the target app) in its 4-column primary key and stores a **second** requirement blob `indirect_object_code_identity` (the target's `csreq`). The target is almost always a stable Apple-signed app (System Events, Finder), so the row stays addressable/valid even as the client's leaf churns; a working grant needs **both** csreqs.
  **Confidence: high. Verdict: CONFIRMED (component-level).** Rainforest QA defines both columns; Jamf/StackOverflow confirm Mojave+ needs both `SOURCE_APP_CSREQ` and `AUTOMATED_APP_CSREQ`; Entonos shows `com.apple.Terminal → com.apple.systemevents` rows.

- **Claim (3) — Accessibility persists via a per-process cache.** `AXIsProcessTrusted` reads a per-process cache populated at first call, **not** re-validated against the live signature on every call; TCC can roll the live DB forward without invalidating already-running processes' caches, so they keep reporting "trusted" until restart — whereas the mic path consults live state per capture session.
  **Confidence: medium-high. Verdict: CONFIRMED (single-source).** Fazm writeup states this verbatim; Authon blog corroborates the general "identifier mismatch → permission doesn't apply" point. **Caveat:** the cache-not-invalidated mechanism rests primarily on one source (Fazm).

- **Claim (4) — Storage location compounds it.** Mic/camera grants live in the **per-user** `~/Library` TCC.db (re-evaluated live, easily reset/re-prompted); Accessibility and Screen Recording live in the **SIP-protected system** `/Library` TCC.db (harder to mutate, commonly read via the cached AX path), so they appear to persist.
  **Confidence: medium. Verdict: CONFIRMED (medium).** yo-yo-yo-jbo and angelystor confirm the per-user vs global split; Quinn confirms the system DB is SIP write-protected. Rated medium because storage location is a contributing factor, not the decisive one.

Supporting schema facts:

- **Claim — `access` primary key + `csreq` semantics + `client_type`.** PK = `(service, client, client_type, indirect_object_identifier)`; `csreq` is the requirement blob the client must satisfy (anti-spoofing); `client_type` 0 = bundle id, 1 = absolute path; `csreq -r- -t` decodes to a string identical to `codesign -d -r-` designated output.
  **Confidence: high. Verdict: CONFIRMED.** angelystor + yo-yo-yo-jbo show the verbatim composite PK; Rainforest/HackTricks confirm `csreq` semantics; SO answer shows `csreq … → identifier "com.apple.Terminal" and anchor apple` matching `codesign`'s `designated =>` line. **Refinement:** the "identical" equality is the implicit-DR case; unsigned binaries yield a cdhash DR and signers can override the DR.

- **Claim — `client_type` path-keying as a separate, frequently-conflated cause.** A grant recorded by absolute PATH (`client_type=1`, common for unsigned/Mach-O/versioned-install-path) is invalidated by a new install path regardless of signature; ad-hoc/cdhash DRs invalidate on every rebuild.
  **Confidence: high. Verdict: CONFIRMED (component-level).** Rainforest (`client_type` 0/1), TN3127 (ad-hoc tied to one version), hush docs (*"every cargo build invalidates prior grants"*), stepcodex (versioned paths → orphan rows).

- **Claim — Big Sur schema / `auth_reason` enum.** Big Sur replaced `allowed`/`prompt_count` with `auth_value`/`auth_reason`/`auth_version`; `auth_reason` enumerates User Set=3, System Set=4, Service Policy=5, MDM Policy=6, Entitled=11, etc. System/Service-Policy/MDM rows are not user-keyed and can mask/override the `csreq` path.
  **Confidence: medium. Verdict: CONFIRMED (medium).** Rainforest schema comments + HackTricks enum + Eclectic Light (TCC_Compatibility AllowApplications) corroborate.

- **Bottom-line claim.** Under a true loose-form DR mismatch, all three services re-validate the same way; a strict cdhash mismatch breaks all. The mic appears to reset *alone* only because its hardened-runtime gate + live per-session re-check surface the failure immediately, while Accessibility's cached AX read and automation's stable-target keying hide the same mismatch until restart/target change. The differential is gate + timing + caching + storage, not `csreq` strictness.
  **Confidence: medium. Verdict: CONFIRMED (medium — synthesis).** No source claims tighter mic `csreq` matching; the asymmetry is the four mechanisms above.

---

## 4. Best-Practice Fix

**Recommended fix:** Register the **signed `.app` bundle** as a Login Item via Apple's **`SMAppService.mainApp`** (macOS 13+), gated to the canonical `/Applications` install location — **not** a hand-written `~/Library/LaunchAgents` plist pointing at the raw binary or a transient build path. This preserves TCC because `SMAppService` self-registers the running app's own stable signed identity (same DR TCC already trusts) and invokes no AppleScript/`osascript`, so no Automation/AppleEvents prompt fires.

Applied to **this app**, the immediate corrective steps:

1. **Eliminate the ad-hoc autostart target.** Remove `~/Library/LaunchAgents/Voice to Text.plist` (which points at the ad-hoc dev build) only after confirming this session/owner created it — re-read and diff first; default to surfacing for permission rather than deleting unilaterally.
2. **Make boot and manual launch run the *same* stable-cert `/Applications` binary** so both satisfy the recorded `identifier + certificate` DR and the mic grant persists.
3. **Register autostart via `SMAppService.mainApp`** against the `/Applications` bundle.

### Supporting claims and verdicts

- **Claim:** `SMAppService` (macOS 13+) is Apple's documented modern API to register LoginItems/LaunchAgents/LaunchDaemons; for a login item it replaces `SMLoginItemSetEnabled`; `SMAppService.mainApp` configures the main app to launch at login.
  **Confidence: high. Verdict: CONFIRMED.** Apple docs verbatim: *"In macOS 13 and later, use SMAppService to register and control LoginItems, LaunchAgents, and LaunchDaemons …"*; `mainApp` *"corresponds to the main application as a login item."*

- **Claim:** The bundle-contained approach yields a fully codesigned, tamper-evident bundle and user-visible attribution in System Settings → Login Items; plists live in the app bundle, not shared system locations.
  **Confidence: high. Verdict: CONFIRMED.** Apple sample-code doc verbatim (plists *"in the helper executable's bundle, rather than relying on shared locations"*; *"a fully codesigned app bundle that neither the system nor a third party can modify without breaking the code signature"*).

- **Claim:** TCC ties permissions to a signed app's code-signing identity/DR, not its path; a stable signature lets TCC recognize version N+1 as the same app; a broken/ad-hoc signature causes permission loss.
  **Confidence: high. Verdict: CONFIRMED.** Quinn: *"TCC needs a stable signature for it to be able to record which app was granted permission by the user."* TN2206 (DR satisfied by updates *"and by nothing else"*). Mixing Apple Development + Developer ID causes *"TCC thrash."*

- **Claim:** Bare/CLI/unsigned/ad-hoc executables are identified by FULL PATH in TCC, and `tccutil reset` only works by bundle id — so path-keyed entries cannot be reset and orphan when the path changes.
  **Confidence: high. Verdict: CONFIRMED.** Quinn (Forum 697278): *"tccutil reset only works with bundle ID and not executable path while non-bundle executables are identified in TCC database by full path … This is almost certainly a code signing issue. Either your program is not signed or it's ad hoc signed."*

- **Claim:** Without `SMAppService`, a launchd job needs `AssociatedBundleIdentifiers` in its plist for clean TCC prompt/attribution; `SMAppService` handles this automatically; `tauri-plugin-autostart` does not set it.
  **Confidence: high. Verdict: CONFIRMED.** Quinn (Forum 697278/748097): *"in order for TCC to display a nice prompt for a launch job, it needs to be associated with an app … using the AssociatedBundleIdentifiers property."* Tauri issue #2661 confirms the plugin omits it.

- **Claim:** `SMAppService`/BundleProgram-launched jobs carry an Apple requirement that the app be installed in `/Applications`; gate login-launch to `/Applications`.
  **Confidence: high. Verdict: CONFIRMED.** Quinn (Forum 748097): switching to BundleProgram *"breaks the requirement that your app be installed in /Applications."*

- **Claim:** Registering autostart from a transient/non-`/Applications` path is harmful: the launchd job pins the absolute path, so when the app moves login launch silently fails or points stale, and re-registration does not always update it.
  **Confidence: high. Verdict: CONFIRMED.** StackOverflow 79606133 (agent *"always tries to launch it from /Applications/Foo.app …"*; re-registering *"doesn't make any difference"*); Noodlesoft (login-item helper *"will fail to launch without any prompt"*).

- **Claim:** `tauri-plugin-autostart` on macOS uses the `auto-launch` (zzzgydi) crate, historically only AppleScript + LaunchAgent modes; the LaunchAgent plist is written to `~/Library/LaunchAgents/{app_name}.plist` with the app path as `ProgramArguments[0]` and `Label` = app name.
  **Confidence: high. Verdict: CONFIRMED.** `auto-launch` `src/macos.rs` (`get_dir()?.join("{}.plist")`, `full_args = vec![app_path…]`); plugin default `MacosLauncher::LaunchAgent`.

- **Claim:** The plugin's LaunchAgent path-handling is bug-prone (a PR made it write the bare `.app` path, breaking autostart; correct values differ per mode — `.app` for AppleScript, inner binary for LaunchAgent).
  **Confidence: high. Verdict: CONFIRMED.** Issues #1115 and #634.

- **Claim:** AppleScript mode triggers an Automation/AppleEvents prompt + double pop-ups (controls System Events.app); LaunchAgent mode shows under "Allow in the Background" by the user's full name with no clean removal and orphan entries after uninstall.
  **Confidence: high. Verdict: CONFIRMED.** agentoast commit + Hopp blog.

- **Claim:** Real-world Tauri apps migrating to `SMAppService.mainApp` report it avoids the TCC prompt (self-registration) and shows the app under "Open at Login"; they drop `tauri-plugin-autostart` for `objc2-service-management` / `smappservice-rs` and migrate the legacy plist.
  **Confidence: high. Verdict: CONFIRMED.** agentoast commit (*"The running app registers itself, so no TCC prompt fires …"*); Hopp `smappservice-rs`.

- **Claim:** `SMAppService.register()` returns `kSMErrorLaunchDeniedByUser` if unapproved and `kSMErrorAlreadyRegistered` if already registered; for the main app it launches on subsequent logins; must be called once per user.
  **Confidence: high. Verdict: CONFIRMED.** Apple `register()` doc.

- **Claim:** Apple dev hygiene to avoid TCC churn: Apple Development signing for day-to-day work, Developer ID only for distribution, tested on a separate clean VM.
  **Confidence: high. Verdict: CONFIRMED.** Quinn (Forums 730043, 732031).

- **Claim:** Upstream `auto-launch` added an `SMAppService` MainApp mode via `smappservice-rs`, but `tauri-plugin-autostart`'s public `init` still defaults to/forwards `LaunchAgent` or `AppleScript` and does not expose main-app `SMAppService` login-item registration as the documented path.
  **Confidence: medium. Verdict: CONFIRMED (medium).** `auto-launch` `src/macos.rs` shows the third mechanism; `tauri-plugin-autostart`'s `MacosLauncher` enum still exposes only `LaunchAgent`/`AppleScript`. **Practical implication:** today, getting TCC-safe autostart in Tauri typically means bypassing the plugin and calling `SMAppService.mainApp` directly via `objc2-service-management` / `smappservice-rs`.

---

## Confidence & Verdict Summary

| Area | Net confidence | Verdict posture |
|---|---|---|
| §1 TCC identity model; ad-hoc vs stable persistence | High | All major claims CONFIRMED (minor source-attribution & shorthand caveats noted) |
| §2 Reboot identity mismatch (two differently-signed binaries) | High | CONFIRMED |
| §2 LaunchAgent-vs-LaunchServices *responsible-process attribution* theory | Medium | **UNCERTAIN — do not state as fact**; misattributed evidence flagged |
| §3 Mic-resets-while-others-persist asymmetry | Medium–high | Component mechanisms CONFIRMED; overall synthesis CONFIRMED at medium |
| §4 `SMAppService.mainApp` best-practice fix | High | CONFIRMED |

**Net diagnosis for this app (high confidence):** the reboot re-prompt is driven by the **identity mismatch** — reboot launches the ad-hoc (`cdhash`-DR) dev build while the mic grant is recorded against the stable-cert `/Applications` identity, and an ad-hoc DR does not survive as the same identity. The separate theory that LaunchAgent-vs-LaunchServices attribution alone causes the reset is **not supported** by the cited sources and is flagged uncertain.

---

## Sources

- Apple TN3127 — Inside Code Signing: Requirements: https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- Apple TN3126 — Inside Code Signing: Hashes: https://developer.apple.com/documentation/technotes/tn3126-inside-code-signing-hashes
- Apple TN2206 — macOS Code Signing In Depth: https://developer.apple.com/library/archive/technotes/tn2206/_index.html
- Apple Code Signing Guide — Requirement Language: https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html
- Apple Developer Forums thread 730043 (Quinn — TCC + stable identity / ad-hoc vs Developer ID): https://developer.apple.com/forums/thread/730043
- Apple Developer Forums thread 663889 (Quinn — TCC needs stable signature): https://developer.apple.com/forums/thread/663889
- Apple Developer Forums thread 697278 (Quinn — tccutil/path keying, AssociatedBundleIdentifiers): https://developer.apple.com/forums/thread/697278
- Apple Developer Forums thread 748097 (Quinn — SMAppService, /Applications requirement): https://developer.apple.com/forums/thread/748097
- Apple Developer Forums thread 732031 (Quinn — dev signing hygiene): https://developer.apple.com/forums/thread/732031
- Apple — SMAppService: https://developer.apple.com/documentation/servicemanagement/smappservice
- Apple — SMAppService.mainApp: https://developer.apple.com/documentation/servicemanagement/smappservice/mainapp?language=objc
- Apple — SMAppService.register(): https://developer.apple.com/documentation/servicemanagement/smappservice/register()
- Apple — Updating your app package installer to use the new Service Management API: https://developer.apple.com/documentation/ServiceManagement/updating-your-app-package-installer-to-use-the-new-service-management-api
- Rainforest QA — A deep dive into macOS TCC.db: https://www.rainforestqa.com/blog/macos-tcc-db-deep-dive
- StackOverflow — How to get csreq of macOS application on command line: https://stackoverflow.com/questions/52706542/how-to-get-csreq-of-macos-application-on-command-line
- StackOverflow — SMAppService agent launches from /Applications (path update): https://stackoverflow.com/questions/79606133/when-starting-a-launch-agent-using-smappservice-how-do-you-force-it-to-update-t
- Eclectic Light Co. — Solving problems with Mojave's privacy protection (tccd log trace): https://eclecticlight.co/2019/02/01/solving-problems-with-mojaves-privacy-protection/
- Eclectic Light Co. — Code signing for the concerned 5 (signing and privacy control): https://eclecticlight.co/2019/01/29/code-signing-for-the-concerned-5-signing-and-privacy-control/
- Eclectic Light Co. — Privacy: what TCC does and doesn't (AdhocSignatureCache): https://eclecticlight.co/2023/02/10/privacy-what-tcc-does-and-doesnt/
- Eclectic Light Co. — Should you reset its database or delete it: https://eclecticlight.co/2023/02/09/should-you-reset-its-database-or-delete-it-the-woes-of-tcc/
- Eclectic Light Co. — A guide to Catalina's privacy protection (two copies/identifier+signature): https://eclecticlight.co/2020/01/15/a-guide-to-catalinas-privacy-protection-2-controlling-privacy-settings/
- Eclectic Light Co. — What does the TCC Compatibility database do: https://eclecticlight.co/2018/11/20/what-does-the-tcc-compatibility-database-do/
- Objective-See — Blog 0x4C (tccd daemon model): https://objective-see.org/blog/blog_0x4C.html
- HackTricks — macOS TCC: https://hacktricks.wiki/en/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-tcc/index.html
- Entonos — How to modify TCC on macOS: https://entonos.com/2023/06/23/how-to-modify-tcc-on-macos/
- angelystor — macOS TCC: https://www.angelystor.com/posts/macos_tcc/
- yo-yo-yo-jbo — macos_tcc: https://github.com/yo-yo-yo-jbo/macos_tcc/blob/main/README.md
- Jamf community — How to get TCC database csreq blob programmatically: https://community.jamf.com/general-discussions-2/how-to-get-tcc-database-csreq-blob-programmatically-12684
- Fazm — macOS Accessibility / Automation (AXIsProcessTrusted cache): https://fazm.ai/t/macos-accessibility-automation
- Authon — Why macOS privacy settings lie to you: https://blog.authon.dev/why-macos-privacy-settings-lie-to-you-and-how-to-actually-audit-them
- openai/codex issue 18507 (hardened-runtime audio-input entitlement): https://github.com/openai/codex/issues/18507
- djmunro/hush — macos-permissions docs: https://github.com/djmunro/hush/blob/main/docs/macos-permissions.md
- electron-builder issue 9529 (ad-hoc + hardenedRuntime mic/camera): https://github.com/electron-userland/electron-builder/issues/9529
- stepcodex — Bug: macOS TCC permission prompt (versioned paths): https://www.stepcodex.com/en/issue/bug-macos-tcc-permission-prompt-apple
- stepcodex — Auto-updater leaves orphan TCC entries: https://www.stepcodex.com/en/issue/auto-updater-leaves-orphan-tcc-entries
- Qt blog — The curious case of the responsible process: https://www.qt.io/blog/the-curious-case-of-the-responsible-process
- pingdotgg/t3code issue 728 (terminal launch mic/camera): https://github.com/pingdotgg/t3code/issues/728
- tauri-apps/plugins-workspace issue 1115 (LaunchAgent plist path): https://github.com/tauri-apps/plugins-workspace/issues/1115
- tauri-apps/plugins-workspace issue 634 (LaunchAgent set_app_path fix): https://github.com/tauri-apps/plugins-workspace/issues/634
- tauri-apps/plugins-workspace issue 2661 (missing AssociatedBundleIdentifiers): https://github.com/tauri-apps/plugins-workspace/issues/2661
- tauri-apps/tauri-plugin-autostart: https://github.com/tauri-apps/tauri-plugin-autostart
- tauri-plugin-autostart lib.rs (docs.rs): https://docs.rs/tauri-plugin-autostart/latest/x86_64-pc-windows-msvc/src/tauri_plugin_autostart/lib.rs.html
- zzzgydi/auto-launch src/macos.rs: https://raw.githubusercontent.com/zzzgydi/auto-launch/main/src/macos.rs
- shuntaka9576/agentoast commit (migrate to SMAppService.mainApp): https://github.com/shuntaka9576/agentoast/commit/8c9dfc40c575b6346e4069353f909307ce8e53fa
- Hopp blog — Rust app start on login (smappservice-rs): https://www.gethopp.app/blog/rust-app-start-on-login
- Noodlesoft — Codesigning / notarization woes: https://www.noodlesoft.com/blog/2021/01/25/codesigning-notarization-woes/
