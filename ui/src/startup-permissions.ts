import type { VoiceToTextBridge } from "./types.ts";

type StartupPermissionBridge = Pick<
  VoiceToTextBridge,
  | "ensureMicrophonePermission"
  | "ensureAccessibilityPermission"
  | "ensureTextInsertionPermission"
>;

export type PermissionName = "microphone" | "accessibility" | "textInsertion";

export interface PermissionPrimingResult {
  permission: PermissionName;
  granted: boolean;
  error?: string;
}

export async function requestStartupPermissions(
  bridge: StartupPermissionBridge,
): Promise<PermissionPrimingResult[]> {
  const results: PermissionPrimingResult[] = [];

  results.push(
    await primeSinglePermission("microphone", () =>
      bridge.ensureMicrophonePermission(),
    ),
  );
  results.push(
    await primeSinglePermission("accessibility", () =>
      bridge.ensureAccessibilityPermission(),
    ),
  );
  results.push(
    await primeSinglePermission("textInsertion", () =>
      bridge.ensureTextInsertionPermission(),
    ),
  );

  return results;
}

async function primeSinglePermission(
  permission: PermissionName,
  request: () => Promise<{ granted: boolean }>,
): Promise<PermissionPrimingResult> {
  try {
    const result = await request();
    return { permission, granted: result.granted };
  } catch (err) {
    // Startup permission priming is best-effort; individual flows still
    // re-check permissions when the feature is actually used.
    const error = err instanceof Error ? err.message : String(err);
    return { permission, granted: false, error };
  }
}
