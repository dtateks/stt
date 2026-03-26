const test = require("node:test");
const assert = require("node:assert/strict");

const { correctTranscript } = require("../electron/llm-service");

function createFetchResponse({ ok = true, status = 200, text = "", json = {} }) {
  return {
    ok,
    status,
    text: async () => text,
    json: async () => json,
  };
}

test("correctTranscript returns trimmed model content", async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => createFetchResponse({
      json: {
        choices: [
          {
            message: {
              content: " corrected output ",
            },
          },
        ],
      },
    });

    await assert.doesNotReject(async () => {
      const result = await correctTranscript("raw transcript", "key", { model: "model" }, "auto");
      assert.equal(result, "corrected output");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("correctTranscript rejects unexpected response shape", async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => createFetchResponse({ json: {} });

    await assert.rejects(
      () => correctTranscript("raw transcript", "key", { model: "model" }, "auto"),
      /response shape unexpected/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("correctTranscript converts aborted request into timeout error", async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;

  try {
    global.setTimeout = (fn) => {
      fn();
      return 1;
    };
    global.clearTimeout = () => {};
    global.fetch = async (_url, options) => {
      const error = new Error("aborted");
      error.name = options.signal.aborted ? "AbortError" : "Error";
      throw error;
    };

    await assert.rejects(
      () => correctTranscript("raw transcript", "key", { model: "model" }, "auto"),
      /timed out after 15 seconds/
    );
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
