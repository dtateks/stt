const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildShellOutput,
  loadCredentialModules,
  withTempAppData,
  withTemporaryEnvironment,
} = require("./credential-test-helpers");

test("stored JSON takes precedence over env and shell fallback", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: "env-soniox",
        XAI_API_KEY: "env-xai",
      },
      () => {
        const { credentials, getShellInvocationCount } = loadCredentialModules({
          appDataPath,
          shellOutput: buildShellOutput({
            SONIOX_API_KEY: "shell-soniox",
            XAI_API_KEY: "shell-xai",
          }),
        });

        credentials.saveCredentials("json-xai", "json-soniox");

        assert.deepEqual(credentials.getCredentials(), {
          xaiKey: "json-xai",
          sonioxKey: "json-soniox",
        });
        assert.equal(getShellInvocationCount(), 0);
      }
    );
  });
});

test("env takes precedence over shell fallback", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: "env-soniox",
        XAI_API_KEY: "env-xai",
      },
      () => {
        const { credentials, getShellInvocationCount } = loadCredentialModules({
          appDataPath,
          shellOutput: buildShellOutput({
            SONIOX_API_KEY: "shell-soniox",
            XAI_API_KEY: "shell-xai",
          }),
        });

        assert.deepEqual(credentials.getCredentials(), {
          xaiKey: "env-xai",
          sonioxKey: "env-soniox",
        });
        assert.equal(getShellInvocationCount(), 0);
      }
    );
  });
});

test("missing stored key is filled from the next available fallback source", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: undefined,
        XAI_API_KEY: undefined,
      },
      () => {
        const { credentials } = loadCredentialModules({
          appDataPath,
          shellOutput: buildShellOutput({
            SONIOX_API_KEY: "shell-soniox",
          }),
        });

        credentials.saveXaiKey("json-xai");

        assert.deepEqual(credentials.getCredentials(), {
          xaiKey: "json-xai",
          sonioxKey: "shell-soniox",
        });
      }
    );
  });
});

test("hasCredentials returns true when shell fallback provides both keys", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: undefined,
        XAI_API_KEY: undefined,
      },
      () => {
        const { credentials } = loadCredentialModules({
          appDataPath,
          shellOutput: buildShellOutput({
            SONIOX_API_KEY: "shell-soniox",
            XAI_API_KEY: "shell-xai",
          }),
        });

        assert.equal(credentials.hasCredentials(), true);
      }
    );
  });
});
