// --- Default Soniox terms (used as fallback and reset target) ---
const DEFAULT_TERMS = [
  "Claude Code", "tmux", "tm-send", "LLM", "API", "GitHub", "pytest",
  "uv", "pnpm", "Celery", "Redis", "FastAPI", "Docker", "Kubernetes",
  "git", "npm", "pip", "debug", "refactor", "deploy", "endpoint",
  "middleware", "async", "await", "webhook", "caching", "SSH",
  "localhost", "frontend", "backend", "TypeScript", "Python",
];

const DEFAULT_TRANSLATION_TERMS = [
  { source: "cross code", target: "Claude Code" },
  { source: "cloud code", target: "Claude Code" },
  { source: "cloth code", target: "Claude Code" },
  { source: "tea mux", target: "tmux" },
  { source: "tee mux", target: "tmux" },
  { source: "T mux", target: "tmux" },
  { source: "TMAX", target: "tmux" },
  { source: "tm send", target: "tm-send" },
  { source: "T M send", target: "tm-send" },
  { source: "team send", target: "tm-send" },
  { source: "L M", target: "LLM" },
  { source: "elem", target: "LLM" },
  { source: "A P I", target: "API" },
  { source: "a p i", target: "API" },
  { source: "get hub", target: "GitHub" },
  { source: "git hub", target: "GitHub" },
  { source: "pie test", target: "pytest" },
  { source: "pi test", target: "pytest" },
  { source: "you v", target: "uv" },
  { source: "UV", target: "uv" },
  { source: "pee npm", target: "pnpm" },
  { source: "P NPM", target: "pnpm" },
  { source: "salary", target: "Celery" },
  { source: "seller e", target: "Celery" },
  { source: "celery", target: "Celery" },
  { source: "did bug", target: "debug" },
  { source: "dee bug", target: "debug" },
  { source: "dee back", target: "debug" },
  { source: "re fact er", target: "refactor" },
  { source: "duh ploy", target: "deploy" },
  { source: "fast a p i", target: "FastAPI" },
  { source: "fast API", target: "FastAPI" },
  { source: "docker", target: "Docker" },
  { source: "web hook", target: "webhook" },
  { source: "end point", target: "endpoint" },
  { source: "middle ware", target: "middleware" },
];

// --- Settings state (loaded from localStorage) ---
let sonioxTerms = [];
let sonioxTranslationTerms = [];

function loadSettings() {
  try {
    const storedTerms = localStorage.getItem("sonioxTerms");
    sonioxTerms = storedTerms ? JSON.parse(storedTerms) : [...DEFAULT_TERMS];
  } catch {
    sonioxTerms = [...DEFAULT_TERMS];
  }
  try {
    const storedTrans = localStorage.getItem("sonioxTranslationTerms");
    sonioxTranslationTerms = storedTrans ? JSON.parse(storedTrans) : DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  } catch {
    sonioxTranslationTerms = DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  }
}

// DOM elements
const micBtn = document.getElementById("mic-btn");
const micLabel = document.getElementById("mic-label");
const statusText = document.getElementById("status-text");
const transcriptBox = document.getElementById("transcript");
const commandBox = document.getElementById("command-box");
const clearBtn = document.getElementById("clear-btn");
const editBtn = document.getElementById("edit-btn");
const copyBtn = document.getElementById("copy-btn");
const enterModeToggle = document.getElementById("enter-mode-toggle");

// Enter mode (default ON, persisted in localStorage)
const storedEnterMode = localStorage.getItem("enterMode");
enterModeToggle.checked = storedEnterMode === null ? true : storedEnterMode === "true";
enterModeToggle.addEventListener("change", () => {
  localStorage.setItem("enterMode", enterModeToggle.checked);
});

// API key error dialog
const keyErrorOverlay = document.getElementById("key-error-overlay");
const keyErrorMsg = document.getElementById("key-error-msg");
document.getElementById("key-error-reset").addEventListener("click", () => {
  window.voiceEverywhere.resetCredentials();
});
document.getElementById("key-error-dismiss").addEventListener("click", () => {
  keyErrorOverlay.style.display = "none";
});

function isAuthError(errMsg) {
  const lower = errMsg.toLowerCase();
  return lower.includes("401") || lower.includes("403") ||
    lower.includes("unauthorized") || lower.includes("invalid") ||
    lower.includes("authentication") || lower.includes("api key") ||
    lower.includes("api_key");
}

function showKeyError(service, errMsg) {
  keyErrorMsg.textContent = `${service} rejected your API key: ${errMsg}`;
  keyErrorOverlay.style.display = "flex";
}

// Skip LLM dialog
const skipLlmOverlay = document.getElementById("skip-llm-overlay");
const skipLlmMsg = document.getElementById("skip-llm-msg");
const skipLlmRemember = document.getElementById("skip-llm-remember");
let skipLlmResolve = null;

document.getElementById("skip-llm-yes").addEventListener("click", () => {
  if (skipLlmRemember.checked) {
    skipLlm = true;
    localStorage.setItem("skipLlm", "true");
  }
  skipLlmOverlay.style.display = "none";
  if (skipLlmResolve) skipLlmResolve("skip");
});
document.getElementById("skip-llm-update").addEventListener("click", () => {
  skipLlmOverlay.style.display = "none";
  window.voiceEverywhere.resetCredentials();
});

function showSkipLlmDialog(errMsg) {
  skipLlmMsg.textContent = `xAI correction failed: ${errMsg}. Continue without LLM correction?`;
  skipLlmRemember.checked = false;
  skipLlmOverlay.style.display = "flex";
  return new Promise((resolve) => { skipLlmResolve = resolve; });
}

// Services
const stt = new SonioxSTT();
let detector = null;

// State
let isListening = false;
let sonioxKey = "";
let hasXaiKey = false;
let skipLlm = localStorage.getItem("skipLlm") === "true";
let reminderTimer = null;

// --- Init ---
async function init() {
  loadSettings();

  // Load config from config.json (via main process)
  const config = await window.voiceEverywhere.getConfig();
  sonioxKey = await window.voiceEverywhere.getSonioxKey();
  hasXaiKey = await window.voiceEverywhere.hasXaiKey();

  // Configure services from config
  stt.setConfig(config.soniox);
  detector = new StopWordDetector(config.voice.stop_word);

  // Set up STT callbacks
  stt.onTranscript = handleTranscript;
  stt.onError = (err) => {
    console.error("STT error:", err);
    setStatus("STT error: " + err.message, "idle");
    stopListening();
    if (isAuthError(err.message)) {
      showKeyError("Soniox", err.message);
    }
  };
}

// --- Soniox context injection ---
function buildSonioxContext() {
  return {
    general: [
      { key: "domain", value: "Software Development" },
      { key: "speaker", value: "Vietnamese developer" },
    ],
    terms: [...sonioxTerms],
    translation_terms: sonioxTranslationTerms.map(t => ({ ...t })),
  };
}

// --- Mic toggle ---
async function startListening() {
  if (!sonioxKey) {
    setStatus("SONIOX_API_KEY not set", "idle");
    return;
  }

  try {
    isListening = true;
    micBtn.classList.add("active");
    micLabel.textContent = "Stop";
    setStatus("Listening...", "listening");
    window.voiceEverywhere.setMicState(true);

    // Clear previous
    transcriptBox.innerHTML = "";
    transcriptBox.contentEditable = "false";
    editBtn.style.display = "none";
    editBtn.classList.remove("active");
    commandBox.innerHTML = '<span class="placeholder">—</span>';

    // Build Soniox context with translation terms
    const context = buildSonioxContext();
    await stt.start(sonioxKey, context);

    // Gentle beep every 60s while listening (reminder)
    reminderTimer = setInterval(() => beep(660, 0.15, 0.2), 60000);
  } catch (err) {
    console.error("Failed to start:", err);
    setStatus("Mic error: " + err.message, "idle");
    stopListening();
  }
}

function stopListening() {
  isListening = false;
  micBtn.classList.remove("active");
  micLabel.textContent = "Start";
  window.voiceEverywhere.setMicState(false);
  stt.stop();
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }

  // Show edit button when stopped (if there's transcript text)
  if (transcriptBox.textContent.trim()) {
    editBtn.style.display = "";
  }

  if (
    statusText.textContent === "Listening..." ||
    statusText.textContent.startsWith("Mic error")
  ) {
    setStatus("Idle", "idle");
  }
}

// --- Transcript handling ---
function handleTranscript(fullTranscript, finalTranscript, hasFinal) {
  // Display: final text in black, interim in gray
  const interimPart = fullTranscript.slice(finalTranscript.length);
  transcriptBox.innerHTML = `${escapeHtml(finalTranscript)}<span class="interim">${escapeHtml(interimPart)}</span>`;
  transcriptBox.scrollTop = transcriptBox.scrollHeight;

  // Check stop word on final text only
  if (hasFinal) {
    const result = detector.process(finalTranscript);
    if (result.detected && result.command) {
      handleCommandDetected(result.command);
    }
  }
}

// --- Command detected (stop word triggered) ---
// If xAI key is set and LLM not skipped: correct → insert at cursor
// Otherwise: insert raw transcript directly
async function handleCommandDetected(rawCommand) {
  stt.resetTranscript();
  transcriptBox.innerHTML = "";

  let text = rawCommand.trim();

  // Try LLM correction if xAI key is configured and not permanently skipped
  if (hasXaiKey && !skipLlm) {
    setStatus("Correcting...", "processing");
    try {
      text = await window.voiceEverywhere.correctTranscript(text);
    } catch (err) {
      console.error("LLM correction failed:", err);
      if (isAuthError(err.message || "")) {
        const choice = await showSkipLlmDialog(err.message);
        // "skip" → continue with raw text; "update" → already redirected to setup
        if (choice !== "skip") return;
      }
      // Non-auth error: just use raw text
    }
  }

  commandBox.innerHTML = escapeHtml(text);

  // Enable copy button
  copyBtn.disabled = !text;

  // Insert text at cursor in frontmost app
  if (text) {
    await doInsertText(text);
  }
}

// --- Insert text (used by auto-insert and resend) ---
async function doInsertText(text) {
  setStatus("Inserting...", "processing");
  try {
    const result = await window.voiceEverywhere.insertText(text, { enterMode: enterModeToggle.checked });
    if (result.success) {
      beep(1200, 0.2, 0.15);  // confirmation beep
      setStatus("Inserted! Listening...", "listening");
    } else {
      setStatus("Insert failed, listening...", "listening");
    }
  } catch (err) {
    console.error("Insert failed:", err);
    setStatus("Insert failed, listening...", "listening");
  }
}

// --- Clear ---
function handleClear() {
  if (isListening) stopListening();
  stt.resetTranscript();
  transcriptBox.innerHTML =
    '<span class="placeholder">Transcript will appear here...</span>';
  commandBox.innerHTML = '<span class="placeholder">—</span>';
  copyBtn.disabled = true;
  setStatus("Idle", "idle");
}

// --- Helpers ---
function beep(freq, volume, duration) {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start();
  osc.stop(ctx.currentTime + duration);
  osc.onended = () => ctx.close();
}

function setStatus(text, className) {
  statusText.textContent = text;
  statusText.className = "status " + className;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Event listeners ---
micBtn.addEventListener("click", () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

clearBtn.addEventListener("click", handleClear);

// Copy corrected text to clipboard (use Electron clipboard via IPC — navigator.clipboard fails in Electron)
copyBtn.addEventListener("click", async () => {
  const text = commandBox.textContent;
  if (!text || text === "—") return;
  await window.voiceEverywhere.copyToClipboard(text);
  copyBtn.classList.add("success");
  setTimeout(() => {
    copyBtn.classList.remove("success");
  }, 1500);
});

// Edit button toggles transcript editing
editBtn.addEventListener("click", () => {
  const editing = transcriptBox.contentEditable === "true";
  transcriptBox.contentEditable = editing ? "false" : "true";
  editBtn.classList.toggle("active", !editing);
  if (!editing) transcriptBox.focus();
});

// Reset API keys
document.getElementById("reset-keys-btn").addEventListener("click", () => {
  window.voiceEverywhere.resetCredentials();
});

// Quit button
document.getElementById("quit-btn").addEventListener("click", () => {
  window.voiceEverywhere.quitApp();
});

// --- Settings dialog ---
const settingsOverlay = document.getElementById("settings-overlay");
const settingsTermsList = document.getElementById("settings-terms-list");
const settingsTransList = document.getElementById("settings-trans-list");
const settingsTermInput = document.getElementById("settings-term-input");
const settingsTransSource = document.getElementById("settings-trans-source");
const settingsTransTarget = document.getElementById("settings-trans-target");

// Working copies for the dialog (only committed on Save)
let editTerms = [];
let editTranslationTerms = [];

function openSettings() {
  editTerms = [...sonioxTerms];
  editTranslationTerms = sonioxTranslationTerms.map(t => ({ ...t }));
  renderSettingsTerms();
  renderSettingsTranslation();
  settingsOverlay.style.display = "flex";
}

function closeSettings() {
  settingsOverlay.style.display = "none";
  settingsTermInput.value = "";
  settingsTransSource.value = "";
  settingsTransTarget.value = "";
}

function saveSettings() {
  sonioxTerms = [...editTerms];
  sonioxTranslationTerms = editTranslationTerms.map(t => ({ ...t }));
  localStorage.setItem("sonioxTerms", JSON.stringify(sonioxTerms));
  localStorage.setItem("sonioxTranslationTerms", JSON.stringify(sonioxTranslationTerms));
  closeSettings();
}

function resetSettingsToDefaults() {
  editTerms = [...DEFAULT_TERMS];
  editTranslationTerms = DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  renderSettingsTerms();
  renderSettingsTranslation();
}

function renderSettingsTerms() {
  settingsTermsList.innerHTML = "";
  editTerms.forEach((term, i) => {
    const item = document.createElement("div");
    item.className = "settings-item";
    const text = document.createElement("span");
    text.className = "settings-item-text";
    text.textContent = term;
    const del = document.createElement("button");
    del.className = "settings-item-delete";
    del.innerHTML = "&times;";
    del.addEventListener("click", () => {
      editTerms.splice(i, 1);
      renderSettingsTerms();
    });
    item.appendChild(text);
    item.appendChild(del);
    settingsTermsList.appendChild(item);
  });
}

function renderSettingsTranslation() {
  settingsTransList.innerHTML = "";
  editTranslationTerms.forEach((t, i) => {
    const item = document.createElement("div");
    item.className = "settings-item";
    const src = document.createElement("span");
    src.className = "settings-item-text";
    src.textContent = t.source;
    const arrow = document.createElement("span");
    arrow.className = "settings-item-arrow";
    arrow.innerHTML = "&#8594;";
    const tgt = document.createElement("span");
    tgt.className = "settings-item-text";
    tgt.textContent = t.target;
    const del = document.createElement("button");
    del.className = "settings-item-delete";
    del.innerHTML = "&times;";
    del.addEventListener("click", () => {
      editTranslationTerms.splice(i, 1);
      renderSettingsTranslation();
    });
    item.appendChild(src);
    item.appendChild(arrow);
    item.appendChild(tgt);
    item.appendChild(del);
    settingsTransList.appendChild(item);
  });
}

function addTerm() {
  const val = settingsTermInput.value.trim();
  if (!val) return;
  if (editTerms.includes(val)) {
    settingsTermInput.value = "";
    return;
  }
  editTerms.push(val);
  settingsTermInput.value = "";
  renderSettingsTerms();
}

function addTranslationTerm() {
  const src = settingsTransSource.value.trim();
  const tgt = settingsTransTarget.value.trim();
  if (!src || !tgt) return;
  if (editTranslationTerms.some(t => t.source === src && t.target === tgt)) {
    settingsTransSource.value = "";
    settingsTransTarget.value = "";
    return;
  }
  editTranslationTerms.push({ source: src, target: tgt });
  settingsTransSource.value = "";
  settingsTransTarget.value = "";
  renderSettingsTranslation();
}

// Settings event listeners
document.getElementById("settings-btn").addEventListener("click", openSettings);
document.getElementById("settings-save").addEventListener("click", saveSettings);
document.getElementById("settings-cancel").addEventListener("click", closeSettings);
document.getElementById("settings-reset").addEventListener("click", resetSettingsToDefaults);
document.getElementById("settings-term-add").addEventListener("click", addTerm);
document.getElementById("settings-trans-add").addEventListener("click", addTranslationTerm);

settingsTermInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTerm();
});
settingsTransTarget.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTranslationTerm();
});

// --- Global shortcut: toggle mic ---
window.voiceEverywhere.onToggleMic(() => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

// --- Boot ---
init();
