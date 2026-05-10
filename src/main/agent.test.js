import { describe, expect, it } from "vitest";
import { __test__ } from "./agent.js";

describe("agent history compression budgets", () => {
  it("scales summary and transcript budgets for a 1M-token summary model", () => {
    const budgets = __test__.getSummaryCompressionBudgets({
      contextTokens: 1_000_000,
      config: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        summaryModel: "deepseek-v4-pro",
        contextTokens: 1_000_000,
        maxTokens: 65_536,
        thinkingMode: "enabled",
        reasoningEffort: "max",
        temperature: 0.2
      }
    });

    expect(budgets.maxSummaryTokens).toBe(65_536);
    expect(budgets.transcriptBudget).toBeGreaterThan(700_000);
  });

  it("keeps transcript budget inside the selected summary model input window", () => {
    const budgets = __test__.getSummaryCompressionBudgets({
      contextTokens: 1_000_000,
      config: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        summaryModel: "deepseek-v4-flash",
        contextTokens: 1_000_000,
        maxTokens: 65_536,
        thinkingMode: "enabled",
        reasoningEffort: "max",
        temperature: 0.2
      }
    });

    expect(budgets.summaryContextTokens).toBe(128_000);
    expect(budgets.maxSummaryTokens).toBe(32_768);
    expect(budgets.transcriptBudget).toBeLessThanOrEqual(budgets.summaryInputBudgetTokens);
  });

  it("builds stable compression cache keys for identical inputs", () => {
    const keyA = __test__.buildCompressionCacheKey({
      transcript: "alpha",
      sessionId: "session-1",
      summaryModel: "summary-a",
      contextTokens: 1000,
      maxSummaryTokens: 200
    });
    const keyB = __test__.buildCompressionCacheKey({
      transcript: "alpha",
      sessionId: "session-1",
      summaryModel: "summary-a",
      contextTokens: 1000,
      maxSummaryTokens: 200
    });
    const keyC = __test__.buildCompressionCacheKey({
      transcript: "beta",
      sessionId: "session-1",
      summaryModel: "summary-a",
      contextTokens: 1000,
      maxSummaryTokens: 200
    });

    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });
});
