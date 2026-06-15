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

  it("keeps DeepSeek thinking disabled when selected", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "deepseek",
      apiKey: "key",
      thinkingMode: "disabled",
      reasoningEffort: "high",
      maxTokens: 2048
    });
    const body = __test__.buildRequestBody(provider, {
      messages: [],
      tool_choice: "auto"
    });
    expect(provider.thinkingMode).toBe("disabled");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.tool_choice).toBe("auto");
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

  it("builds standard request body for OpenAI free-text models", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai",
      apiKey: "key",
      model: "gpt-5.5",
      temperature: 0.3,
      maxTokens: 8192
    });
    const body = __test__.buildRequestBody(provider, {
      messages: [],
      tool_choice: "auto"
    });
    expect(body.model).toBe("gpt-5.5");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(8192);
    expect(body.tool_choice).toBe("auto");
    expect(body.thinking).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("uses max_completion_tokens and reasoning_effort for OpenAI o4-mini", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai",
      apiKey: "key",
      model: "o4-mini",
      reasoningEffort: "high",
      maxTokens: 16384
    });
    const body = __test__.buildRequestBody(provider, {
      messages: [],
      tool_choice: "auto"
    });
    expect(body.model).toBe("o4-mini");
    expect(body.reasoning_effort).toBe("high");
    expect(body.max_completion_tokens).toBe(16384);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("auto-detects o-series reasoning for unknown OpenAI models", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai",
      apiKey: "key",
      model: "o3-pro",
      reasoningEffort: "low",
      maxTokens: 4096
    });
    const body = __test__.buildRequestBody(provider, {
      messages: [],
      tool_choice: "auto"
    });
    expect(body.model).toBe("o3-pro");
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("uses max_completion_tokens and reasoning_effort for custom OpenAI models when thinking mode is enabled", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai",
      apiKey: "key",
      model: "gpt-5.5",
      thinkingMode: "enabled",
      reasoningEffort: "high",
      maxTokens: 8192
    });
    const body = __test__.buildRequestBody(provider, {
      messages: [],
      tool_choice: "auto"
    });
    expect(body.model).toBe("gpt-5.5");
    expect(body.reasoning_effort).toBe("high");
    expect(body.max_completion_tokens).toBe(8192);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
});
