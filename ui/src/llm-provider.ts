/**
 * Canonical LLM provider catalogue.
 *
 * Single source of truth for everything that branches on `LlmProvider`:
 *   - identifying constants (`xai`, `gemini`, `openai_compatible`)
 *   - default model per provider (null = no auto-pick, opt-in via fetch)
 *   - human label used in form copy and runtime errors
 *   - provider-scoped bridge `has*Key` / `update*Key` accessors
 *
 * Both `main.ts` (settings panel) and `bar-session-controller.ts` (live
 * correction hot path) read from this catalogue. Keep dispatch tables here;
 * never re-inline a `provider === XAI_PROVIDER ? ... : provider === GEMINI_PROVIDER ? ...`
 * chain in either consumer.
 *
 * The wire-format `LlmProvider` string id remains the bridge contract; the
 * Rust side has a mirror `Provider` enum in `src/src/llm_provider.rs`.
 */
import type { LlmProvider, VoiceToTextBridge } from "./types.ts";

export const XAI_PROVIDER: LlmProvider = "xai";
export const OPENAI_COMPATIBLE_PROVIDER: LlmProvider = "openai_compatible";
export const GEMINI_PROVIDER: LlmProvider = "gemini";

export const DEFAULT_XAI_MODEL = "grok-4-1-fast-non-reasoning";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";

interface ProviderInfo {
  id: LlmProvider;
  /** Human label used in error/status copy and the provider-key form label. */
  label: string;
  /**
   * Default model id. `null` means "no auto-pick" — the picker leaves the
   * dropdown on its `chooseModelPlaceholder` until the user chooses.
   */
  defaultModel: string | null;
  hasKey: (bridge: VoiceToTextBridge) => Promise<boolean>;
  updateKey: (bridge: VoiceToTextBridge, key: string) => Promise<void>;
}

const PROVIDER_CATALOG: Record<LlmProvider, ProviderInfo> = {
  xai: {
    id: XAI_PROVIDER,
    label: "xAI",
    defaultModel: DEFAULT_XAI_MODEL,
    hasKey: (bridge) => bridge.hasXaiKey(),
    updateKey: (bridge, key) => bridge.updateXaiKey(key),
  },
  gemini: {
    id: GEMINI_PROVIDER,
    label: "Gemini",
    defaultModel: DEFAULT_GEMINI_MODEL,
    hasKey: (bridge) => bridge.hasGeminiKey(),
    updateKey: (bridge, key) => bridge.updateGeminiKey(key),
  },
  openai_compatible: {
    id: OPENAI_COMPATIBLE_PROVIDER,
    label: "OpenAI-compatible",
    defaultModel: null,
    hasKey: (bridge) => bridge.hasOpenaiCompatibleKey(),
    updateKey: (bridge, key) => bridge.updateOpenaiCompatibleKey(key),
  },
};

export function getProviderInfo(provider: LlmProvider): ProviderInfo {
  return PROVIDER_CATALOG[provider];
}

export function defaultModelForProvider(provider: LlmProvider): string | null {
  return getProviderInfo(provider).defaultModel;
}

export function providerLabel(provider: LlmProvider): string {
  return getProviderInfo(provider).label;
}

export function hasProviderKey(
  bridge: VoiceToTextBridge,
  provider: LlmProvider,
): Promise<boolean> {
  return getProviderInfo(provider).hasKey(bridge);
}

export function updateProviderKey(
  bridge: VoiceToTextBridge,
  provider: LlmProvider,
  key: string,
): Promise<void> {
  return getProviderInfo(provider).updateKey(bridge, key);
}
