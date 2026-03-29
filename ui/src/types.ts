/**
 * Shared type definitions for the UI.
 * These are consumed by both main and bar entry points.
 */

// ─── Bridge ────────────────────────────────────────────────────────────────

export interface InsertTextOptions {
  enterMode?: boolean;
}

export type LlmProvider = "xai" | "openai_compatible" | "gemini";

export interface LlmRequestOptions {
  provider?: LlmProvider;
  model?: string;
  baseUrl?: string;
}

export interface InsertTextResult {
  success: boolean;
  error?: string;
  code?: string;
  openedSettings?: boolean;
}

export interface PermissionResult {
  granted: boolean;
  status?: string;
  code?: string;
  openedSettings?: boolean;
  message?: string;
}

export interface SonioxConfig {
  ws_url: string;
  model: string;
  sample_rate: number;
  num_channels: number;
  audio_format: string;
  chunk_size: number;
  context_general?: SonioxContextGeneralEntry[];
  context_text?: string;
  enable_endpoint_detection?: boolean;
  max_endpoint_delay_ms?: number;
  max_non_final_tokens_duration_ms?: number;
  language_hints?: string[];
  language_hints_strict?: boolean;
}

export interface SonioxContextGeneralEntry {
  key: string;
  value: string;
}

export interface SonioxTemporaryApiKeyResult {
  apiKey: string;
  expiresAt?: string;
  expiresInSeconds?: number;
}

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  temperature: number;
  base_url?: string;
}

export interface VoiceConfig {
  stop_word: string;
}

export interface AppConfig {
  soniox: SonioxConfig;
  llm: LlmConfig;
  voice: VoiceConfig;
}

export interface TranslationTerm {
  source: string;
  target: string;
}

export interface PermissionsStatus {
  microphone: boolean;
  accessibility: boolean;
  automation: boolean;
}

export interface VoiceToTextBridge {
  setMicState(isActive: boolean): Promise<void>;
  insertText(text: string, opts?: InsertTextOptions): Promise<InsertTextResult>;
  correctTranscript(
    transcript: string,
    outputLang?: string,
    llmOptions?: LlmRequestOptions,
  ): Promise<string>;
  hasSonioxKey(): Promise<boolean>;
  createSonioxTemporaryKey(): Promise<SonioxTemporaryApiKeyResult>;
  hasXaiKey(): Promise<boolean>;
  hasGeminiKey(): Promise<boolean>;
  hasOpenaiCompatibleKey(): Promise<boolean>;
  getConfig(): Promise<AppConfig>;
  ensureMicrophonePermission(): Promise<PermissionResult>;
  ensureAccessibilityPermission(): Promise<PermissionResult>;
  ensureTextInsertionPermission(): Promise<PermissionResult>;
  checkPermissionsStatus(): Promise<PermissionsStatus>;
  saveCredentials(xaiKey: string, sonioxKey: string): Promise<void>;
  updateXaiKey(xaiKey: string): Promise<void>;
  updateGeminiKey(geminiKey: string): Promise<void>;
  updateOpenaiCompatibleKey(openaiCompatibleKey: string): Promise<void>;
  updateSonioxKey(sonioxKey: string): Promise<void>;
  listModels(provider?: string, baseUrl?: string): Promise<string[]>;
  listSonioxModels(): Promise<string[]>;
  resetCredentials(): Promise<void>;
  onToggleMic(callback: () => void): () => void;
  copyToClipboard(text: string): Promise<void>;
  quitApp(): Promise<void>;
  relaunchApp(): Promise<void>;
  showBar(): Promise<void>;
  hideBar(): Promise<void>;
  setMouseEvents(ignore: boolean): Promise<void>;
  showSettings(): Promise<void>;
  getMicToggleShortcut(): Promise<string>;
  updateMicToggleShortcut(shortcut: string): Promise<string>;
}

export interface VoiceToTextDefaults {
  terms: string[];
  translationTerms: TranslationTerm[];
}

declare global {
  interface Window {
    voiceToText: VoiceToTextBridge;
    voiceToTextDefaults: VoiceToTextDefaults;
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────

export type OutputLang = "auto" | "english" | "vietnamese";

export interface UserPreferences {
  enterMode: boolean;
  outputLang: OutputLang;
  sonioxTerms: string[];
  sonioxTranslationTerms: TranslationTerm[];
  skipLlm: boolean;
}

// ─── Bar state machine ──────────────────────────────────────────────────────

export type BarState =
  | "HIDDEN"
  | "CONNECTING"
  | "LISTENING"
  | "PROCESSING"
  | "INSERTING"
  | "SUCCESS"
  | "ERROR";

// ─── Soniox STT ─────────────────────────────────────────────────────────────

export interface SonioxSTTClient {
  setConfig(config: SonioxConfig): void;
  start(apiKey: string, context: SonioxContext): Promise<void>;
  finalizeCurrentUtterance(fallbackTranscript: string): Promise<string>;
  stop(): void;
  resetTranscript(): void;
  getAnalyser(): AnalyserNode | null;
  onTranscript: TranscriptCallback | null;
  onError: ErrorCallback | null;
}

export interface SonioxContext {
  terms?: string[];
  translationTerms?: TranslationTerm[];
}

export interface TranscriptResult {
  finalText: string;
  interimText: string;
}

export type TranscriptCallback = (result: TranscriptResult) => void;
export type ErrorCallback = (error: Error) => void;
