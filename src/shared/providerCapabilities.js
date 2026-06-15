import { DEFAULT_DEEPSEEK_CONTEXT_TOKENS, DEFAULT_OPENAI_COMPATIBLE_CONTEXT_TOKENS } from "./contextBudget.js";

export const PROVIDER_CAPABILITIES = {
  deepseek: {
    provider: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    balancePath: "/user/balance",
    defaultModel: "deepseek-v4-pro",
    defaultSummaryModel: "deepseek-v4-flash",
    models: {
      "deepseek-v4-pro": {
        label: "DeepSeek V4 Pro",
        contextTokens: DEFAULT_DEEPSEEK_CONTEXT_TOKENS,
        maxOutputTokens: 65_536,
        defaultMaxTokens: 32_768,
        supportsThinking: true,
        supportsToolCalls: true,
        supportsTemperature: false,
        supportsVision: false,
        defaultThinkingMode: "enabled",
        reasoningEfforts: ["low", "medium", "high", "max"],
        defaultReasoningEffort: "max"
      },
      "deepseek-v4-flash": {
        label: "DeepSeek V4 Flash",
        contextTokens: 128_000,
        maxOutputTokens: 32_768,
        defaultMaxTokens: 16_384,
        supportsThinking: false,
        supportsToolCalls: true,
        supportsTemperature: true,
        supportsVision: false,
        defaultThinkingMode: "disabled",
        reasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium"
      },
      "deepseek-chat": {
        label: "DeepSeek Chat (V3.2)",
        contextTokens: 128_000,
        maxOutputTokens: 32_768,
        defaultMaxTokens: 8_192,
        supportsThinking: false,
        supportsToolCalls: true,
        supportsTemperature: true,
        supportsVision: false,
        defaultThinkingMode: "disabled",
        reasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium"
      }
    }
  },
  openai: {
    provider: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    balancePath: "",
    defaultModel: "gpt-4.1-mini",
    defaultSummaryModel: "",
    models: {
      "o4-mini": {
        label: "o4-mini",
        contextTokens: 200_000,
        maxOutputTokens: 100_000,
        defaultMaxTokens: 32_768,
        supportsThinking: true,
        supportsToolCalls: true,
        supportsTemperature: false,
        supportsVision: true,
        defaultThinkingMode: "enabled",
        reasoningEfforts: ["low", "medium", "high"],
        defaultReasoningEffort: "medium"
      },
      "o3": {
        label: "o3",
        contextTokens: 200_000,
        maxOutputTokens: 100_000,
        defaultMaxTokens: 32_768,
        supportsThinking: true,
        supportsToolCalls: true,
        supportsTemperature: false,
        supportsVision: true,
        defaultThinkingMode: "enabled",
        reasoningEfforts: ["low", "medium", "high"],
        defaultReasoningEffort: "medium"
      }
    },
    fallbackModel: {
      label: "OpenAI Model",
      contextTokens: DEFAULT_OPENAI_COMPATIBLE_CONTEXT_TOKENS,
      maxOutputTokens: 32_768,
      defaultMaxTokens: 8_192,
      supportsThinking: true,
      supportsToolCalls: true,
      supportsTemperature: true,
      supportsVision: true,
      defaultThinkingMode: "disabled",
      reasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium"
    }
  },
  "openai-compatible": {
    provider: "openai-compatible",
    label: "OpenAI-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    balancePath: "",
    defaultModel: "gpt-4.1-mini",
    defaultSummaryModel: "",
    models: {
      "gpt-4.1-mini": {
        label: "GPT-4.1 Mini",
        contextTokens: DEFAULT_OPENAI_COMPATIBLE_CONTEXT_TOKENS,
        maxOutputTokens: 32_768,
        defaultMaxTokens: 4_096,
        supportsThinking: false,
        supportsToolCalls: true,
        supportsTemperature: true,
        supportsVision: true,
        defaultThinkingMode: "disabled",
        reasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium"
      }
    },
    fallbackModel: {
      label: "Custom OpenAI-compatible model",
      contextTokens: DEFAULT_OPENAI_COMPATIBLE_CONTEXT_TOKENS,
      maxOutputTokens: 32_768,
      defaultMaxTokens: 4_096,
      supportsThinking: true,
      supportsToolCalls: true,
      supportsTemperature: true,
      supportsVision: true,
      defaultThinkingMode: "disabled",
      reasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium"
    }
  }
};

export function getProviderCapability(provider) {
  return PROVIDER_CAPABILITIES[provider] || PROVIDER_CAPABILITIES.deepseek;
}

export function getModelCapability(config = {}) {
  const provider = getProviderCapability(config.provider);
  const rawModel = String(config.model || "").trim();
  const model = provider.models[rawModel]
    ? rawModel
    : (provider.provider === "openai-compatible" || provider.provider === "openai") && rawModel
      ? rawModel
      : provider.defaultModel;
  let rawCapability = provider.models[model] || provider.fallbackModel || provider.models[provider.defaultModel];

  // Auto-detect OpenAI o-series and gpt-5 reasoning models by name pattern
  if ((provider.provider === "openai" || provider.provider === "openai-compatible") && !provider.models[model] && /^(o[1-9]|gpt-5)/i.test(model)) {
    rawCapability = {
      ...rawCapability,
      supportsThinking: true,
      supportsTemperature: false,
      defaultThinkingMode: "enabled",
      reasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium"
    };
  }
  
  const modelName = String(model).toLowerCase();
  const isCommonVisionModel = /gpt-4o|claude-3|gemini|vl|vision|qwen-vl|internvl/i.test(modelName);
  const capability = {
    ...rawCapability,
    supportsVision: typeof rawCapability.supportsVision === "boolean"
      ? rawCapability.supportsVision
      : isCommonVisionModel
  };

  return { provider, model, capability };
}

export function normalizeConfigForCapabilities(config = {}) {
  const { provider, model, capability } = getModelCapability(config);
  const contextTokens = clampInteger(config.contextTokens, capability.contextTokens, 4_096, capability.contextTokens);
  const maxTokens = clampInteger(config.maxTokens, capability.defaultMaxTokens, 1, capability.maxOutputTokens);
  const requestedThinkingMode = config.thinkingMode === "enabled" || config.thinkingMode === "disabled"
    ? config.thinkingMode
    : capability.defaultThinkingMode;
  const thinkingMode = capability.supportsThinking ? requestedThinkingMode : capability.defaultThinkingMode;
  const reasoningEffort = capability.reasoningEfforts.includes(config.reasoningEffort)
    ? config.reasoningEffort
    : capability.defaultReasoningEffort;
  const temperature = clampNumber(config.temperature, 0.2, 0, 2);

  return {
    provider: provider.provider,
    baseUrl: trimTrailingSlash(config.baseUrl || provider.baseUrl),
    model,
    summaryModel: normalizeSummaryModel(config.summaryModel, provider),
    contextTokens,
    maxTokens,
    maxAgentSteps: clampInteger(config.maxAgentSteps, 64, 8, 256),
    thinkingMode,
    reasoningEffort,
    temperature,
    supportsVision: capability.supportsVision,
    telegramEnabled: typeof config.telegramEnabled === "boolean" ? config.telegramEnabled : undefined,
    telegramAllowedUserId: typeof config.telegramAllowedUserId === "string" ? config.telegramAllowedUserId : undefined,
    telegramBotToken: typeof config.telegramBotToken === "string" ? config.telegramBotToken : undefined,
    jimengToken: typeof config.jimengToken === "string" ? config.jimengToken : undefined
  };
}

export function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeSummaryModel(summaryModel, provider) {
  const value = typeof summaryModel === "string" ? summaryModel.trim() : "";
  return value || provider.defaultSummaryModel;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
