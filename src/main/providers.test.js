import { describe, expect, it } from "vitest";
import { __test__ } from "./providers.js";

describe("provider request body", () => {
  it("uses DeepSeek thinking options and removes temperature/tool_choice while thinking is enabled", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "deepseek",
      apiKey: "key",
      thinkingMode: "enabled",
      reasoningEffort: "max",
      temperature: 0.7,
      maxTokens: 2048
    });
    const body = __test__.buildRequestBody(provider, {
      messages: [],
      tool_choice: "auto"
    });
    expect(body.model).toBe("deepseek-v4-pro");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("max");
    expect(body.temperature).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("keeps OpenAI-compatible request bodies simple", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai-compatible",
      apiKey: "key",
      model: "gpt-test",
      temperature: 0.4,
      maxTokens: 1234
    });
    const body = __test__.buildRequestBody(provider, {
      messages: [],
      tool_choice: "auto"
    });
    expect(body).toMatchObject({
      model: "gpt-test",
      temperature: 0.4,
      max_tokens: 1234,
      tool_choice: "auto"
    });
    expect(body.thinking).toBeUndefined();
  });
});
