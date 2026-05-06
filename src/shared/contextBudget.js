export const DEFAULT_DEEPSEEK_CONTEXT_TOKENS = 1_000_000;
export const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_TOKENS = 128_000;

export function getDynamicSafetyMarginTokens(contextTokens, maxOutputTokens = 0) {
  const context = Math.max(4096, Math.floor(Number(contextTokens) || DEFAULT_DEEPSEEK_CONTEXT_TOKENS));
  const output = Math.max(0, Math.floor(Number(maxOutputTokens) || 0));
  const contextMargin = Math.ceil(context * 0.01);
  const outputMargin = Math.ceil(output * 0.1);
  return Math.min(64_000, Math.max(4_096, contextMargin, outputMargin));
}

export function getInputBudgetTokens(contextTokens, maxOutputTokens = 0) {
  const context = Math.max(4096, Math.floor(Number(contextTokens) || DEFAULT_DEEPSEEK_CONTEXT_TOKENS));
  const output = Math.min(Math.max(0, Math.floor(Number(maxOutputTokens) || 0)), Math.max(0, context - 1024));
  const safetyMargin = getDynamicSafetyMarginTokens(context, output);
  return Math.max(1024, context - output - safetyMargin);
}
