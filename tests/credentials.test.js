const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildShellOutput,
  loadCredentialModules,
  withTempAppData,
  withTemporaryEnvironment,
} = require("./credential-test-helpers");

test("credentials save into the renamed voice-to-text app data folder", () => {
  withTempAppData((appDataPath) => {
    const { credentials } = loadCredentialModules({ appDataPath });
    const credentialsPath = path.join(
      appDataPath,
      "voice-to-text",
      "credentials.json"
    );

    credentials.saveCredentials("xai-key", "soniox-key");

    assert.deepEqual(credentials.getCredentials(), {
      xaiKey: "xai-key",
      sonioxKey: "soniox-key",
    });
    assert.equal(fs.existsSync(credentialsPath), true);
  });
});

test("credentials module migrates legacy voice-everywhere storage to voice-to-text", () => {
  withTempAppData((appDataPath) => {
    const legacyDir = path.join(appDataPath, "voice-everywhere");
    const legacyPath = path.join(legacyDir, "credentials.json");
    const currentPath = path.join(appDataPath, "voice-to-text", "credentials.json");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ xaiKey: "legacy-xai", sonioxKey: "legacy-soniox" }, null, 2),
      "utf-8"
    );

    const { credentials } = loadCredentialModules({ appDataPath });

    assert.deepEqual(credentials.getCredentials(), {
      xaiKey: "legacy-xai",
      sonioxKey: "legacy-soniox",
    });
    assert.equal(fs.existsSync(currentPath), true);
    assert.equal(fs.existsSync(legacyPath), false);
  });
});

test("clearCredentials removes both current and legacy credential files", () => {
  withTempAppData((appDataPath) => {
    const legacyDir = path.join(appDataPath, "voice-everywhere");
    const legacyPath = path.join(legacyDir, "credentials.json");
    const currentPath = path.join(appDataPath, "voice-to-text", "credentials.json");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify({ xaiKey: "old" }), "utf-8");

    const { credentials } = loadCredentialModules({ appDataPath });
    credentials.saveCredentials("new-xai", "new-soniox");

    assert.equal(fs.existsSync(currentPath), true);
    credentials.clearCredentials();
    assert.equal(fs.existsSync(currentPath), false);
    assert.equal(fs.existsSync(legacyPath), false);
  });
});

test("credentials fall back to process env when JSON storage is empty", () => {
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

test("credentials fall back to the shell startup environment when env is missing", () => {
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

        assert.deepEqual(credentials.getCredentials(), {
          xaiKey: "shell-xai",
          sonioxKey: "shell-soniox",
        });
      }
    );
  });
});
