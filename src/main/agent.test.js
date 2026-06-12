import { describe, expect, it, vi } from "vitest";
import { __test__ } from "./agent.js";

vi.mock("./providers.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    completeChat: vi.fn()
  };
});

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

  it("builds stable compression cache keys for identical inputs across different sessions", () => {
    const keyA = __test__.buildCompressionCacheKey({
      transcript: "alpha",
      sessionId: "session-1",
      summaryModel: "summary-a",
      contextTokens: 1000,
      maxSummaryTokens: 200
    });
    const keyB = __test__.buildCompressionCacheKey({
      transcript: "alpha",
      sessionId: "session-2",
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

  it("proactively triggers compression when messages count is high and partitions memory", async () => {
    const { completeChat } = await import("./providers.js");
    completeChat.mockResolvedValue({
      message: { content: JSON.stringify({ goals: "Test overall goals" }) }
    });

    const priorMessages = [];
    for (let i = 0; i < 16; i++) {
      priorMessages.push({ role: "user", content: `Prompt ${i}` });
      priorMessages.push({ role: "assistant", content: `Response ${i}` });
    }

    const systemMessage = { role: "system", content: "System prompt" };
    const attachmentMessage = null;

    const result = await __test__.buildMessages({
      systemMessage,
      attachmentMessage,
      priorMessages,
      userInput: "Next user input",
      contextTokens: 128000,
      providerConfig: {
        model: "deepseek-v4-pro",
        thinkingMode: "disabled"
      },
      language: "zh",
      sessionId: "session-123",
      emit: vi.fn()
    });

    expect(result.compressed).toBe(true);
    expect(result.messages[0]).toEqual(systemMessage);
    expect(result.messages[1].role).toBe("system");
    expect(result.messages[1].content).toContain("goals");
    expect(result.messages[1].content).toContain("Test overall goals");
  });

  it("classifies only read-only tools as parallel safe", () => {
    expect(__test__.isParallelSafeToolCall({ function: { name: "read_file" } })).toBe(true);
    expect(__test__.isParallelSafeToolCall({ function: { name: "read_files" } })).toBe(true);
    expect(__test__.isParallelSafeToolCall({ function: { name: "read_file_range" } })).toBe(true);
    expect(__test__.isParallelSafeToolCall({ function: { name: "read_result_chunk" } })).toBe(true);
    expect(__test__.isParallelSafeToolCall({ function: { name: "web_search" } })).toBe(true);
    expect(__test__.isParallelSafeToolCall({ function: { name: "workspace_map" } })).toBe(true);
    expect(__test__.isParallelSafeToolCall({ function: { name: "read_command_output" } })).toBe(true);
    expect(__test__.isParallelSafeToolCall({ function: { name: "replace_text" } })).toBe(false);
    expect(__test__.isParallelSafeToolCall({ function: { name: "start_command" } })).toBe(false);
    expect(__test__.isParallelSafeToolCall({ function: { name: "browser_page" } })).toBe(false);
    expect(__test__.isParallelSafeToolCall({ function: { name: "run_command" } })).toBe(false);
  });
});
