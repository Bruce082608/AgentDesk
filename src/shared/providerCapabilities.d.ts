export type ProviderName = "deepseek" | "openai-compatible";

export type ModelCapability = {
  label: string;
  contextTokens: number;
  maxOutputTokens: number;
  defaultMaxTokens: number;
  supportsThinking: boolean;
  supportsToolCalls: boolean;
  supportsTemperature: boolean;
  supportsVision: boolean;
  defaultThinkingMode: "enabled" | "disabled";
  reasoningEfforts: Array<"low" | "medium" | "high" | "max">;
  defaultReasoningEffort: "low" | "medium" | "high" | "max";
};

export type ProviderCapability = {
  provider: ProviderName;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  balancePath: string;
  defaultModel: string;
  defaultSummaryModel: string;
  models: Record<string, ModelCapability>;
  fallbackModel?: ModelCapability;
};

export const PROVIDER_CAPABILITIES: Record<ProviderName, ProviderCapability>;
export function getProviderCapability(provider?: string): ProviderCapability;
export function getModelCapability(config?: Record<string, unknown>): {
  provider: ProviderCapability;
  model: string;
  capability: ModelCapability;
};
export function normalizeConfigForCapabilities<T extends Record<string, unknown>>(config?: T): {
  provider: ProviderName;
  baseUrl: string;
  model: string;
  summaryModel: string;
  contextTokens: number;
  maxTokens: number;
  maxAgentSteps: number;
  thinkingMode: "enabled" | "disabled";
  reasoningEffort: "low" | "medium" | "high" | "max";
  temperature: number;
  supportsVision: boolean;
};
export function trimTrailingSlash(value: unknown): string;

