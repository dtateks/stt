/**
 * Bar renderer — floating voice bar pipeline logic.
 *
 * States: HIDDEN → CONNECTING → LISTENING → PROCESSING → INSERTING → SUCCESS → HIDDEN/LISTENING
 *                                                                       ↓
 *                                                                     ERROR
 */

// --- Default Soniox terms (shared with settings window via localStorage) ---
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

// --- DOM ---
const bar = document.getElementById("bar");
const statusDot = document.getElementById("status-dot");
const waveformCanvas = document.getElementById("waveform");
const waveformCtx = waveformCanvas.getContext("2d");
const transcriptEl = document.getElementById("transcript-text");
const gearBtn = document.getElementById("gear-btn");
const closeBtn = document.getElementById("close-btn");

// --- Services ---
const stt = new SonioxSTT();
let detector = null;

// --- State ---
let state = "HIDDEN"; // HIDDEN, CONNECTING, LISTENING, PROCESSING, INSERTING, SUCCESS, ERROR
let sonioxKey = "";
let hasXaiKey = false;
let skipLlm = localStorage.getItem("skipLlm") === "true";
let sonioxTerms = [];
let sonioxTranslationTerms = [];
let waveformAnimId = null;
let autoHideTimer = null;
let reminderTimer = null;

// --- Settings from localStorage (shared with settings window) ---
function loadSettings() {
  try {
    const stored = localStorage.getItem("sonioxTerms");
    sonioxTerms = stored ? JSON.parse(stored) : [...DEFAULT_TERMS];
  } catch { sonioxTerms = [...DEFAULT_TERMS]; }
  try {
    const stored = localStorage.getItem("sonioxTranslationTerms");
    sonioxTranslationTerms = stored ? JSON.parse(stored) : DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  } catch { sonioxTranslationTerms = DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t })); }
  skipLlm = localStorage.getItem("skipLlm") === "true";
}

// --- State machine ---
function setState(newState, message) {
  state = newState;

  // Remove all state classes
  bar.classList.remove("state-connecting", "state-listening", "state-processing",
    "state-inserting", "state-success", "state-error", "hidden", "visible");

  if (newState === "HIDDEN") {
    bar.classList.add("hidden");
    stopWaveform();
    window.voiceEverywhere.hideBar();
    return;
  }

  bar.classList.add("visible");
  bar.classList.add("state-" + newState.toLowerCase());

  if (message) {
    setTranscriptStatus(message, newState.toLowerCase());
  }

  // After success/error, return to LISTENING (keep bar visible, STT still running)
  if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
  if (newState === "SUCCESS") {
    autoHideTimer = setTimeout(() => {
      setState("LISTENING");
      transcriptEl.textContent = "";
      startWaveform();
    }, 1500);
  } else if (newState === "ERROR") {
    autoHideTimer = setTimeout(() => {
      setState("LISTENING");
      transcriptEl.textContent = "";
      startWaveform();
    }, 2000);
  }
}

function setTranscriptStatus(msg, cls) {
  transcriptEl.innerHTML = `<span class="status-msg ${cls}">${escapeHtml(msg)}</span>`;
}

function setTranscriptLive(finalText, interimText) {
  transcriptEl.innerHTML = escapeHtml(finalText) +
    (interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : "");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Waveform rendering ---
function startWaveform() {
  const analyser = stt.getAnalyser();
  if (!analyser) return;

  const bufLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufLen);

  function draw() {
    waveformAnimId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    const w = waveformCanvas.width;
    const h = waveformCanvas.height;
    waveformCtx.clearRect(0, 0, w, h);

    // Draw bars
    const barCount = 16;
    const barW = w / barCount - 2;
    const step = Math.floor(bufLen / barCount);

    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i * step] / 255;
      const barH = Math.max(2, val * h * 0.9);
      const x = i * (barW + 2);
      const y = (h - barH) / 2;

      waveformCtx.fillStyle = state === "LISTENING"
        ? `rgba(255, 59, 48, ${0.4 + val * 0.6})`
        : `rgba(255, 255, 255, ${0.2 + val * 0.3})`;
      waveformCtx.beginPath();
      waveformCtx.roundRect(x, y, barW, barH, 1.5);
      waveformCtx.fill();
    }
  }

  draw();
}

function stopWaveform() {
  if (waveformAnimId) {
    cancelAnimationFrame(waveformAnimId);
    waveformAnimId = null;
  }
  waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}

// --- Soniox context ---
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

// --- Pipeline ---
async function startListening() {
  if (state === "LISTENING" || state === "CONNECTING") return;

  // Cancel any pending auto-transition and clean up any lingering session
  if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
  stopListening();

  loadSettings();
  if (!sonioxKey) {
    setState("ERROR", "No Soniox key");
    return;
  }

  try {
    window.voiceEverywhere.showBar();
    setState("CONNECTING", "Connecting...");
    window.voiceEverywhere.setMicState(true);

    const context = buildSonioxContext();
    await stt.start(sonioxKey, context);

    setState("LISTENING");
    transcriptEl.textContent = "";
    startWaveform();

    reminderTimer = setInterval(() => beep(660, 0.15, 0.2), 60000);
  } catch (err) {
    if (state === "HIDDEN") return; // stopped externally while connecting
    console.error("Failed to start:", err);
    setState("ERROR", "Mic error: " + err.message);
    window.voiceEverywhere.setMicState(false);
  }
}

function stopListening() {
  stt.stop();
  stopWaveform();
  window.voiceEverywhere.setMicState(false);
  if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
}

// --- Transcript handling ---
function handleTranscript(fullTranscript, finalTranscript, hasFinal) {
  if (state !== "LISTENING") return;

  const interimPart = fullTranscript.slice(finalTranscript.length);
  setTranscriptLive(finalTranscript, interimPart);

  if (hasFinal) {
    const result = detector.process(finalTranscript);
    if (result.detected && result.command) {
      handleCommandDetected(result.command);
    }
  }
}

async function handleCommandDetected(rawCommand) {
  stt.resetTranscript();
  let text = rawCommand.trim();

  // LLM correction
  if (hasXaiKey && !skipLlm) {
    setState("PROCESSING", "Correcting...");
    try {
      const outputLang = localStorage.getItem("outputLang") || "auto";
      text = await window.voiceEverywhere.correctTranscript(text, outputLang);
    } catch (err) {
      console.error("LLM correction failed:", err);
      // Brief warning beep + flash, but continue with raw text
      beep(330, 0.15, 0.3);
      setState("ERROR", "LLM unavailable — inserting raw");
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Insert text
  if (text) {
    setState("INSERTING", "Inserting...");
    try {
      const enterMode = localStorage.getItem("enterMode") !== "false";
      const result = await window.voiceEverywhere.insertText(text, { enterMode });
      if (result.success) {
        beep(1200, 0.2, 0.15);
        setState("SUCCESS", text);
      } else {
        setState("ERROR", "Insert failed");
      }
    } catch (err) {
      console.error("Insert failed:", err);
      setState("ERROR", "Insert failed");
    }
  } else {
    stopListening();
    setState("HIDDEN");
  }
}

function isAuthError(errMsg) {
  const lower = errMsg.toLowerCase();
  return lower.includes("401") || lower.includes("403") ||
    lower.includes("unauthorized") || lower.includes("invalid") ||
    lower.includes("authentication") || lower.includes("api key");
}

// --- Beep ---
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

// --- Button handlers ---
gearBtn.addEventListener("click", () => {
  window.voiceEverywhere.showSettings();
});

closeBtn.addEventListener("click", () => {
  stopListening();
  setState("HIDDEN");
});

// --- Focus management: enable mouse events on bar hover (for drag + buttons) ---
bar.addEventListener("mouseenter", () => {
  window.voiceEverywhere.setMouseEvents(false);
});
bar.addEventListener("mouseleave", () => {
  window.voiceEverywhere.setMouseEvents(true);
});

// --- Toggle mic from global shortcut ---
window.voiceEverywhere.onToggleMic(() => {
  if (state === "HIDDEN") {
    startListening();
  } else {
    // Stop regardless of state (LISTENING, CONNECTING, PROCESSING, INSERTING, SUCCESS, ERROR)
    if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
    stopListening();
    setState("HIDDEN");
  }
});

// --- Init ---
async function init() {
  const config = await window.voiceEverywhere.getConfig();
  sonioxKey = await window.voiceEverywhere.getSonioxKey();
  hasXaiKey = await window.voiceEverywhere.hasXaiKey();

  stt.setConfig(config.soniox);
  detector = new StopWordDetector(config.voice.stop_word);

  stt.onTranscript = handleTranscript;
  stt.onError = (err) => {
    console.error("STT error:", err);
    stopListening();
    setState("ERROR", "STT error");
  };

  loadSettings();
}

init();
