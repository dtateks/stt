const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

const SHELL_ENV_TIMEOUT_MS = 2000;
const SHELL_ENV_MAX_BUFFER_BYTES = 1024 * 1024;
const SHELL_ENV_START_MARKER = "__VOICE_TO_TEXT_ENV_START__";
const SHELL_ENV_END_MARKER = "__VOICE_TO_TEXT_ENV_END__";
const XAI_API_KEY_ENV_NAME = "XAI_API_KEY";
const SONIOX_API_KEY_ENV_NAME = "SONIOX_API_KEY";

let cachedCredentials = null;

function getCredentialsFromShellEnvironment() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  cachedCredentials = readCredentialsFromShell();
  return cachedCredentials;
}

function readCredentialsFromShell() {
  const shellPath = getUserShellPath();

  if (!shellPath) {
    return emptyCredentials();
  }

  try {
    const stdout = execFileSync(shellPath, getShellCommandArguments(shellPath), {
      encoding: "buffer",
      env: {
        ...process.env,
        TERM: process.env.TERM || "dumb",
      },
      maxBuffer: SHELL_ENV_MAX_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: SHELL_ENV_TIMEOUT_MS,
    });

    return extractCredentialsFromShellOutput(stdout);
  } catch {
    return emptyCredentials();
  }
}

function getUserShellPath() {
  if (process.env.SHELL) {
    return process.env.SHELL;
  }

  try {
    return os.userInfo().shell || "";
  } catch {
    return "";
  }
}

function getShellCommandArguments(shellPath) {
  const shellName = path.basename(shellPath);
  const launchMode = shellName === "zsh" || shellName === "bash" ? "-ilc" : "-lc";

  return [launchMode, buildShellEnvironmentCommand()];
}

function buildShellEnvironmentCommand() {
  return [
    `printf '%s\\0' '${SHELL_ENV_START_MARKER}'`,
    "env -0",
    `printf '%s\\0' '${SHELL_ENV_END_MARKER}'`,
  ].join("; ");
}

function extractCredentialsFromShellOutput(stdout) {
  const shellEnvironment = parseShellEnvironment(stdout);

  return {
    xaiKey: shellEnvironment[XAI_API_KEY_ENV_NAME] || "",
    sonioxKey: shellEnvironment[SONIOX_API_KEY_ENV_NAME] || "",
  };
}

function parseShellEnvironment(stdout) {
  const outputBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  const startMarker = Buffer.from(`${SHELL_ENV_START_MARKER}\0`);
  const endMarker = Buffer.from(`${SHELL_ENV_END_MARKER}\0`);
  const startIndex = outputBuffer.indexOf(startMarker);
  const endIndex = outputBuffer.indexOf(endMarker, startIndex + startMarker.length);

  if (startIndex === -1 || endIndex === -1) {
    return {};
  }

  return outputBuffer
    .subarray(startIndex + startMarker.length, endIndex)
    .toString("utf-8")
    .split("\0")
    .filter(Boolean)
    .reduce((environment, entry) => {
      const separatorIndex = entry.indexOf("=");

      if (separatorIndex === -1) {
        return environment;
      }

      return {
        ...environment,
        [entry.slice(0, separatorIndex)]: entry.slice(separatorIndex + 1),
      };
    }, {});
}

function emptyCredentials() {
  return {
    xaiKey: "",
    sonioxKey: "",
  };
}

module.exports = {
  getCredentialsFromShellEnvironment,
};
