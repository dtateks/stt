# Findings: Cross-Platform Desktop App Stacks for Windows + macOS in 2026

**Research Date:** 26 March 2026  
**Scope:** Desktop app frameworks targeting Windows and macOS (primary), with Linux and mobile as secondary considerations  
**Methodology:** Triangulated from 15+ sources including official docs, engineering blogs, benchmark reports, and community analyses published Q4 2025–Q1 2026

---

## Summary

The cross-platform desktop landscape in 2026 is dominated by three architectural approaches: **web-based runtimes** (Electron, NW.js, Neutralino), **native-WebView hybrids** (Tauri v2), and **compiled UI toolkits** (Flutter, .NET MAUI, Avalonia, Qt, Uno Platform). Electron remains the most proven and ecosystem-rich choice, but Tauri v2 has emerged as the default "future-facing" pick for new projects — delivering 10–20x smaller binaries and 60–80% less memory usage at the cost of a steeper Rust learning curve. Flutter desktop has stabilized and performs well for custom-UI applications but carries Dart learning overhead. .NET MAUI and Uno Platform serve enterprise .NET shops; Qt remains the performance king for complex native apps. The right choice depends critically on team skills, performance requirements, and whether mobile targets are on the roadmap.

---

## Key Findings

### 1. Leading Desktop App Stacks in 2026

#### Electron
- **Ecosystem dominance:** ~5M weekly npm downloads, 115K+ GitHub stars, 10+ years of production hardening [PkgPulse Blog](https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- **Production users:** VS Code, Figma desktop, 1Password, Discord, Slack, GitHub Desktop, Postman, Spotify — confirming it handles complex, scale-grade applications [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- **Architecture:** Bundles full Chromium + Node.js runtime; guarantees identical rendering across all platforms because every platform runs the same browser engine [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- **Current version:** Electron 34.x as of early 2026 [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- **Bundle size:** 80–200MB depending on app complexity and bundler configuration [PkgPulse Blog](https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- **Memory at idle:** 150–250MB for simple apps; 200–500MB for active multi-window scenarios [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)
- **Cold start time:** 1.8–4 seconds; 3–4x slower than Tauri due to Chromium loading [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- **Security model:** IPC-bridge pattern with Node.js integration; broader attack surface than Tauri due to full Node.js runtime [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- **Mobile support:** None — Electron Forge targets desktop only [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)

#### Tauri v2
- **Rapid adoption:** ~500K downloads, 88K+ GitHub stars; grew from 25K stars in 2022 to 85K+ by 2026 — fastest-growing desktop JS framework [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026) [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)
- **Architecture:** Uses OS-native WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux) + Rust backend compiled to native binary [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- **Bundle size:** 2–10MB — 10–100x smaller than Electron for equivalent functionality [PkgPulse Blog](https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- **Memory at idle:** 15–50MB for basic apps; 40–150MB for active use; multi-window (6 windows) uses ~172MB vs Electron's ~409MB [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026) [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- **Cold start time:** 0.4–0.8 seconds — 3–4x faster than Electron [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026) [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- **CPU at idle:** 0.1–0.5% vs Electron's 1–5%; meaningful for battery life on laptops [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- **Mobile support (v2):** iOS and Android added in late 2024 — same codebase targets desktop + mobile [PkgPulse Blog](https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- **Security model:** Rust's memory safety + allowlist-based IPC; significantly stronger out-of-the-box than Electron [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- **Ecosystem gap:** Fewer plugins, fewer Stack Overflow answers, smaller community vs Electron — but growing rapidly [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- **Key limitation:** WebView rendering differs by OS (WebKit vs WebView2 vs WebKitGTK); requires cross-platform testing [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

#### Flutter Desktop
- **Maturity:** Stable desktop support since Flutter 3.22; Impeller renderer (beta on macOS, stable on Windows/Linux in 2026) addresses prior GPU performance issues [Dasroot](https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/) [Ditto](https://www.ditto.com/blog/the-future-is-bright-for-flutter-in-2026)
- **Architecture:** Dart compiled to native ARM/x64 via Skia/Impeller engine; widget-based declarative UI [Red Sky Digital](https://redskydigital.com/au/comparative-analysis-of-electron-tauri-and-flutter-for-desktop-apps/)
- **Bundle size:** 25–40MB on macOS, 40–60MB on Windows for minimal apps; 150–400MB RAM for complex UIs [Dasroot](https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/)
- **Performance:** 60 FPS on modern hardware; Impeller reduces CPU usage ~40% vs Skia on macOS; cold start ~40% faster with 3.38+ [Dasroot](https://dasroot.net/posts/2026/02/flutter-desktop-applications-windows-macos-linux/)
- **Platform support:** macOS 10.15+, Windows 10/11, Linux stable, plus mobile and Web [Dasroot](https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/)
- **Key strength:** Pixel-perfect custom UIs; hot reload is industry-leading for UI iteration [Red Sky Digital](https://redskydigital.com/au/comparative-analysis-of-electron-tauri-and-flutter-for-desktop-apps/)
- **Key weakness:** Dart learning curve; AI tooling less trained on Dart reducing AI assistance quality; some missing libraries requiring custom implementation [YouTube/Samik Choudhury](https://www.youtube.com/watch?v=evW3uqwkC0w)

#### .NET MAUI
- **Ecosystem:** Microsoft-backed; strong enterprise adoption per .NET MAUI Day London 2026; integration with Azure, Microsoft 365, and Visual Studio [Syncfusion](https://www.syncfusion.com/blogs/post/dotnet-maui-day-london-2026-event-recap)
- **Platform support:** Windows, macOS, Android, iOS from single codebase; Linux support is unofficial/limited [Vocal Media](https://vocal.media/education/how-to-choose-between-avalonia-ui-net-maui-and-uno-platform-for-desktop-projects)
- **Performance:** ~80MB bundle for typical desktop app; Entity Framework + AOT compilation improves performance in .NET 8/9/10 [Syncfusion](https://www.syncfusion.com/blogs/post/dotnet-maui-day-london-2026-event-recap)
- **Developer experience:** Visual Studio Hot Reload; XAML + MVVM familiar to WPF/Xamarin developers [Syncfusion](https://www.syncfusion.com/blogs/post/dotnet-maui-day-london-2026-event-recap)
- **macOS limitation:** iOS/macOS testing requires Mac; Visual Studio 2026 removed Windows-based Hot Restart for iOS [Dev.to](https://dev.to/biozal/hot-restart-for-ios-is-not-included-in-visual-studio-2026-what-net-maui-developers-need-to-know-28n8)
- **Best for:** Enterprise .NET shops needing mobile+desktop; internal tools; line-of-business apps [IT Path Solutions](https://www.itpathsolutions.com/dotnet-maui-development-guide)

#### Avalonia UI
- **Nature:** Open-source .NET UI framework inspired by WPF; XAML + data binding; runs on Windows, macOS, Linux [Chudovo](https://medium.com/@chudovo/avalonia-vs-maui-vs-electron-choosing-the-right-cross-platform-strategy-706d0ac5e285)
- **Bundle size:** ~16MB for basic apps; lower memory usage than MAUI [Tekin](https://dev.tekin.cn/en/blog/2026-macos1015-windows-cross-platform-desktop-ui-framework-guide)
- **Platform support:** Desktop-focused (Windows, macOS, Linux); mobile experimental [Vocal Media](https://vocal.media/education/how-to-choose-between-avalonia-ui-net-maui-and-uno-platform-for-desktop-projects)
- **Strength:** Desktop-first approach; highly customizable UI; efficient rendering [Chudovo](https://medium.com/@chudovo/avalonia-vs-maui-vs-electron-choosing-the-right-cross-platform-strategy-706d0ac5e285)
- **Limitation:** Smaller community than MAUI; less enterprise tooling [Chudovo](https://medium.com/@chudovo/avalonia-vs-maui-vs-electron-choosing-the-right-cross-platform-strategy-706d0ac5e285)

#### Qt (C++)
- **Architecture:** Native C++ compiled; Qt Widgets or Qt Quick (QML) for UI; model-view paradigm [Software Logic](https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025)
- **Performance:** 20–50MB binaries; idle RAM 20–50MB; fastest startup of all options; direct GPU/Metal/Vulkan/DirectX integration [Software Logic](https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025)
- **Platform support:** Windows, macOS, Linux, plus embedded; Qt Quick supports mobile [Tibicle](https://tibicle.com/blog/best-framework-for-desktop-application-in-2026)
- **Ecosystem:** Mature (25+ years); used by Autodesk Maya, VirtualBox, DaVinci Resolve [Tibicle](https://tibicle.com/blog/best-framework-for-desktop-application-in-2026)
- **Learning curve:** Steepest — requires C++ and QML; professional IDEs expensive (commercial Qt licenses) [Tekin](https://dev.tekin.cn/en/blog/2026-macos1015-windows-cross-platform-desktop-ui-framework-guide)
- **Best for:** Complex native apps, CAD/engineering software, 3D modeling, video processing, embedded UI [Software Logic](https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025)

#### Uno Platform
- **Nature:** Open-source .NET UI framework; C# + XAML; compiles to native desktop + WebAssembly [Uno Platform](https://platform.uno/blog/uno-platform-6-4/)
- **Version 6.4 (Nov 2025):** .NET 10 support, Visual Studio 2026 support, Skia optimizations, agentic AI via Studio 2.0 [InfoQ](https://www.infoq.com/news/2025/11/uno-platform-6-4-agentic/)
- **Platform support:** Windows (WinUI/WinAppSDK or Skia), macOS (Skia), Linux (Skia via Gtk), WebAssembly, Android, iOS — 9+ targets from one codebase [Uno Platform](https://platform.uno/docs/articles/getting-started/requirements.html)
- **Pricing:** Core framework free (Apache 2.0); Studio Pro tier $39/mo for AI-assisted design tools [Uno Platform Select](https://platform.uno/select-subscription/)
- **Key differentiator:** WebAssembly target enables browser-based deployment alongside native desktop [Uno Platform](https://platform.uno/blog/uno-platform-6-3/)
- **Best for:** Enterprise .NET teams needing web+desktop+mobile; WPF/Xamarin migration paths [InfoQ](https://www.infoq.com/news/2025/10/uno-platform-6-3/)

#### Neutralino
- **Nature:** Ultra-lightweight; no bundled runtime; uses OS WebView + optional C++ extensions [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- **Bundle size:** 1–5MB — smallest of all options [PkgPulse Blog](https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026)
- **Memory:** 15–30MB at idle [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)
- **Ecosystem:** ~7.5K GitHub stars; limited plugins, community, Stack Overflow answers [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)
- **Best for:** Simple utilities, tray apps, lightweight tools where Electron/Tauri overhead is disproportionate [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

---

### 2. Performance Comparison

| Metric | Electron | Tauri v2 | Flutter | .NET MAUI | Qt C++ |
|--------|----------|----------|---------|-----------|--------|
| Cold start | 1.8–4s | 0.4–0.8s | Fast | Moderate | Fastest (native) |
| Idle RAM | 150–250MB | 15–50MB | 50–150MB | ~80MB | 20–50MB |
| Active RAM | 200–500MB | 40–150MB | 150–400MB | ~80MB+ | Low |
| CPU idle | 1–5% | 0.1–0.5% | Low | Low | Lowest |
| Bundle size | 80–200MB | 2–10MB | 25–60MB | ~50–80MB | 20–50MB |

Sources: [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026) [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison) [Dasroot](https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/) [Software Logic](https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025)

**Key observations:**
- Tauri v2 leads in memory efficiency by leveraging OS WebViews instead of bundling Chromium [PkgPulse](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- Qt C++ leads in raw startup and CPU efficiency due to native compilation without any runtime overhead [Software Logic](https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025)
- Flutter's Impeller renderer (available in 3.38+) cuts macOS CPU ~40% vs prior Skia path [Dasroot](https://dasroot.net/posts/2026/02/flutter-desktop-applications-windows-macos-linux/)
- Multi-window scenarios dramatically favor Tauri: 6 windows ~172MB vs Electron ~409MB [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)

---

### 3. Ecosystem Maturity

| Framework | GitHub Stars | npm Downloads | Age | Production Apps |
|-----------|-------------|---------------|-----|----------------|
| Electron | 115K+ | ~5M/week | 2013 | VS Code, Figma, Discord, Slack |
| Tauri | 88K+ | ~500K downloads | 2019 | Rising (e.g., Agents UI) |
| Flutter | N/A (mono repo) | N/A | 2015 (desktop stab. 2022) | Google Ads, eBay, BMW |
| .NET MAUI | N/A | N/A | 2022 (evolved from Xamarin) | Enterprise LOB apps |
| Qt | N/A (proprietary) | N/A | 1991 | Maya, VirtualBox, DaVinci |
| Avalonia | N/A | N/A | 2014 | Growing enterprise use |
| Uno Platform | N/A | N/A | 2018 | Enterprise multi-platform |
| Neutralino | 7.5K | N/A | 2018 | Niche/simple tools |

Sources: [PkgPulse](https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026) [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)

**Electron ecosystem advantages:**
- `electron-builder`, `electron-updater`, `electron-store` all have millions of weekly downloads [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)
- Thousands of npm packages purpose-built for Electron [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- Deep IDE support (VS Code itself!), debugging tools, and comprehensive documentation [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

**Tauri ecosystem gap is closing:**
- Official plugin system in v2 covers file I/O, HTTP, notifications, system tray, auto-updater [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- Rust crate ecosystem supplements native functionality [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

---

### 4. Native Integration

| Framework | Deep OS Access | System Tray | Auto-Update | Notifications |
|-----------|---------------|-------------|-------------|---------------|
| Electron | Full Node.js APIs | Yes (mature) | Yes (mature) | Yes |
| Tauri v2 | Rust + plugin system | Yes | Yes (v2) | Yes |
| Flutter | Platform channels/FFI | Via plugins | Via plugins | Via plugins |
| .NET MAUI | Full native access | Yes | Yes | Yes |
| Qt | Full C++ native | Yes | Yes | Yes |
| Neutralino | Limited (extensions) | Via plugin | Basic | Via plugin |

Sources: [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026) [IT Path Solutions](https://www.itpathsolutions.com/dotnet-maui-development-guide)

**Key native integration notes:**
- Electron's mature auto-updater is production-proven in VS Code and Slack [PkgPulse](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- Tauri v2's plugin system is newer but covers essential native features [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- Flutter platform channels add complexity for deep native access but maintain single-language codebase [Dasroot](https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/)
- .NET MAUI provides deepest native API access for Windows/macOS via .NET runtime [Syncfusion](https://www.syncfusion.com/blogs/post/dotnet-maui-day-london-2026-event-recap)

---

### 5. Developer Experience

| Framework | Learning Curve | Hot Reload | Frontend Flexibility | IDE Support |
|-----------|---------------|------------|---------------------|-------------|
| Electron | Easiest (JS/HTML/CSS) | Chrome DevTools | Any web framework | Excellent |
| Tauri | Medium (Rust backend) | Yes (via Vite) | Any web framework | Good (VS Code + Rust analyzer) |
| Flutter | Medium (Dart) | Best-in-class (<1s) | Flutter-only widgets | Excellent (Android Studio, VS Code) |
| .NET MAUI | Easy for .NET devs | Yes (VS Hot Reload) | XAML-based | Excellent (Visual Studio) |
| Qt | Steep (C++ + QML) | Limited | Qt Widgets/QML only | Qt Creator (paid) |
| Neutralino | Easiest | Yes | Any web framework | Good |

Sources: [YouTube/Samik Choudhury](https://www.youtube.com/watch?v=evW3uqwkC0w) [Oflight](https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026) [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)

**Electron DX strengths:**
- Zero new language for web developers; entire stack is JavaScript/TypeScript [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- Frontend code ports almost directly from existing web apps [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- `npm create electron-app` or Electron Forge scaffolding gets prototypes running in minutes [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

**Tauri DX trade-offs:**
- Basic Tauri apps need minimal Rust — official plugins handle file I/O, HTTP, notifications [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- Complex backend logic requires Rust knowledge; steeper than Electron for JS-only teams [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- AI coding assistance works well with Rust (well-represented in training data) vs less common for Dart [YouTube/Samik Choudhury](https://www.youtube.com/watch?v=evW3uqwkC0w)

**Flutter DX strengths:**
- Hot reload <1 second for UI changes — industry-leading for design iteration [Oflight](https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026)
- Dart is simple and learnable in 1–2 weeks for basics [Oflight](https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026)
- `flutter doctor` command helps beginners diagnose environment issues [Oflight](https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026)

---

### 6. Packaging and Distribution

**macOS requirements (2026):**
- Code signing + notarization mandatory for Developer ID distribution; unsigned apps blocked by Gatekeeper on macOS Sequoia+ [SSL.com](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-or-ov/) [Packt](https://www.packtpub.com/qa-co/learning/tech-news/apple-plans-to-make-notarization-a-default-requirement-in-all-future-macos-updates)
- Requires paid Apple Developer Program ($99/year), Developer ID Application certificate, app-specific password, notarytool submission [XOJO Blog](https://blog.xojo.com/2026/03/18/code-signing-on-macos-what-developers-need-to-know-part-2/)
- Stapled notarization ticket required on every update [Apptimized](https://apptimized.com/en/news/mac-notarization-process/)

**Windows requirements:**
- Code signing recommended (Authenticode OV certificates ~$200/year); EV required only for drivers [SSL.com](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-or-ov/)
- MSIX packaging preferred for Microsoft Store; Inno Setup, NSIS, Squirrel for classic installers [SigmaSolve](https://www.sigmasolve.com/blog/cross-platform-desktop-app-development/)
- SmartScreen reputation builds over time; unsigned apps face warnings but not hard blocks [Microsoft Learn](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/code-signing-reqs)

**Cross-platform tooling:**
- Electron: `electron-builder` and `electron-forge` handle packaging + code signing for both platforms [PkgPulse](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026)
- Tauri: `cargo tauri build` handles bundling; signing scripts require separate certs per platform [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- Flutter: Platform-native builds handled by `flutter build`; signing handled by platform-specific tooling [Dasroot](https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/)
- All frameworks require separate Apple Developer and Windows signing certificates; no unified cross-platform signing [SigmaSolve](https://www.sigmasolve.com/blog/cross-platform-desktop-app-development/)

---

### 7. Long-Term Risk Assessment

| Framework | Maintenance Risk | Community Trajectory | Corporate Backer |
|-----------|-----------------|---------------------|-----------------|
| Electron | Low — 10+ years, massive install base | Stable/incremental growth | GitHub/Microsoft |
| Tauri | Low-Medium — Rust ecosystem growing; v2 stable | Rapid growth (35% YoY) | Independent, VC-backed |
| Flutter | Low — Google-backed, massive adoption | Strong growth | Google |
| .NET MAUI | Low — Microsoft-backed, enterprise contracts | Steady growth | Microsoft |
| Qt | Low — 30+ years, B2B contracts | Stable | Qt Group (public company) |
| Avalonia | Medium — community-driven | Growing | Independent |
| Uno Platform | Medium — paid tier dependency | Growing | Independent |
| Neutralino | High — small community, limited resources | Slow growth | Independent |

Sources: [Oflight](https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026) [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)

**Key risk factors:**
- Electron: No mobile support means ecosystem may fragment toward Tauri v2 for new projects [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- Tauri: API surface still evolving (v2 broke some v1 patterns); migration cost for complex Electron apps [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)
- Neutralino: Smallest community = highest risk of abandonment or unmaintained dependencies [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- Qt: Commercial licensing costs; open-source version requires GPL compliance — not suitable for all projects [Tekin](https://dev.tekin.cn/en/blog/2026-macos1015-windows-cross-platform-desktop-ui-framework-guide)

---

## Best Stack by Use Case

### Best Overall for a New App in 2026
**Tauri v2** — unless team is exclusively JavaScript-only with urgent time-to-market, in which case **Electron** remains pragmatic.

Rationale: Tauri v2 delivers objectively better end-user experience (10–20x smaller, 60–80% less RAM, 3–4x faster startup) with mobile support as a bonus. The Rust learning curve is real but bounded — basic apps need minimal Rust via official plugins. For web teams, the frontend is still web code (React/Vue/Svelte). The ecosystem gap is closing rapidly with v2's plugin system. [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

### Fastest to Ship
**Electron** — web teams are productive immediately with no new language, mature scaffolding (Electron Forge, electron-vite), and 10 years of patterns, plugins, and Stack Overflow answers.

### Smallest/Lightest
**Neutralino** (1–5MB bundle) for trivial apps. **Tauri v2** (2–10MB) for full-featured apps requiring native APIs.

### Best Custom UI / Design-Rich Apps
**Flutter** — widget-based declarative UI with pixel-perfect consistency across platforms, 60 FPS animations, and the industry's best hot reload for UI iteration. [Red Sky Digital](https://redskydigital.com/au/comparative-analysis-of-electron-tauri-and-flutter-for-desktop-apps/)

### Best for Web Teams
**Electron** for immediate productivity; **Tauri v2** as the recommended upgrade path for long-term projects.

### Best for C# / .NET Shops
**.NET MAUI** for mobile-first enterprise apps. **Avalonia UI** for desktop-focused with Linux requirement. **Uno Platform** for teams needing WebAssembly + desktop + mobile.

### Best for Performance-Critical / Native Apps
**Qt C++** for engineering-grade performance, direct GPU access, and 3D/real-time workloads. Only choice when no web stack is acceptable and C++ expertise exists.

---

## Final Ranking and Recommendation Matrix

| Criterion | Winner | Runner-Up | Notes |
|-----------|--------|-----------|-------|
| Binary size | Neutralino (1–5MB) | Tauri (2–10MB) | Electron is 80–200MB |
| Memory efficiency | Tauri v2 | Qt C++ | Electron uses 3–5x more |
| Startup speed | Qt C++ | Tauri v2 | Native compilation advantage |
| Ecosystem maturity | Electron | .NET MAUI | 10 years, massive npm |
| Consistent rendering | Electron | Flutter | Chromium everywhere vs OS WebView |
| Mobile support | Tauri v2 | Flutter | Both support iOS/Android |
| Developer ease | Electron | Flutter | JS/HTML/CSS familiarity |
| Custom UI power | Flutter | Qt | Declarative widgets vs native |
| Enterprise .NET | Uno Platform | Avalonia | WebAssembly + WinUI |
| Long-term stability | Qt | Electron | 30+ years proven at scale |
| Security | Tauri v2 | Qt | Rust memory safety + allowlist |
| AI tooling support | Electron/Tauri | Flutter | More training data available |

**Overall recommendation for most teams in 2026:**
1. **Tauri v2** — best weight-to-feature ratio, mobile bonus, future-facing
2. **Electron** — only if ecosystem or time-to-market trumps performance
3. **Flutter** — if custom UI/design iteration is paramount and Dart acceptable
4. **Uno Platform** — .NET teams needing web+desktop+mobile from one codebase
5. **.NET MAUI** — enterprise Microsoft shops with mobile+desktop needs
6. **Qt C++** — performance-critical native apps with C++ expertise
7. **Avalonia** — .NET/WPF devs targeting desktop-only with Linux
8. **Neutralino** — trivial utility apps only

---

## Important Caveats

1. **WebView inconsistencies on Tauri:** Rendering differs across Windows (WebView2/Edge), macOS (WKWebView/Safari), and Linux (WebKitGTK) — cross-platform QA is mandatory, not optional. WebKitGTK on Linux particularly lags in feature support. [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

2. **Electron migration to Tauri is not free:** Backend logic using Node.js APIs must be rewritten in Rust. Frontend ports nearly 1:1. Medium-sized app (50K+ lines) migration costs are significant. [Oflight](https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison)

3. **Flutter desktop is not mobile desktop:** Desktop and mobile Flutter have different widget libraries and platform conventions. Don't assume a mobile Flutter app translates directly to desktop UX quality. [Dasroot](https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/)

4. **Apple notarization is increasingly mandatory:** macOS Sequoia+ blocks unsigned/non-notarized apps with no user override. Build pipelines must include notarization steps regardless of framework. [Packt](https://www.packtpub.com/qa-co/learning/tech-news/apple-plans-to-make-notarization-a-default-requirement-in-all-future-macos-updates)

5. **Stack Overflow survey doesn't track desktop frameworks:** Popularity rankings for Electron/Tauri/Flutter are not in official surveys — market share estimates come from npm downloads (Electron), cargo downloads (Tauri), or anecdotal data. Popularity ≠ technical superiority. [Codeology](https://codeology.co.nz/articles/tauri-vs-electron-2025-desktop-development.html)

6. **Dart ecosystem is smaller than JavaScript:** Flutter can't directly use npm packages; some desktop-specific libraries are missing or immature. Evaluate plugin availability before committing. [YouTube/Samik Choudhury](https://www.youtube.com/watch?v=evW3uqwkC0w)

7. **Qt open-source licensing has GPL implications:** Using Qt under open-source license requires your app to be GPL-compliant. Commercial Qt licenses are required for proprietary/closed-source apps. [Tekin](https://dev.tekin.cn/en/blog/2026-macos1015-windows-cross-platform-desktop-ui-framework-guide)

8. **Tauri Rust learning curve is real for complex backends:** While basic plugins handle common tasks, complex native functionality (custom file system semantics, database drivers, hardware interfaces) requires Rust code. JS-only teams should budget 2–4 weeks for Rust ramp-up. [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

9. **Electron's resource overhead compounds with multiple apps:** Running three Electron apps simultaneously means 240–600MB+ RAM just for the runtimes. For users running multiple desktop tools (Slack + VS Code + your app), Tauri's per-app overhead is dramatically lower. [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)

10. **Neutralino's limited ecosystem is a real risk:** No robust auto-update mechanism, limited native API depth, and smallest community of the major contenders. Suitable for internal/simple tools but not recommended for customer-facing products. [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)

---

## Counter-Evidence

**Cases where Electron is genuinely better than Tauri:**
- Apps requiring consistent pixel-perfect rendering across all platforms (Chromium guarantees identical behavior) [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)
- Apps requiring deep Node.js APIs or npm packages not replaceable by Rust crates (e.g., certain database drivers, imaging libraries) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- Apps requiring embedded web views orChromium-specific APIs (WebRTC, Chrome extensions, etc.) [BuildPilot](https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026)
- Teams with urgent time-to-market and no Rust expertise [PkgPulse Blog](https://www.pkgpulse.com/blog/electron-vs-tauri-2026)

**Flutter desktop limitations reported by community:**
- Bundle sizes can unexpectedly balloon to 100MB+ with certain plugin combinations [Stack Overflow](https://stackoverflow.com/questions/79707141/my-flutter-app-bundle-size-suddenly-increase-to-139mb-from-19-4mb)
- Impeller on macOS is still marked beta as of early 2026; some apps must fall back to Skia [Dasroot](https://dasroot.net/posts/2026/02/flutter-desktop-applications-windows-macos-linux/)
- Hot reload works for Dart/logic but can be slower for deep widget tree changes [Oflight](https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026)

**Qt limitations:**
- Professional Qt IDE (Qt Creator) requires commercial license; free alternatives exist but lack integration [Tekin](https://dev.tekin.cn/en/blog/2026-macos1015-windows-cross-platform-desktop-ui-framework-guide)
- QML/JavaScript hybrid can feel inconsistent compared to C++ native [Software Logic](https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025)
- Platform-specific tuning often needed — Qt doesn't fully abstract OS differences for all use cases [Software Logic](https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025)

---

## Source Quality Assessment

| Source | Tier | Date | Notes |
|--------|------|------|-------|
| PkgPulse Blog (electron-vs-tauri-2026, best-frameworks-2026) | 2 | 2026-02, 2026-03 | Engineering blog with live package data; high credibility |
| BuildPilot (tauri-vs-electron-neutralino-2026) | 3 | 2026-03 | Technical tutorial site; good breadth, verify claims |
| Dasroot (flutter-desktop-2026 articles) | 3 | 2026-01, 2026-02 | Developer blog with benchmark data; specific metrics |
| Oflight (tauri-v2 comparisons) | 3 | 2026-03 | Technical blog; good performance analysis |
| Syncfusion (.NET MAUI Day London recap) | 2 | 2026-02 | Enterprise vendor with direct Microsoft ecosystem knowledge |
| Software Logic (Qt comparisons) | 3 | 2025 | Technical blog; Qt expertise evident |
| Red Sky Digital (flutter-tauri-electron comparison) | 3 | 2026-01 | General analysis; good synthesis |
| YouTube/Samik Choudhury (macOS frameworks 2026) | 3 | 2025-10 | Solo developer perspective; practical but anecdotal |
| Medium/Chudovo (avalonia-vs-maui-vs-electron) | 3 | 2026-02 | Vendor-adjacent content; balanced analysis |
| SSL.com (code signing) | 2 | 2026 | Security/certificate authority; authoritative on signing |
| Apple Developer docs (notarization) | 1 | 2026 | Primary Apple source |
| Uno Platform blog/docs | 1 | 2025-11 | Primary source for Uno Platform |
| Stack Overflow 2025 Survey | 2 | 2025 | Large survey (49K respondents); no desktop framework category |
| GitHub/Release notes (Tauri v2, Electron 34) | 1 | 2025-2026 | Primary source data |
| Codeology (tauri-vs-electron-2025) | 3 | 2025 | Secondary analysis; good context |

---

## Gaps

- **No comprehensive 2026 market share survey** — Stack Overflow's 2025 survey doesn't include a desktop framework category; market share estimates come from npm downloads, GitHub stars, or anecdotal vendor claims
- **Tauri v2 real-world production case studies** — most available case studies are simple app migrations; complex enterprise Tauri apps lack published data
- **Flutter desktop enterprise adoption percentages** — no hard data on what fraction of Flutter desktop users are in production vs experimental
- **Exact performance benchmarks** — memory/CPU figures vary by measurement method; most sources provide ranges rather than controlled benchmarks
- **macOS WebKitGTK performance** — Linux webview performance data is sparse; most benchmarks focus on Windows/macOS
- **Uno Platform market share** — no independent adoption data; vendor-published figures only
- **Qt commercial pricing** — specific Qt licensing costs not publicly quoted; requires sales contact

---

## Confidence

**Level:** MEDIUM-HIGH

**Rationale:** Multiple high-quality engineering blogs and official documentation corroborate the major findings (Electron dominance, Tauri size/memory advantages, Flutter desktop maturity). 15+ sources used across 2025–2026 publications. Confidence reduced by: (1) lack of standardized benchmarks — most memory/speed figures are ranges from different measurement methods; (2) no comprehensive market survey for desktop frameworks specifically; (3) some sources are vendor-adjacent (Syncfusion for .NET MAUI, Uno Platform blog for Uno); (4) Flutter's Impeller is still beta on macOS meaning performance claims may shift with stable release.

Core architectural claims (Electron bundles Chromium, Tauri uses OS WebView, Qt compiles native) are highly confident. Quantitative comparisons (bundle sizes, memory ranges) are plausible but vary across sources.

---

## Sources

[1] PkgPulse Blog — "Best Desktop App Frameworks in 2026: Electron vs Tauri vs Neutralino" — https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026 (Tier 2, 2026-03)

[2] PkgPulse Blog — "Electron vs Tauri in 2026: Desktop Apps, Dramatically Different" — https://www.pkgpulse.com/blog/electron-vs-tauri-2026 (Tier 2, 2026-02)

[3] BuildPilot — "Tauri vs Electron vs Neutralinojs: Best Desktop App Framework (2026)" — https://trybuildpilot.com/744-tauri-vs-electron-vs-neutralino-2026 (Tier 3, 2026-03)

[4] Dasroot — "Flutter Desktop Applications: Building for Windows, macOS and Linux" — https://dasroot.net/posts/2026/01/flutter-desktop-applications-building-windows-macos-linux/ (Tier 3, 2026-01)

[5] Dasroot — "Flutter Desktop Applications: Windows, macOS, and Linux" — https://dasroot.net/posts/2026/02/flutter-desktop-applications-windows-macos-linux/ (Tier 3, 2026-02)

[6] Ditto — "The future is bright for Flutter in 2026" — https://www.ditto.com/blog/the-future-is-bright-for-flutter-in-2026 (Tier 3, 2026)

[7] Oflight — "Tauri v2 vs Electron: Complete Comparison of Performance, Security, and Migration Costs" — https://www.oflight.co.jp/en/columns/tauri-v2-vs-electron-comparison (Tier 3, 2026-03)

[8] Oflight — "Flutter vs React Native vs Capacitor vs Tauri 2026: Complete Framework Comparison Guide" — https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-overview-2026 (Tier 3, 2026-03)

[9] Oflight — "Flutter vs React Native vs Capacitor vs Tauri: Complete Developer Experience Comparison" — https://www.oflight.co.jp/en/columns/flutter-rn-capacitor-tauri-developer-experience (Tier 3, 2026-03)

[10] Syncfusion — ".NET MAUI Day London 2026: Highlights and Insights" — https://www.syncfusion.com/blogs/post/dotnet-maui-day-london-2026-event-recap (Tier 2, 2026-02)

[11] Software Logic — "Migration Secrets: Qt vs Electron vs Tauri for Desktop Apps 2025" — https://softwarelogic.co/en/blog/migration-secrets-choosing-qt-electron-or-tauri-for-desktop-apps-2025 (Tier 3, 2025)

[12] Software Logic — "Electron.js vs Qt: Which Is Best for Modern UI Development?" — https://softwarelogic.co/en/blog/is-electronjs-better-than-qt-for-modern-ui-development (Tier 3, 2025)

[13] Tibicle — "Best framework for desktop application in 2026" — https://tibicle.com/blog/best-framework-for-desktop-application-in-2026 (Tier 3, 2025-12)

[14] Red Sky Digital — "Comparative Analysis of Electron, Tauri, and Flutter for Desktop Apps" — https://redskydigital.com/au/comparative-analysis-of-electron-tauri-and-flutter-for-desktop-apps/ (Tier 3, 2026-01)

[15] Edcbav — "Cross-Platform Desktop Apps: Choosing Between Electron, Tauri, and Flutter" — https://www.edcbav.com/posts/cross-platform-desktop-apps-choosing-between-electron-tauri-and-flutter (Tier 3, 2026-01)

[16] Medium/Chudovo — "Avalonia vs MAUI vs Electron: Choosing the Right Cross-Platform Strategy" — https://medium.com/@chudovo/avalonia-vs-maui-vs-electron-choosing-the-right-cross-platform-strategy-706d0ac5e285 (Tier 3, 2026-02)

[17] Vocal Media — "How to Choose Between Avalonia UI, .NET MAUI, and Uno Platform for Desktop Projects" — https://vocal.media/education/how-to-choose-between-avalonia-ui-net-maui-and-uno-platform-for-desktop-projects (Tier 3, 2026-03)

[18] Tekin — "2026 Comprehensive Guide to Cross-Platform Desktop UI Frameworks for macOS 10.15 + Windows" — https://dev.tekin.cn/en/blog/2026-macos1015-windows-cross-platform-desktop-ui-framework-guide (Tier 3, 2025-12)

[19] Uno Platform Blog — "Uno Platform 6.4: Agentic Development, .NET 10 and VS 2026" — https://platform.uno/blog/uno-platform-6-4/ (Tier 1, 2025-11)

[20] Uno Platform Blog — "Faster Rendering, .NET 10 Preview, VS 2026 Ready" — https://platform.uno/blog/uno-platform-6-3/ (Tier 1, 2025-10)

[21] InfoQ — "Uno Platform 6.4 and Uno Platform Studio 2.0: .NET 10, VS 2026, and Agentic AI" — https://www.infoq.com/news/2025/11/uno-platform-6-4-agentic/ (Tier 2, 2025-11)

[22] Uno Platform — "Supported platforms" — https://platform.uno/docs/articles/getting-started/requirements.html (Tier 1, 2026)

[23] YouTube/Samik Choudhury — "How to Build macOS Apps in 2026 (4 Framework Comparison)" — https://www.youtube.com/watch?v=evW3uqwkC0w (Tier 3, 2025-10)

[24] Agents UI Blog — "Tauri vs Electron for Developer Tools: Why We Chose Tauri" — https://agents-ui.com/blog/tauri-vs-electron-for-developer-tools/ (Tier 3, 2026-01)

[25] SSL.com — "Which Code Signing Certificate do I Need? EV or OV?" — https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-or-ov/ (Tier 2, 2026)

[26] XOJO Blog — "Code Signing on macOS: What Developers Need to Know" — https://blog.xojo.com/2026/03/18/code-signing-on-macos-what-developers-need-to-know-part-2/ (Tier 2, 2026-03)

[27] Apptimized — "Notarization Process for macOS Installers" — https://apptimized.com/en/news/mac-notarization-process/ (Tier 3, 2026)

[28] Packt — "Apple plans to make notarization a default requirement" — https://www.packtpub.com/qa-co/learning/tech-news/apple-plans-to-make-notarization-a-default-requirement-in-all-future-macos-updates (Tier 2, 2026)

[29] SigmaSolve — "How to Build a Cross-Platform Desktop App for Windows, Mac" — https://www.sigmasolve.com/blog/cross-platform-desktop-app-development/ (Tier 3)

[30] Microsoft Learn — "Driver code signing requirements - Windows" — https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/code-signing-reqs (Tier 1)

[31] Stack Overflow 2025 Developer Survey — https://survey.stackoverflow.co/2025/ (Tier 2, 2025)

[32] Codeology — "Tauri vs Electron: A 2025 Comparison for Desktop Development" — https://codeology.co.nz/articles/tauri-vs-electron-2025-desktop-development.html (Tier 3, 2025)

[33] PkgPulse — "Tauri vs Electron vs Neutralino: Desktop Apps with JavaScript 2026" — https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026 (Tier 2, 2026-03)

[34] IT Path Solutions — ".NET MAUI Development in 2025: The Complete Guide" — https://www.itpathsolutions.com/dotnet-maui-development-guide (Tier 3)

[35] Dev.to — "Hot Restart for iOS is not included in Visual Studio 2026" — https://dev.to/biozal/hot-restart-for-ios-is-not-included-in-visual-studio-2026-what-net-maui-developers-need-to-know-28n8 (Tier 3, 2026)
