const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createClassList() {
  return {
    add() {},
    remove() {},
  };
}

function createElement() {
  return {
    className: "",
    textContent: "",
    appendChild() {},
    setAttribute() {},
    addEventListener() {},
    classList: createClassList(),
  };
}

test("bar renderer boots without waveform canvas and still registers shortcut listener", async () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "ui", "bar-renderer.js"),
    "utf8"
  );

  let toggleHandler = null;
  const bar = createElement();
  const transcript = createElement();
  const gearButton = createElement();
  const closeButton = createElement();

  const context = {
    console: {
      error() {},
      log() {},
      warn() {},
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    window: {
      voiceEverywhereDefaults: {
        terms: [],
        translationTerms: [],
      },
      voiceEverywhere: {
        hideBar() {},
        showBar() {},
        setMicState() {},
        showSettings() {},
        onToggleMic(callback) {
          toggleHandler = callback;
          return () => {};
        },
        getConfig: async () => ({
          soniox: {},
          voice: { stop_word: "thank you" },
        }),
        getSonioxKey: async () => "",
        hasXaiKey: async () => false,
      },
    },
    document: {
      getElementById(id) {
        if (id === "bar") return bar;
        if (id === "transcript-text") return transcript;
        if (id === "gear-btn") return gearButton;
        if (id === "close-btn") return closeButton;
        if (id === "bar-indicator") return createElement();
        if (id === "waveform") return null;
        return null;
      },
      createElement,
    },
    SonioxSTT: class {
      setConfig() {}
      stop() {}
      getAnalyser() {
        return null;
      }
    },
    StopWordDetector: class {
      constructor() {}
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
    AudioContext: class {},
  };

  assert.doesNotThrow(() => {
    vm.runInNewContext(source, context, { filename: "ui/bar-renderer.js" });
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(typeof toggleHandler, "function");
});

test("bar renderer avoids duplicate waveform animation loops", async () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "ui", "bar-renderer.js"),
    "utf8"
  );

  let rafCalls = 0;
  const bar = createElement();
  const transcript = createElement();
  const gearButton = createElement();
  const closeButton = createElement();
  const waveformContext = {
    clearRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
  };
  const waveform = {
    width: 96,
    height: 24,
    getContext() {
      return waveformContext;
    },
  };

  const context = {
    console: {
      error() {},
      log() {},
      warn() {},
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    window: {
      voiceEverywhereDefaults: {
        terms: [],
        translationTerms: [],
      },
      voiceEverywhere: {
        hideBar() {},
        showBar() {},
        setMicState() {},
        showSettings() {},
        onToggleMic() {
          return () => {};
        },
        getConfig: async () => ({
          soniox: {},
          voice: { stop_word: "thank you" },
        }),
        getSonioxKey: async () => "",
        hasXaiKey: async () => false,
      },
    },
    document: {
      getElementById(id) {
        if (id === "bar") return bar;
        if (id === "transcript-text") return transcript;
        if (id === "gear-btn") return gearButton;
        if (id === "close-btn") return closeButton;
        if (id === "bar-indicator") return createElement();
        if (id === "waveform") return waveform;
        return null;
      },
      createElement,
    },
    SonioxSTT: class {
      setConfig() {}
      stop() {}
      getAnalyser() {
        return {
          frequencyBinCount: 32,
          getByteFrequencyData(data) {
            data.fill(128);
          },
        };
      }
    },
    StopWordDetector: class {
      constructor() {}
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame() {
      rafCalls += 1;
      return rafCalls;
    },
    cancelAnimationFrame() {},
    AudioContext: class {},
  };

  vm.runInNewContext(source, context, { filename: "ui/bar-renderer.js" });
  await new Promise((resolve) => setImmediate(resolve));

  context.startWaveform();
  context.startWaveform();

  assert.equal(rafCalls, 1);
});
