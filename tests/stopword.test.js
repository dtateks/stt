const test = require("node:test");
const assert = require("node:assert/strict");

const { StopWordDetector } = require("../ui/stopword");

test("StopWordDetector detects normalized stop word suffix", () => {
  const detector = new StopWordDetector("thank you");

  const result = detector.process("Open the PR, THANK   YOU!!!");

  assert.deepEqual(result, {
    detected: true,
    command: "Open the PR,",
  });
});

test("StopWordDetector returns false when transcript does not end with stop word", () => {
  const detector = new StopWordDetector("thank you");

  const result = detector.process("Open the PR now");

  assert.deepEqual(result, {
    detected: false,
    command: "",
  });
});

test("StopWordDetector supports custom stop words", () => {
  const detector = new StopWordDetector("done now");

  const result = detector.process("Ship it... done now");

  assert.deepEqual(result, {
    detected: true,
    command: "Ship it...",
  });
});
