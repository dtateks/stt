# macOS Electron Shell Environment Variables Research

**Date**: 2026-03-26  
**Focus**: Voice-to-Text codebase (`voice-everywhere`)  
**Researcher**: Claude Code Architect

---

## Executive Summary

The app's current design stores credentials in a plain JSON file via [electron/credentials.js](https://github.com/hungson175/voice-everywhere/blob/main/electron/credentials.js). This is the correct architecture. The question is whether to additionally auto-populate from shell environment variables and if so, how.

---

## The Core Problem

**Why `~/.zshrc` vars don't reach GUI apps on macOS:**

1. Electron apps launched from Finder are children of `launchd`, not a shell process
2. `launchd` does not source shell configuration files
3. Even Terminal.app works because it runs shells as **login shells** — which source `~/.zprofile` and `~/.zshrc`
4. A GUI app started from the Dock or Finder bypasses all shell startup files entirely

This is not an Electron limitation — it's fundamental to how macOS launches GUI applications.

---

## Option Comparison

### Option 1: Manual Shell Spawn (DIY)

Spawn a login shell, capture its environment, parse it.

```javascript
const { execSync } = require('child_process');
// Spawn zsh as login shell, print env, parse
const envOutput = execSync('zsh -l -c export', { encoding: 'utf-8' });
```

**Pros**: No dependencies, full control  
**Cons**: 
- Shell startup is slow (can take 500ms+ on first run due to `compinit`)
- Output format varies across zsh versions
- Must handle `.zshenv` vs `.zprofile` vs `.zshrc` semantics correctly
- Error-prone parsing

**Verdict**: Too fragile for production use.

---

### Option 2: `shell-env` Package (sindresorhus)

```javascript
const { shellEnv } = require('shell-env');
// Async version
const env = await shellEnv();
// Or sync
const env = require('shell-env').shellEnvSync;
```

**Evidence**: [shell-env v4.0.3](https://www.npmjs.com/package/shell-env) by Sindre Sorhus.

**What it does**:
- Spawns `zsh -l -c 'env'` (login shell)
- Parses `KEY=VALUE` output
- Disables oh-my-zsh tmux plugin auto-start to avoid side effects
- Returns plain object with all exported variables

**Pros**:
- Battle-tested, MIT licensed, maintained by sindresorhus
- Handles both zsh and bash
- Has sync variant for convenience

**Cons**:
- Async by default (but sync version exists)
- First invocation is slow (~500ms-1s) due to shell startup
- Still a child process spawn on every call (though results could be cached)

**Verdict**: Best practical solution if auto-population is desired.

---

### Option 3: Leave Only `process.env`

Rely exclusively on the app's own credential storage mechanism. Do not attempt to read shell env vars at all.

**Evidence**: The codebase already does this via [electron/credentials.js](https://github.com/hungson175/voice-everywhere/blob/main/electron/credentials.js#L65-L76).

```javascript
function getCredentials() {
  const store = readStore();
  return {
    xaiKey: store.xaiKey || "",
    sonioxKey: store.sonioxKey || "",
  };
}
```

**Pros**:
- Simple, no external dependencies
- Fast startup (synchronous file read)
- Works consistently regardless of how app is launched
- No shell invocation latency

**Cons**:
- Users who expect `export SONIOX_API_KEY=...` in `.zshrc` to "just work" will be confused

**Verdict**: Current implementation is correct for security and simplicity.

---

## zsh/bash Startup File Caveats

This is critical — many developers misunderstand when each file is sourced:

| File | When Sourced |
|------|-------------|
| `~/.zshenv` | **Always** — non-interactive, interactive, login, non-login |
| `~/.zprofile` | Login shells only |
| `~/.zshrc` | Interactive shells only |
| `~/.bash_profile` | Login shells only (bash) |
| `~/.bashrc` | Interactive non-login shells only (bash) |

**Key insight**: `~/.zshrc` is **NOT** sourced for login shells — it's for interactive shells. Terminal.app runs login shells, so it sources both `.zprofile` AND `.zshrc`. But a shell spawned by an Electron app is typically non-login, non-interactive — so only `.zshenv` is guaranteed.

**Practical implications**:
1. If a user puts `export SONIOX_API_KEY=...` in `~/.zshrc`, it won't be visible to an Electron app even when using `shell-env` with `zsh -l`, because login shells don't source `.zshrc` by default
2. The standard convention for variables that need to be available everywhere is `~/.zprofile` for zsh or `~/.bash_profile` for bash
3. Variables in `~/.zshenv` are visible to all zsh invocations but may not be in Terminal.app if `.zprofile` overrides them

**Recommendation for users**: Document that API keys should be placed in `~/.zprofile` (zsh) or `~/.bash_profile` (bash), not `~/.zshrc`.

---

## Industry Standard Env Var Names

Evidence from real-world usage across 15+ open-source projects:

### Soniox

**Standard**: `SONIOX_API_KEY`

Evidence:
- [fastrepl/char: `std::env::var("SONIOX_API_KEY")`](https://github.com/fastrepl/char/blob/main/crates/owhisper-client/src/adapter/soniox/live.rs#L500)
- [livekit/agents: `os.getenv("SONIOX_API_KEY")`](https://github.com/livekit/agents/blob/main/livekit-plugins/livekit-plugins-soniox/livekit/plugins/soniox/stt.py#L137)
- [autoshow: `process.env['SONIOX_API_KEY']`](https://github.com/autoshow/autoshow/blob/main/src/routes/api/process/02-run-transcribe/transcription-services/soniox/run-soniox.ts#L7)
- [jambonz: `process.env.SONIOX_API_KEY`](https://github.com/jambonz/jambonz-feature-server/blob/main/lib/config.js#L99)
- [pipecat-ai: `os.getenv("SONIOX_API_KEY")`](https://github.com/pipecat-ai/pipecat/blob/main/examples/foundational/13i-soniox-transcription.py#L52)

### xAI

**Standard**: `XAI_API_KEY`

Evidence:
- [langchain-ai/langchain: `os.environ.get("XAI_API_KEY")`](https://github.com/langchain-ai/langchain/blob/master/libs/partners/xai/langchain_xai/chat_models.py)
- [letta-ai/letta: `os.environ.get("XAI_API_KEY")`](https://github.com/letta-ai/letta/blob/main/letta/llm_api/xai_client.py)
- [agno-agi/agno: `getenv("XAI_API_KEY")`](https://github.com/agno-agi/agno/blob/main/libs/agno/agno/models/xai/xai.py)
- [virattt/ai-hedge-fund: `os.getenv("XAI_API_KEY")`](https://github.com/virattt/ai-hedge-fund/blob/main/src/llm/models.py#L200)
- [lobehub/lobehub: `process.env.XAI_API_KEY`](https://github.com/lobehub/lobehub/blob/canary/src/envs/llm.ts#L357)

**Recommendation**: Use `SONIOX_API_KEY` and `XAI_API_KEY` as the canonical names.

---

## Sync vs Async at Startup

### Current Implementation

In [electron/main.js#L35](https://github.com/hungson175/voice-everywhere/blob/main/electron/main.js#L35):

```javascript
let currentCredentials = credentials.getCredentials();
```

This is **synchronous** — it reads the JSON file at app-ready time.

### Analysis

| Approach | Pros | Cons |
|----------|------|------|
| **Sync at startup** | Simple, no async complexity, credentials available immediately | Blocks main thread briefly |
| **Async at startup** | Non-blocking, can parallelize | Complexity in credential-dependent code paths |

**Recommendation**: **Sync at startup is correct here**.

The credential file read is fast (JSON parse of a few KB), and the current synchronous pattern is appropriate. If `shell-env` is added later, the best approach would be:

1. Use `shell-env` **async** in the background after app-ready
2. Cache the result
3. If keys found in shell env that differ from stored keys, optionally pre-fill the setup UI

The credential **usage** (`currentCredentials.xaiKey` passed to `llmService.correctTranscript()`) is already async (network call), so credential retrieval being sync is not a bottleneck.

---

## Recommendation

### For this codebase: Option 3 (No Shell Env Reading)

**Do not add shell-env dependency.** The current credential storage architecture is sound:

1. **Credentials are stored in JSON** at `~/Library/Application Support/voice-to-text/credentials.json` — not in Keychain (intentionally, because safeStorage breaks across rebuilds as noted in [credentials.js](https://github.com/hungson175/voice-everywhere/blob/main/electron/credentials.js#L7-L8))
2. **Users enter keys via setup UI** — the [setup.js](https://github.com/hungson175/voice-everywhere/blob/main/ui/setup.js) form requires manual entry
3. **The JSON is read synchronously** at startup, which is fast enough

### Why not shell-env?

- Adds npm dependency with spawn overhead
- Complexity for marginal benefit (users still need to enter keys)
- The slow shell startup (~500ms) would be noticeable at app launch
- Security: encouraging users to put API keys in shell profile files means those keys are in plaintext dotfiles

### If auto-population is truly desired (Option 2 fallback)

Only use `shell-env` async, post-startup, to check for shell env vars and pre-fill the setup form if the stored credentials are empty. Do not block startup.

```javascript
// In app-ready, after initial UI is shown
setImmediate(async () => {
  try {
    const shellEnvVars = await shellEnv();
    const hasStored = credentials.hasCredentials();
    if (!hasStored) {
      // Pre-fill from shell env for first-run experience
      const prefill = {
        xaiKey: shellEnvVars.XAI_API_KEY || '',
        sonioxKey: shellEnvVars.SONIOX_API_KEY || '',
      };
      // Send to renderer to pre-fill setup form
    }
  } catch {
    // Shell env reading failed — not critical
  }
});
```

### Documentation Recommendation

Add a note in the setup UI or README clarifying that API keys should be placed in `~/.zprofile` (not `~/.zshrc`) if users want to set them system-wide, but the app requires manual entry via the setup form.

---

## Summary

| Question | Answer |
|----------|--------|
| **Recommended approach** | Option 3: Keep current JSON-based credential storage, no shell-env |
| **Caveats for zsh/bash files** | `.zshrc` is NOT sourced by login shells; use `.zprofile` for system-wide vars |
| **Exact env var names** | `SONIOX_API_KEY` and `XAI_API_KEY` |
| **Sync vs async** | Sync at startup is correct; async shell-env (if used) should be post-startup only |

---

## References

- [shell-env npm package](https://www.npmjs.com/package/shell-env)
- [sindresorhus/shell-env GitHub](https://github.com/sindresorhus/shell-env)
- [macOS shell configuration guide](https://osxhub.com/macos-shell-configuration-zsh-environment-variables/)
- [Stack Overflow: Electron + node-pty login shell](https://stackoverflow.com/questions/72051509/how-do-you-correctly-launch-a-shell-environment-with-node-pty-in-electron)
- [GitHub Issue: Electron cannot access zshrc vars](https://github.com/pingdotgg/t3code/issues/317)
