export const DEFAULT_DEEPSEEK_CONTEXT_TOKENS: number;
export const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_TOKENS: number;
export function getDynamicSafetyMarginTokens(contextTokens: number, maxOutputTokens?: number): number;
export function getInputBudgetTokens(contextTokens: number, maxOutputTokens?: number): number;
