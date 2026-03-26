const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MEDIA_ACCESS_STATUS,
  MACOS_PRIVACY_PANE_URLS,
  PERMISSION_ERROR_CODES,
  createMacosPermissionCoordinator,
} = require("../electron/macos-permissions");

function createPermissionCoordinator({
  mediaStatus = MEDIA_ACCESS_STATUS.granted,
  askForMediaAccessResult = true,
  accessibilityTrusted = true,
  openExternalError = null,
} = {}) {
  const calls = {
    askForMediaAccess: 0,
    openExternalUrls: [],
    accessibilityPromptArguments: [],
  };

  const systemPreferences = {
    getMediaAccessStatus(mediaType) {
      assert.equal(mediaType, "microphone");
      return mediaStatus;
    },
    async askForMediaAccess(mediaType) {
      assert.equal(mediaType, "microphone");
      calls.askForMediaAccess += 1;
      return askForMediaAccessResult;
    },
    isTrustedAccessibilityClient(prompt) {
      calls.accessibilityPromptArguments.push(prompt);
      return accessibilityTrusted;
    },
  };

  const shell = {
    async openExternal(url) {
      calls.openExternalUrls.push(url);
      if (openExternalError) {
        throw openExternalError;
      }
      return true;
    },
  };

  return {
    calls,
    coordinator: createMacosPermissionCoordinator({ systemPreferences, shell }),
  };
}

test("ensureMicrophonePermission returns granted without prompting when already granted", async () => {
  const { coordinator, calls } = createPermissionCoordinator({
    mediaStatus: MEDIA_ACCESS_STATUS.granted,
  });

  const result = await coordinator.ensureMicrophonePermission();

  assert.deepEqual(result, {
    granted: true,
    status: MEDIA_ACCESS_STATUS.granted,
  });
  assert.equal(calls.askForMediaAccess, 0);
  assert.deepEqual(calls.openExternalUrls, []);
});

test("ensureMicrophonePermission requests access when status is not determined", async () => {
  const { coordinator, calls } = createPermissionCoordinator({
    mediaStatus: MEDIA_ACCESS_STATUS.notDetermined,
    askForMediaAccessResult: true,
  });

  const result = await coordinator.ensureMicrophonePermission();

  assert.deepEqual(result, {
    granted: true,
    status: MEDIA_ACCESS_STATUS.granted,
  });
  assert.equal(calls.askForMediaAccess, 1);
  assert.deepEqual(calls.openExternalUrls, []);
});

test("ensureMicrophonePermission opens privacy pane when user declines request", async () => {
  const { coordinator, calls } = createPermissionCoordinator({
    mediaStatus: MEDIA_ACCESS_STATUS.notDetermined,
    askForMediaAccessResult: false,
  });

  const result = await coordinator.ensureMicrophonePermission();

  assert.equal(result.granted, false);
  assert.equal(result.code, PERMISSION_ERROR_CODES.microphoneRequired);
  assert.equal(result.status, MEDIA_ACCESS_STATUS.denied);
  assert.match(result.message, /Microphone permission is required/);
  assert.equal(result.openedSettings, true);
  assert.deepEqual(calls.openExternalUrls, [MACOS_PRIVACY_PANE_URLS.microphone]);
});

test("ensureMicrophonePermission opens privacy pane for denied status", async () => {
  const { coordinator, calls } = createPermissionCoordinator({
    mediaStatus: MEDIA_ACCESS_STATUS.denied,
  });

  const result = await coordinator.ensureMicrophonePermission();

  assert.equal(result.granted, false);
  assert.equal(result.code, PERMISSION_ERROR_CODES.microphoneRequired);
  assert.equal(result.status, MEDIA_ACCESS_STATUS.denied);
  assert.equal(result.openedSettings, true);
  assert.deepEqual(calls.openExternalUrls, [MACOS_PRIVACY_PANE_URLS.microphone]);
});

test("ensureMicrophonePermission opens privacy pane for restricted status", async () => {
  const { coordinator, calls } = createPermissionCoordinator({
    mediaStatus: MEDIA_ACCESS_STATUS.restricted,
  });

  const result = await coordinator.ensureMicrophonePermission();

  assert.equal(result.granted, false);
  assert.equal(result.code, PERMISSION_ERROR_CODES.microphoneRequired);
  assert.equal(result.status, MEDIA_ACCESS_STATUS.restricted);
  assert.equal(result.openedSettings, true);
  assert.deepEqual(calls.openExternalUrls, [MACOS_PRIVACY_PANE_URLS.microphone]);
});

test("ensureAccessibilityPermission prompts with true and succeeds when trusted", async () => {
  const { coordinator, calls } = createPermissionCoordinator({
    accessibilityTrusted: true,
  });

  const result = await coordinator.ensureAccessibilityPermission();

  assert.deepEqual(result, { granted: true });
  assert.deepEqual(calls.accessibilityPromptArguments, [true]);
  assert.deepEqual(calls.openExternalUrls, []);
});

test("ensureAccessibilityPermission opens privacy pane when not trusted", async () => {
  const { coordinator, calls } = createPermissionCoordinator({
    accessibilityTrusted: false,
  });

  const result = await coordinator.ensureAccessibilityPermission();

  assert.equal(result.granted, false);
  assert.equal(result.code, PERMISSION_ERROR_CODES.accessibilityRequired);
  assert.match(result.message, /Accessibility permission is required/);
  assert.equal(result.openedSettings, true);
  assert.deepEqual(calls.accessibilityPromptArguments, [true]);
  assert.deepEqual(calls.openExternalUrls, [MACOS_PRIVACY_PANE_URLS.accessibility]);
});
