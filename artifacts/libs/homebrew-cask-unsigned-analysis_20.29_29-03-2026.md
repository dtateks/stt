# Homebrew Cask + Unsigned Apps: Evidence-Backed Analysis

**Research Date**: 29-03-2026
**Current Homebrew Version**: 5.0.0+ (November 2025)

---

## 1. Does Homebrew Cask avoid Gatekeeper/Apple trust requirements?

**No.** Homebrew Cask does **not** bypass Gatekeeper — it is actively being removed from doing so.

**Evidence**:

- Homebrew 5.0.0 release notes state: *"Casks without codesigning are deprecated. We will disable all Homebrew/homebrew-cask casks that fail Gatekeeper checks in September 2026."* ([Homebrew 5.0.0](https://brew.sh/2025/11/12/homebrew-5.0.0/))

- Issue #20755 (removing `--no-quarantine`): *"`--no-quarantine` is used to forcibly bypass Gatekeeper... With the above in mind, it's time to deprecate the `--no-quarantine` flag... Intel support is coming to an end from both Apple and Homebrew. This flag is primarily used to override a macOS security mechanism."* ([Homebrew/brew#20755](https://github.com/Homebrew/brew/issues/20755))

- PR #20432 renamed `unsigned` deprecation reason to `fails_gatekeeper_check` — a more accurate descriptor. ([Homebrew/brew#20432](https://github.com/Homebrew/brew/pull/20432))

- Reddit discussion confirms: *"Homebrew no longer allows bypassing Gatekeeper for unsigned/unnotarized software"* ([r/MacOS](https://www.reddit.com/r/MacOS/comments/1owf7du/homebrew_no_longer_allows_bypassing_gatekeeper/))

**Critical deadline**: All casks failing Gatekeeper checks are **disabled on 2026-09-01**.

---

## 2. Can a Homebrew cask run arbitrary install steps equivalent to `install.sh`?

**Yes, technically**, but it is **not acceptable for official Homebrew tap** and faces the same Gatekeeper barrier regardless.

A cask DSL can perform arbitrary `plist` stanzas, `preflight`/`postflight` scripts, and `stage` manipulations. For example:

```ruby
cask "voice-to-text" do
  url "https://example.com/Voice-to-Text.zip"
  sha256 "..."
  
  livecheck.stable.release
  
  stage_only true
  
  app "Voice-to-Text.app"
  
  postflight do
    system "xattr", "-cr", "#{staged_path}/Voice-to-Text.app"
  end
end
```

However:
1. Homebrew's own audit now **rejects** casks that fail Gatekeeper checks (the `fails_gatekeeper_check` deprecation).
2. The `--no-quarantine` flag is **deprecated** and being removed. Even if you remove the quarantine xattr, Apple Silicon **still refuses to execute unsigned native code**.
3. For **your own tap** (third-party), Homebrew does not enforce signing audits — you can host whatever you want. But the official `homebrew/cask` tap will reject you.

---

## 3. Is `xattr -cr` sufficient for non-notarized public distribution?

**No — not on Apple Silicon.**

From Apple's runtime protection update (cited in Homebrew issue #20755):
> *"Macs with Apple silicon also don't permit native arm64 code to execute unless a valid signature is attached."*

Removing `com.apple.quarantine` only strips the Gatekeeper gate — it does **not** make unsigned code executable on Apple Silicon. The CPU literally refuses to run unsigned ARM64 instructions.

On **Intel Macs** (pre-T2): `xattr -cr` + allowing "Anywhere" in System Settings → Privacy & Security can work, but:
- Intel Mac support is being dropped by Apple and Homebrew (moving to Tier 3 in 2027)
- The user experience is poor — users see security warnings and must manually approve

On **Apple Silicon**: There is **no workaround** without signing. Notarization ( Stapled ticket ) is separate from signing but also requires an Apple Developer account.

---

## 4. Best-Practice Recommendation

### For a project with **no Apple Developer account yet** but **maybe one in future**:

| Approach | Pros | Cons |
|----------|------|------|
| **Continue `install.sh` direct distribution** | Works now, no Apple dependency | Degrades over time; Apple Silicon users blocked; no Homebrew discoverability |
| **Ad-hoc signing (`codesign -s -`) + `xattr -cr`** | Free, no Apple Developer account needed; satisfies Apple Silicon execution requirement | No Notarization → users still see Gatekeeper warnings; cannot be distributed via official Homebrew tap |
| **Own Homebrew Tap + ad-hoc signing** | Uses Homebrew infrastructure; works on Apple Silicon; bypasses official tap restrictions | Requires users to add your tap; not discoverable; ad-hoc signature not recognized by Notarization |
| **Apple Developer account + Notarization** | Full distribution story; works seamlessly on all Macs; eligible for official Homebrew tap | $99/year cost; requires build pipeline changes |

### Concrete Recommendation

**Short-term (now to 2026-09)**: 
- Use **ad-hoc signing** (`codesign -s -`) on your `.app` before distributing. This satisfies Apple Silicon's execution requirement. Combine with `xattr -cr` in your `install.sh`.
- Distribute via your own tap or direct download — not the official Homebrew tap.

**Medium-term (before September 2026)**:
- Obtain an **Apple Developer account** ($99/year). The cost is modest for a project with a future.
- Implement **Notarization** in your CI pipeline — it is free with the account, just requires `xcrun stapler` and an `. pkg` or `.dmg` container.

**Why not rely on unsigned Homebrew**:
- As of Homebrew 5.0.0, unsigned casks are deprecated and will be **disabled 2026-09-01**.
- Apple continues to tighten Apple Silicon execution requirements — unsigned native code is blocked at the CPU level.
- The path of least resistance is: **get the Apple Developer account**.

---

## Summary

| Question | Answer |
|----------|--------|
| Does Homebrew Cask bypass Gatekeeper? | **No** — it actively removes this capability; unsigned casks disabled 2026-09-01 |
| Can cask run arbitrary install steps? | **Yes**, but irrelevant — Gatekeeper still blocks unsigned code on Apple Silicon |
| Is `xattr -cr` sufficient? | **No** on Apple Silicon; may work on Intel with manual Gatekeeper override |
| Best recommendation? | **Ad-hoc signing now** (free), **Apple Developer account + Notarization before Sep 2026** |
