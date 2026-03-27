import type { VoiceToTextBridge } from "./types.ts";

type StartupPermissionBridge = Pick<
  VoiceToTextBridge,
  | "ensureMicrophonePermission"
  | "ensureAccessibilityPermission"
  | "ensureTextInsertionPermission"
>;

export async function requestStartupPermissions(
  bridge: StartupPermissionBridge,
): Promise<void> {
  await ignorePermissionError(() => bridge.ensureMicrophonePermission());
  await ignorePermissionError(() => bridge.ensureAccessibilityPermission());
  await ignorePermissionError(() => bridge.ensureTextInsertionPermission());
}

async function ignorePermissionError(
  requestPermission: () => Promise<unknown>,
): Promise<void> {
  try {
    await requestPermission();
  } catch {
    // Startup permission priming is best-effort; individual flows still
    // re-check permissions when the feature is actually used.
  }
}
