const DEFAULT_TERMS = window.voiceEverywhereDefaults.terms;
const DEFAULT_TRANSLATION_TERMS = window.voiceEverywhereDefaults.translationTerms;

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

// Output language (default "auto", persisted in localStorage)
const outputLangSelect = document.getElementById("output-lang-select");
outputLangSelect.value = localStorage.getItem("outputLang") || "auto";
outputLangSelect.addEventListener("change", () => {
  localStorage.setItem("outputLang", outputLangSelect.value);
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

let settingsPreviousFocus = null;

// Focus trap: cycle tab within the dialog
function trapFocus(e) {
  if (e.key !== "Tab") return;
  const focusable = settingsOverlay.querySelectorAll(
    'button, input, select, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function openSettings() {
  editTerms = [...sonioxTerms];
  editTranslationTerms = sonioxTranslationTerms.map(t => ({ ...t }));
  renderSettingsTerms();
  renderSettingsTranslation();
  settingsPreviousFocus = document.activeElement;
  settingsOverlay.classList.remove("hidden");
  settingsOverlay.setAttribute("aria-hidden", "false");
  settingsOverlay.addEventListener("keydown", trapFocus);
  // Move focus to first focusable element
  const firstFocusable = settingsOverlay.querySelector(
    'button, input, select, [tabindex]:not([tabindex="-1"])'
  );
  if (firstFocusable) firstFocusable.focus();
}

function closeSettings() {
  settingsOverlay.classList.add("hidden");
  settingsOverlay.setAttribute("aria-hidden", "true");
  settingsOverlay.removeEventListener("keydown", trapFocus);
  settingsTermInput.value = "";
  settingsTransSource.value = "";
  settingsTransTarget.value = "";
  // Restore focus to the element that opened the dialog
  if (settingsPreviousFocus) settingsPreviousFocus.focus();
}

// Escape key closes the dialog
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) {
    closeSettings();
  }
});

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
    del.type = "button";
    del.className = "settings-item-delete";
    del.setAttribute("aria-label", `Remove term ${term}`);
    del.textContent = "×";
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
    arrow.textContent = "→";
    const tgt = document.createElement("span");
    tgt.className = "settings-item-text";
    tgt.textContent = t.target;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "settings-item-delete";
    del.setAttribute("aria-label", `Remove translation from ${t.source} to ${t.target}`);
    del.textContent = "×";
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
