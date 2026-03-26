const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");

const CREDENTIALS_MODULE_PATH = require.resolve("../electron/credentials");
const SHELL_CREDENTIALS_MODULE_PATH = require.resolve("../electron/shell-credentials");
const SHELL_ENV_START_MARKER = "__VOICE_TO_TEXT_ENV_START__";
const SHELL_ENV_END_MARKER = "__VOICE_TO_TEXT_ENV_END__";

function withTempAppData(runTest) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-to-text-"));

  try {
    return runTest(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function withTemporaryEnvironment(environment, runTest) {
  const previousEnvironment = new Map(
    Object.keys(environment).map((name) => [name, process.env[name]])
  );

  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete process.env[name];
      continue;
    }

    process.env[name] = value;
  }

  try {
    return runTest();
  } finally {
    for (const [name, value] of previousEnvironment.entries()) {
      if (value === undefined) {
        delete process.env[name];
        continue;
      }

      process.env[name] = value;
    }
  }
}

function buildShellOutput(environment, noise = "") {
  const entries = Object.entries(environment)
    .map(([name, value]) => `${name}=${value}`)
    .join("\0");
  const payload = entries ? `${entries}\0` : "";

  return Buffer.from(
    `${noise}${SHELL_ENV_START_MARKER}\0${payload}${SHELL_ENV_END_MARKER}\0`
  );
}

function loadCredentialModules({
  appDataPath,
  shellOutput = buildShellOutput({}),
  shellPath = "/bin/zsh",
  shellError = null,
  assertShellInvocation = null,
} = {}) {
  delete require.cache[CREDENTIALS_MODULE_PATH];
  delete require.cache[SHELL_CREDENTIALS_MODULE_PATH];

  let shellInvocationCount = 0;
  const originalLoad = Module._load;

  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath(name) {
            assert.equal(name, "appData");
            return appDataPath;
          },
        },
      };
    }

    if (request === "os") {
      return {
        ...os,
        userInfo() {
          return {
            shell: shellPath,
          };
        },
      };
    }

    if (request === "child_process") {
      return {
        execFileSync(filePath, args, options) {
          shellInvocationCount += 1;

          if (assertShellInvocation) {
            assertShellInvocation({
              args,
              count: shellInvocationCount,
              filePath,
              options,
            });
          }

          if (shellError) {
            throw shellError;
          }

          return shellOutput;
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return {
      credentials: require(CREDENTIALS_MODULE_PATH),
      shellCredentials: require(SHELL_CREDENTIALS_MODULE_PATH),
      getShellInvocationCount() {
        return shellInvocationCount;
      },
    };
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = {
  buildShellOutput,
  loadCredentialModules,
  withTempAppData,
  withTemporaryEnvironment,
};
