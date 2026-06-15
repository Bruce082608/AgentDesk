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
    expect(provider.wireApi).toBe("chat-completions");
  });

  it("keeps imported Responses wire API for OpenAI-compatible gateways", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai-compatible",
      apiKey: "key",
      baseUrl: "https://bmapi.020212.xyz",
      model: "gpt-5.5",
      wireApi: "responses",
      thinkingMode: "enabled",
      reasoningEffort: "max"
    });
    expect(provider.wireApi).toBe("responses");
    expect(provider.baseUrl).toBe("https://bmapi.020212.xyz");
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

  it("passes through chat-completions-shaped data returned by Responses gateways", () => {
    const provider = __test__.normalizeProviderConfig({
      provider: "openai",
      apiKey: "key"
    });
    const data = {
      id: "chatcmpl_1",
      model: "gpt-5.5",
      choices: [
        {
          message: { role: "assistant", content: "OK" },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
    };

    expect(__test__.normalizeResponsesDataToChatCompletion(provider, data)).toBe(data);
  });

  it("parses chat-completions-shaped stream chunks while in Responses mode", () => {
    const partial = __test__.createEmptyStreamResult();
    const deltas = [];

    __test__.consumeResponsesStreamLine(
      'data: {"choices":[{"delta":{"content":"O"},"finish_reason":null}]}',
      partial,
      (delta) => deltas.push(delta)
    );
    __test__.consumeResponsesStreamLine(
      'data: {"choices":[{"delta":{"content":"K"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
      partial,
      (delta) => deltas.push(delta)
    );

    const response = __test__.buildStreamResponse(partial);
    expect(response.message.content).toBe("OK");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.total_tokens).toBe(4);
    expect(deltas).toEqual([
      { type: "content", text: "O" },
      { type: "content", text: "K" }
    ]);
  });

  it("parses non-SSE chat JSON returned to a streaming request", () => {
    const partial = __test__.createEmptyStreamResult();
    const deltas = [];

    __test__.consumeStreamLine(
      '{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
      partial,
      (delta) => deltas.push(delta)
    );

    const response = __test__.buildStreamResponse(partial);
    expect(response.message.content).toBe("OK");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.total_tokens).toBe(4);
    expect(deltas).toEqual([{ type: "content", text: "OK" }]);
  });

  it("parses non-SSE Responses JSON returned to a streaming request", () => {
    const partial = __test__.createEmptyStreamResult();

    __test__.consumeResponsesStreamLine(
      '{"id":"resp_1","status":"completed","output_text":"OK","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}',
      partial
    );

    const response = __test__.buildStreamResponse(partial);
    expect(response.message.content).toBe("OK");
    expect(response.finishReason).toBe("completed");
    expect(response.usage.total_tokens).toBe(4);
  });

  it("falls back to parsing pretty-printed raw chat JSON", () => {
    const partial = __test__.createEmptyStreamResult();
    partial.rawText = JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: "OK" },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
    }, null, 2);

    __test__.applyRawStreamFallback(partial, false);

    const response = __test__.buildStreamResponse(partial);
    expect(response.message.content).toBe("OK");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.total_tokens).toBe(4);
  });

  it("falls back to parsing complete raw Responses JSON", () => {
    const partial = __test__.createEmptyStreamResult();
    partial.rawText = JSON.stringify({
      id: "resp_1",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "OK" }]
        }
      ],
      usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 }
    }, null, 2);

    __test__.applyRawStreamFallback(partial, true);

    const response = __test__.buildStreamResponse(partial);
    expect(response.message.content).toBe("OK");
    expect(response.finishReason).toBe("completed");
    expect(response.usage.total_tokens).toBe(4);
  });

  it("raises 200-status error payloads returned in stream bodies", () => {
    const partial = __test__.createEmptyStreamResult();
    partial.rawText = JSON.stringify({
      error: { message: "invalid model" }
    });

    expect(() => __test__.applyRawStreamFallback(partial, true)).toThrow("invalid model");
  });

  it("raises response.failed stream events with the provider error code", () => {
    const partial = __test__.createEmptyStreamResult();

    expect(() => __test__.consumeResponsesStreamLine(
      'data: {"type":"response.failed","response":{"status":"failed","output":[],"error":{"code":"rate_limit_exceeded","message":"Concurrency limit exceeded for account, please retry later"}}}',
      partial
    )).toThrow("rate_limit_exceeded: Concurrency limit exceeded for account, please retry later");
  });

  it("raises response.failed events from raw SSE fallback", () => {
    const partial = __test__.createEmptyStreamResult();
    partial.rawText = [
      ":",
      ":",
      "event: response.failed",
      'data: {"type":"response.failed","response":{"status":"failed","output":[],"error":{"code":"rate_limit_exceeded","message":"Concurrency limit exceeded for account, please retry later"}}}',
      ""
    ].join("\n");

    expect(() => __test__.applyRawStreamFallback(partial, true)).toThrow("rate_limit_exceeded: Concurrency limit exceeded for account, please retry later");
  });
});
