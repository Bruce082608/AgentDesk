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

  it("builds a Responses API body for OpenAI provider", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai",
      apiKey: "key",
      baseUrl: "https://bmapi.020212.xyz",
      model: "gpt-5.5",
      thinkingMode: "enabled",
      reasoningEffort: "max",
      maxTokens: 32768
    });
    const body = __test__.buildResponsesRequestBody(provider, {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } }
          }
        }
      ],
      stream: true,
      tool_choice: "auto"
    });
    expect(body.model).toBe("gpt-5.5");
    expect(body.input).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" }
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } }
      }
    ]);
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(32768);
    expect(body.reasoning).toEqual({ effort: "xhigh" });
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.tool_choice).toBe("auto");
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("adds /v1 for OpenAI Responses base URLs that omit it", () => {
    expect(__test__.ensureOpenAiVersionBaseUrl("https://bmapi.020212.xyz")).toBe("https://bmapi.020212.xyz/v1");
    expect(__test__.ensureOpenAiVersionBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
    expect(__test__.ensureOpenAiVersionBaseUrl("https://bmapi.020212.xyz/v1/responses")).toBe("https://bmapi.020212.xyz/v1");
    expect(__test__.ensureOpenAiVersionBaseUrl("https://bmapi.020212.xyz/v1/chat/completions")).toBe("https://bmapi.020212.xyz/v1");
  });

  it("converts chat tool history into Responses input items", () => {
    const input = __test__.chatMessagesToResponsesInput([
      {
        role: "assistant",
        content: "I will inspect it.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" }
          }
        ]
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "read_file",
        content: "README content"
      }
    ]);
    expect(input).toEqual([
      { role: "assistant", content: "I will inspect it." },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read_file",
        arguments: "{\"path\":\"README.md\"}",
        status: "completed"
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "README content"
      }
    ]);
  });

  it("normalizes Responses output into a chat-completions-like shape", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai",
      apiKey: "key"
    });
    const data = __test__.normalizeResponsesDataToChatCompletion(provider, {
      id: "resp_1",
      model: "gpt-5.5",
      status: "completed",
      output_text: "Done",
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "read_file",
          arguments: "{\"path\":\"README.md\"}"
        }
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    });
    expect(data.choices[0].message.content).toBe("Done");
    expect(data.choices[0].message.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" }
      }
    ]);
    expect(data.usage.prompt_tokens).toBe(10);
    expect(data.usage.completion_tokens).toBe(5);
  });
});
