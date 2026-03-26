const MICROPHONE_MEDIA_TYPE = "microphone";

const MEDIA_ACCESS_STATUS = Object.freeze({
  granted: "granted",
  denied: "denied",
  restricted: "restricted",
  notDetermined: "not-determined",
  notDeterminedLegacy: "not determined",
});

const MACOS_PRIVACY_PANE_URLS = Object.freeze({
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
});

const PERMISSION_ERROR_CODES = Object.freeze({
  microphoneRequired: "microphone-permission-required",
  accessibilityRequired: "accessibility-permission-required",
});

function createMacosPermissionCoordinator({ systemPreferences, shell }) {
  async function openPrivacyPane(url) {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      console.error(`[permissions] Failed to open System Settings pane: ${error.message}`);
      return false;
    }
  }

  function isNotDeterminedStatus(status) {
    return (
      status === MEDIA_ACCESS_STATUS.notDetermined
      || status === MEDIA_ACCESS_STATUS.notDeterminedLegacy
    );
  }

  async function buildMicrophonePermissionDeniedResult(status) {
    const openedSettings = await openPrivacyPane(MACOS_PRIVACY_PANE_URLS.microphone);

    return {
      granted: false,
      status,
      code: PERMISSION_ERROR_CODES.microphoneRequired,
      openedSettings,
      message:
        "Microphone permission is required. Enable Voice to Text in System Settings → Privacy & Security → Microphone, then restart Voice to Text and try again.",
    };
  }

  async function ensureMicrophonePermission() {
    const status = systemPreferences.getMediaAccessStatus(MICROPHONE_MEDIA_TYPE);

    if (status === MEDIA_ACCESS_STATUS.granted) {
      return { granted: true, status };
    }

    if (isNotDeterminedStatus(status)) {
      const granted = await systemPreferences.askForMediaAccess(MICROPHONE_MEDIA_TYPE);
      if (granted) {
        return { granted: true, status: MEDIA_ACCESS_STATUS.granted };
      }

      return buildMicrophonePermissionDeniedResult(MEDIA_ACCESS_STATUS.denied);
    }

    return buildMicrophonePermissionDeniedResult(status);
  }

  async function ensureAccessibilityPermission() {
    const granted = systemPreferences.isTrustedAccessibilityClient(true);
    if (granted) {
      return { granted: true };
    }

    const openedSettings = await openPrivacyPane(MACOS_PRIVACY_PANE_URLS.accessibility);
    return {
      granted: false,
      code: PERMISSION_ERROR_CODES.accessibilityRequired,
      openedSettings,
      message:
        "Accessibility permission is required to insert text. Enable Voice to Text in System Settings → Privacy & Security → Accessibility, then try again.",
    };
  }

  return {
    ensureMicrophonePermission,
    ensureAccessibilityPermission,
  };
}

module.exports = {
  MEDIA_ACCESS_STATUS,
  MACOS_PRIVACY_PANE_URLS,
  PERMISSION_ERROR_CODES,
  createMacosPermissionCoordinator,
};
