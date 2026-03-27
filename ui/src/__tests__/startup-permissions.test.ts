import { describe, expect, it, vi } from "vitest";

import { requestStartupPermissions } from "../startup-permissions.ts";

describe("requestStartupPermissions", () => {
  it("requests microphone, accessibility, then text insertion permission", async () => {
    const calls: string[] = [];
    const bridge = {
      ensureMicrophonePermission: vi.fn(async () => {
        calls.push("microphone");
        return { granted: true };
      }),
      ensureAccessibilityPermission: vi.fn(async () => {
        calls.push("accessibility");
        return { granted: true };
      }),
      ensureTextInsertionPermission: vi.fn(async () => {
        calls.push("text-insertion");
        return { granted: true };
      }),
    };

    await requestStartupPermissions(bridge);

    expect(calls).toEqual(["microphone", "accessibility", "text-insertion"]);
    expect(bridge.ensureMicrophonePermission).toHaveBeenCalledTimes(1);
    expect(bridge.ensureAccessibilityPermission).toHaveBeenCalledTimes(1);
    expect(bridge.ensureTextInsertionPermission).toHaveBeenCalledTimes(1);
  });

  it("continues requesting later permissions when an earlier one rejects", async () => {
    const calls: string[] = [];
    const bridge = {
      ensureMicrophonePermission: vi.fn(async () => {
        calls.push("microphone");
        throw new Error("denied");
      }),
      ensureAccessibilityPermission: vi.fn(async () => {
        calls.push("accessibility");
        return { granted: true };
      }),
      ensureTextInsertionPermission: vi.fn(async () => {
        calls.push("text-insertion");
        return { granted: true };
      }),
    };

    await requestStartupPermissions(bridge);

    expect(calls).toEqual(["microphone", "accessibility", "text-insertion"]);
  });
});
