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
const enterModeToggle = document.getElementById("enter-mode-toggle");

// Enter mode (default ON, persisted in localStorage)
const storedEnterMode = localStorage.getItem("enterMode");
enterModeToggle.checked = storedEnterMode === null ? true : storedEnterMode === "true";
enterModeToggle.addEventListener("change", () => {
  localStorage.setItem("enterMode", enterModeToggle.checked);
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

// --- Boot ---
loadSettings();
