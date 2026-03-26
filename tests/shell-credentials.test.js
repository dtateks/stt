const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildShellOutput,
  loadCredentialModules,
  withTempAppData,
  withTemporaryEnvironment,
} = require("./credential-test-helpers");

test("shell fallback launches zsh as an interactive login shell", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: undefined,
        XAI_API_KEY: undefined,
      },
      () => {
        const { shellCredentials } = loadCredentialModules({
          appDataPath,
          assertShellInvocation({ args, filePath, options }) {
            assert.equal(filePath, "/bin/zsh");
            assert.equal(args[0], "-ilc");
            assert.match(args[1], /env -0/);
            assert.equal(options.timeout, 2000);
          },
          shellOutput: buildShellOutput({
            SONIOX_API_KEY: "shell-soniox",
            XAI_API_KEY: "shell-xai",
          }),
        });

        assert.deepEqual(shellCredentials.getCredentialsFromShellEnvironment(), {
          xaiKey: "shell-xai",
          sonioxKey: "shell-soniox",
        });
      }
    );
  });
});

test("shell fallback ignores shell noise outside the env marker block", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: undefined,
        XAI_API_KEY: undefined,
      },
      () => {
        const { shellCredentials } = loadCredentialModules({
          appDataPath,
          shellOutput: buildShellOutput(
            {
              SONIOX_API_KEY: "shell-soniox",
              XAI_API_KEY: "shell-xai",
            },
            "loading plugins...\n"
          ),
        });

        assert.deepEqual(shellCredentials.getCredentialsFromShellEnvironment(), {
          xaiKey: "shell-xai",
          sonioxKey: "shell-soniox",
        });
      }
    );
  });
});

test("shell fallback fails closed when shell startup command errors", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: undefined,
        XAI_API_KEY: undefined,
      },
      () => {
        const { shellCredentials } = loadCredentialModules({
          appDataPath,
          shellError: new Error("shell startup failed"),
        });

        assert.deepEqual(shellCredentials.getCredentialsFromShellEnvironment(), {
          xaiKey: "",
          sonioxKey: "",
        });
      }
    );
  });
});

test("shell fallback is cached across repeated reads", () => {
  withTempAppData((appDataPath) => {
    withTemporaryEnvironment(
      {
        SHELL: undefined,
        SONIOX_API_KEY: undefined,
        XAI_API_KEY: undefined,
      },
      () => {
        const { shellCredentials, getShellInvocationCount } = loadCredentialModules({
          appDataPath,
          shellOutput: buildShellOutput({
            SONIOX_API_KEY: "shell-soniox",
            XAI_API_KEY: "shell-xai",
          }),
        });

        assert.deepEqual(shellCredentials.getCredentialsFromShellEnvironment(), {
          xaiKey: "shell-xai",
          sonioxKey: "shell-soniox",
        });
        assert.deepEqual(shellCredentials.getCredentialsFromShellEnvironment(), {
          xaiKey: "shell-xai",
          sonioxKey: "shell-soniox",
        });
        assert.equal(getShellInvocationCount(), 1);
      }
    );
  });
});
