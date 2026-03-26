## Findings: Emerging Cross-Platform Desktop App Frameworks vs Tauri (March 2026)

### Summary
Tauri v2 remains the strongest overall choice for new Windows + macOS desktop apps in 2026. The "newer/better than Tauri" landscape has genuinely new entrants — most notably **Electrobun v1** (Feb 2026) and **Krema** (Feb 2026), plus the Rust-ecosystem UI framework **Dioxus 0.7** (Jan 2026). None of these unseat Tauri as the overall default. Dioxus is not a Tauri competitor at all — it is built **on top of** Tauri for desktop. Electrobun is a credible niche player for TypeScript teams. Krema is interesting for Java shops but has a restrictive license. Forge (Deno) is too early-stage to recommend. The search confirmed that "dinoxous" was almost certainly Dioxus — a React-like Rust UI framework, not a Tauri competitor.

---

### Q1: Are there serious contenders newer than or meaningfully different from Tauri for Windows + macOS in 2026?

**Yes, four genuinely new entrants appeared in 2025-2026:**

| Framework | Launch Date | Core Architecture | Desktop Bundle | Mobile | Maturity |
|-----------|-----------|-------------------|---------------|--------|----------|
| **Electrobun v1** | Feb 6, 2026 | TypeScript/Bun + system WebView | ~12 MB | ❌ | v1 stable, 6 weeks old |
| **Krema** | Feb 2026 | Java 25 + system WebView (Project Panama FFI) | ~5 MB | ❌ | v0.3.x, very fresh |
| **Dioxus 0.7** | Jan 2026 | Rust (React-like UI) + Tauri backend | <5 MB | ✅ (alpha) | Stable, actively developed |
| **Forge (Deno)** | Dec 2025 (alpha) | Rust + Deno + system WebView | ~15 MB | ❌ | Alpha, 1 GitHub star |

**Established alternatives (not new, but worth knowing exist):**

| Framework | Maturity | Bundle Size | Key Differentiator |
|-----------|----------|-------------|-------------------|
| Electron | Very mature (115k+ stars, VS Code-scale apps) | 80-200 MB | Ecosystem, not going anywhere |
| Neutralino | Stable but small community | 1-5 MB | Smallest footprint, no Node.js |
| Flutter Desktop | Mature | 20-30 MB | True cross-platform incl. mobile/web |

---

### Q2: Which emerging frameworks are most credible?

**Tier 1 — Credible and worth evaluating:**

1. **Electrobun v1** — Most credible new entrant. Created by a solo developer (Yoav) with 7 years at Webflow. Two years of development. v1 is locked architecture. Real production user reports 70% of development time vs Tauri for equivalent app. ~10k GitHub stars in 6 weeks. Typed RPC, auto-updates, OOPIF isolation. Desktop-only (no mobile roadmap). Risk: single-person project, 6-week-old v1.

2. **Dioxus** — Credible but **not a Tauri competitor**. It is a React-like Rust UI framework (like Flutter but in Rust, targeting web as first-class). Desktop renderer uses Tauri under the hood (wry/tao). Dioxus 0.7 (Jan 2026) adds full-stack via Axum integration and experimental hot-patching. If you want a pure-Rust declarative UI and willing to learn Rust properly, Dioxus is the framework — it is NOT a lightweight Electron-alternative, it is a full UI toolkit.

**Tier 2 — Interesting but too early or too niche:**

3. **Krema** — "Tauri but for Java." Interesting architecture: Java 25 Project Panama FFI instead of JNI, system WebView, ~5MB bundles. Created Feb 2026, v0.3.x. **Critical concern: BSL 1.1 license restricts commercial use until 2030.** Dealbreaker for most commercial projects.

4. **Forge (Deno)** — Rust + Deno TypeScript runtime, system WebView, ~15MB bundles, capability-based security. Alpha status (v1.0.0p-steel-donut), only 1 GitHub star, 2 contributors. Not ready for consideration.

---

### Q3: Is Dioxus the likely framework the user remembered? Yes. But they may misunderstand what it is.

**Confirmed: "dinoxous" → Dioxus.**

Key clarifications from Dioxus creator (jkelleyrtp on Hacker News):
- "Dioxus is a frontend framework similar to Next.js and other react-based frameworks. Tauri is an electron replacement — a portable webview container."
- "Dioxus desktop is built off Tauri. Right now there aren't many Dioxus abstractions over the menubar, event handling, etc."
- "We are shooting for something like Flutter (web, desktop, mobile, embedded) but where the web is the defining feature."

**Dioxus 0.7 (Jan 2026) new features:**
- Sub-second hot reloads including experimental Rust hot-patching (`dx serve --hotpatch`)
- Batteries-included full-stack: plugs directly into Axum with "Server Functions"
- Single CLI (`dx`) handles web, desktop, mobile, and bundling
- CLI can serve, bundle, and ship to web, macOS, Linux, Windows, Android, iOS from same component tree

**Dioxus Desktop architecture:**
- Uses Tauri under the hood (specifically wry + tao crates)
- No WASM on native desktop — just regular Rust executable
- Future: custom web renderer with WGPU integration called "Blitz" (in progress)
- Bundle size: typically under 5MB (same as Tauri since it IS Tauri)

**Dioxus is the right choice if:**
- You want a React-like declarative UI in pure Rust
- You want web as a first-class target (not just Electron-style wrapping)
- You want to share code between web, desktop, and mobile
- You are willing to invest in learning Rust deeply

**Dioxus is NOT the right choice if:**
- You want a lightweight Electron replacement for an existing web app
- You want minimal Rust exposure — use Tauri instead
- You need mature desktop abstractions (menubar, tray, etc. still limited)

---

### Q4: Are any of these actually better than Tauri overall, or only better in niches?

**Tauri wins overall. No challenger wins on all dimensions.**

| Dimension | Tauri v2 | Electrobun | Krema | Dioxus | Forge |
|-----------|----------|------------|-------|--------|-------|
| **Maturity** | ✅ 88k stars, stable 2.x | ⚠️ 10k stars, 6-week v1 | ❌ BSL license, v0.3 | ✅ Stable, well-funded | ❌ Alpha, 1 star |
| **Ecosystem** | ✅ Growing, 500k weekly downloads | ⚠️ Nascent | ❌ Tiny | ✅ Large Rust ecosystem | ❌ None |
| **Native integration** | ✅ Rust plugins, mature | ⚠️ Basic, growing | ⚠️ Basic | ⚠️ Uses Tauri | ⚠️ Basic |
| **Performance/size** | ✅ 2-10 MB bundles | ✅ ~12 MB bundles | ✅ ~5 MB | ✅ <5 MB | ✅ ~15 MB |
| **Developer experience** | ⚠️ Rust learning curve | ✅ TypeScript-first | ⚠️ Java-heavy | ⚠️ Steep Rust | ⚠️ Deno + Rust |
| **Mobile support** | ✅ Tauri 2.x | ❌ Desktop only | ❌ | ⚠️ Alpha | ❌ |
| **Packaging/distribution** | ✅ Mature tooling | ✅ Auto-update, signing | ⚠️ Early | ✅ `dx bundle` | ⚠️ Early |
| **Long-term viability** | ✅ Founded org, 100+ contributors | ⚠️ Solo creator risk | ⚠️ License risk | ✅ Community | ❌ Unclear |

**Where challengers win:**
- **Electrobun**: Better DX for TypeScript-only teams. No Rust required. 70% of Tauri dev time reported for equivalent app. Smaller updates (14KB differential patches).
- **Krema**: Only option for Java-first teams who want system WebView + modern frontend.
- **Dioxus**: Best for teams wanting pure Rust + React-like patterns + web-first targeting. Not a Tauri replacement.
- **Forge**: Interesting architecture but too early.

---

### Q5: Practical recommendation

| Framework | Recommendation | Rationale |
|-----------|----------------|------------|
| **Tauri v2** | **Default choice** | Unchallenged overall winner. Mobile, ecosystem, maturity, bundle size all strong. |
| **Electrobun** | **Watchlist + evaluate for TS teams** | Genuinely promising. Watch 6-12 months for community growth and solo-creator risk to resolve. Good for TS-heavy teams who don't want Rust. |
| **Dioxus** | **Consider if pure Rust + web-first** | Not a Tauri competitor. Complementary. Use when you want React-like patterns in Rust with web as primary target. |
| **Krema** | **Ignore (license)** | BSL 1.1 is a commercial dealbreaker. Not recommended until license changes. |
| **Forge** | **Ignore (too early)** | Alpha with 1 GitHub star. Not production-ready. |
| **Neutralino** | **Watchlist for ultra-lightweight** | Not new, but worth knowing exists if Tauri feels too heavy and Electron is too bloated. |
| **Electron** | **Use for complex apps** | Not going away. VS Code, Slack, Discord scale. Use when you need maximum ecosystem. |

**Verdict for Windows + macOS in 2026:**
- **General default: Tauri v2** — still the right call for most projects.
- **TypeScript team, no Rust, no mobile: Electrobun** — watch 6-12 months, then evaluate.
- **Pure Rust + web-first: Dioxus** — not a Tauri replacement, but the right tool for its use case.
- **Java team: evaluate carefully** — Krema is interesting but license must change first.

---

### Source Quality Assessment

| Source | Tier | Date | Notes |
|--------|------|------|-------|
| Electrobun creator blog (blackboard.sh) | 1 | Mar 2026 | Primary source, v1 launch announcement |
| Dioxus official docs / HN discussion | 1 | Jan 2026 | Creator directly addresses Tauri relationship |
| Krema GitHub / build site | 1 | Feb 2026 | Primary source, official project |
| Forge official site / GitHub | 1 | Dec 2025 | Primary source, alpha status noted |
| PkgPulse Tauri vs Electron comparison | 2 | Mar 2026 | Recent, well-sourced |
| YouTube: Electrobun vs Tauri (KTG Analysis) | 2 | Mar 2026 | Recent comparison, credible channel |
| JVM Weekly newsletter (Krema coverage) | 2 | Feb 2026 | Industry coverage |
| Medium / blog comparisons | 3 | Jan-Mar 2026 | Useful but secondary |

---

### Gaps

- **Exact market share data** unavailable — npm download numbers (Tauri ~500k/week, Electron ~5M/week) are the best proxy but conflate with dependency downloads, not app distribution.
- **Electrobun long-term viability** cannot be assessed — 6 weeks post-v1 is too early to know if solo creator risk materializes.
- **Krema enterprise adoption** unknown — only community data available, no named production apps.
- **Forge contributor count** (2) and star count (1) suggest it may not survive 2026.
- **Dioxus mobile** is alpha — cannot recommend for production mobile today.
- **Electrobun bundling size** claims (~12MB) verified via ASCII News and InfoWorld but not independently benchmarked in this research.

---

### Confidence

**Level:** HIGH for Tauri dominance. **MEDIUM** for emerging frameworks (rapidly evolving, limited production data).

**Rationale:** Multiple Tier 1-2 sources from March 2026 consistently show Tauri v2 as the default choice for new projects. Electrobun and Dioxus findings verified via primary sources and creator statements. Krema's license concern is factual from official project documentation. Forge's alpha status confirmed via GitHub.

---

### Sources

[1] Electrobun v1 Launch — UBOS: https://ubos.tech/news/electrobun-v1-launch-a-fast-tiny-cross%E2%80%91platform-desktop-app-framework/ (Tier 1)
[2] Electrobun creator blog (Yoav): https://blackboard.sh/blog/electrobun-v1 (Tier 1)
[3] Dioxus 0.7 announcement (Medium): https://medium.com/@trivajay259/dioxus-0-7-the-rust-ui-release-that-finally-feels-full-stack-everywhere-89f482ee97e3 (Tier 2)
[4] Dioxus HN discussion re: Tauri relationship: https://news.ycombinator.com/item?id=42389004 (Tier 1 — creator statement)
[5] Krema official site: https://krema.build/ (Tier 1)
[6] Krema GitHub: https://github.com/krema-build/krema (Tier 1)
[7] Forge Deno official site: https://forge-deno.com/ (Tier 1)
[8] Forge GitHub: https://github.com/LayerDynamics/forge (Tier 1)
[9] PkgPulse — Best Desktop App Frameworks 2026: https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026 (Tier 2)
[10] YouTube — Electrobun vs Tauri comparison: https://www.youtube.com/watch?v=SQWKZZRm41o (Tier 2)
[11] JVM Weekly — Krema coverage: https://www.jvm-weekly.com/p/the-rest-of-the-story-february-edition (Tier 2)
[12] ASCII News — Electrobun 12MB bundles: https://ascii.co.uk/news/article/news-20260309-dd9f0029/electrobun-typescript-desktop-apps-with-12mb-bundles (Tier 2)
[13] InfoWorld — Electrobun first look: https://www.infoworld.com/article/4137964/first-look-electrobun-for-typescript-powered-desktop-apps.html (Tier 2)
[14] PkgPulse — Electron vs Tauri 2026: https://www.pkgpulse.com/blog/electron-vs-tauri-2026 (Tier 2)
[15] Tauri vs Dioxus (Medium): https://medium.com/solo-devs/tauri-vs-dioxus-the-ultimate-rust-showdown-5d8d305497d6 (Tier 3)