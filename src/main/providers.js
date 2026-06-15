import { getModelCapability, normalizeConfigForCapabilities } from "../shared/providerCapabilities.js";

export function normalizeProviderConfig(config = {}) {
  const normalized = normalizeConfigForCapabilities(config);
  const { provider, capability } = getModelCapability(normalized);
  return {
    ...normalized,
    label: provider.label,
    baseUrl: trimTrailingSlash(config.baseUrl || process.env.AGENT_API_BASE_URL || provider.baseUrl),
    model: process.env.AGENT_MODEL || normalized.model,
    apiKey: config.apiKey || process.env.AGENT_API_KEY || process.env[provider.apiKeyEnv] || "",
    apiKeyEnv: provider.apiKeyEnv,
    balancePath: provider.balancePath,
    wireApi: provider.provider === "openai" ? "responses" : "chat-completions",
    capability
  };
}

export async function completeWithTools({ config, messages, tools, signal }) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${provider.apiKeyEnv || "AGENT_API_KEY"}。`);
  }

  const response = await postChatCompletion(
    provider,
    {
      messages,
      tools,
      tool_choice: "auto",
      stream: false
    },
    90000,
    signal
  );

  const choice = response?.choices?.[0];
  if (!choice?.message) {
    throw new Error("模型接口没有返回可用 message。");
  }

  return {
    message: choice.message,
    finishReason: choice.finish_reason ?? null,
    usage: response.usage ?? null,
    provider
  };
}

export async function completeChat({ config, messages, maxTokens, signal }) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${provider.apiKeyEnv || "AGENT_API_KEY"}。`);
  }

  const response = await postChatCompletion(
    provider,
    {
      messages,
      max_tokens: Math.max(1, Math.floor(Number(maxTokens) || Math.min(provider.maxTokens, 2048))),
      stream: false
    },
    120000,
    signal
  );

  const choice = response?.choices?.[0];
  if (!choice?.message) {
    throw new Error("模型接口没有返回可用 message。");
  }

  return {
    message: choice.message,
    finishReason: choice.finish_reason ?? null,
    usage: response.usage ?? null,
    provider
  };
}

export async function streamWithTools({ config, messages, tools, onDelta, signal }) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${provider.apiKeyEnv || "AGENT_API_KEY"}。`);
  }

  const response = await postChatCompletionStream(
    provider,
    {
      messages,
      tools,
      tool_choice: "auto",
      stream: true,
      stream_options: { include_usage: true }
    },
    onDelta,
    300000,
    signal
  );

  return {
    message: response.message,
    finishReason: response.finishReason,
    usage: response.usage,
    interrupted: Boolean(response.interrupted),
    streamError: response.streamError || "",
    provider
  };
}

export async function testProviderConnection(config = {}) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${provider.apiKeyEnv || "AGENT_API_KEY"}。`);
  }

  const startedAt = Date.now();
  const data = await postChatCompletion(
    provider,
    {
      messages: [
        { role: "system", content: "Reply with only OK." },
        { role: "user", content: "health check" }
      ],
      max_tokens: usesResponsesApi(provider) ? 512 : 16,
      tool_choice: "none",
      stream: false
    },
    30000
  );

  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    model: data.model ?? provider.model,
    content: data?.choices?.[0]?.message?.content ?? "",
    usage: data.usage ?? null
  };
}

export async function getProviderBalance(config = {}) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${provider.apiKeyEnv || "AGENT_API_KEY"}。`);
  }
  if (provider.provider !== "deepseek") {
    const hint = provider.provider === "openai"
      ? "OpenAI 不提供余额查询 API。请到 https://platform.openai.com/usage 查看用量和余额。"
      : "当前只支持查询 DeepSeek 官方 API 余额。OpenAI-compatible 供应商的余额接口不统一。";
    throw new Error(hint);
  }

  const { signal, cleanup, isExternallyAborted } = createRequestSignal(30000);
  try {
    const balanceBaseUrl = provider.baseUrl.replace(/\/v1$/i, "");
    const response = await fetchWithRetry(`${balanceBaseUrl}${provider.balancePath || "/user/balance"}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`
      },
      signal
    }, { retries: 2 });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`余额接口返回了非 JSON 内容：${text.slice(0, 500)}`);
    }
    if (!response.ok) {
      const message = data?.error?.message || data?.message || text || response.statusText;
      throw new Error(`余额接口请求失败 ${response.status}: ${message}`);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      if (isExternallyAborted()) throw new Error("请求已取消。");
      throw new Error("余额接口请求超时（30 秒）。请检查 API key、网络或 Base URL。");
    }
    throw error;
  } finally {
    cleanup();
  }
}

async function postChatCompletion(provider, bodyOverrides, timeoutMs = 90000, signal) {
  const { signal: requestSignal, cleanup, isExternallyAborted } = createRequestSignal(timeoutMs, signal);
  const useResponses = usesResponsesApi(provider);
  const body = useResponses
    ? buildResponsesRequestBody(provider, bodyOverrides)
    : buildRequestBody(provider, bodyOverrides);
  const url = useResponses ? getResponsesUrl(provider) : `${provider.baseUrl}/chat/completions`;

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: requestSignal
    }, { retries: 2 });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`模型接口返回了非 JSON 内容：${text.slice(0, 500)}`);
    }

    if (!response.ok) {
      const message = data?.error?.message || data?.message || text || response.statusText;
      throw new Error(`模型接口请求失败 ${response.status}: ${message}`);
    }

    return useResponses ? normalizeResponsesDataToChatCompletion(provider, data) : data;
  } catch (error) {
    if (error?.name === "AbortError") {
      if (isExternallyAborted()) throw new Error("请求已取消。");
      throw new Error(`模型接口请求超时（${Math.round(timeoutMs / 1000)} 秒）。请检查 API key、余额、网络或 Base URL。`);
    }
    throw error;
  } finally {
    cleanup();
  }
}

async function postChatCompletionStream(provider, bodyOverrides, onDelta, timeoutMs = 120000, signal) {
  const { signal: requestSignal, cleanup, isExternallyAborted, resetTimeout } = createRequestSignal(timeoutMs, signal);
  const useResponses = usesResponsesApi(provider);
  const body = useResponses
    ? buildResponsesRequestBody(provider, bodyOverrides)
    : buildRequestBody(provider, bodyOverrides);
  const url = useResponses ? getResponsesUrl(provider) : `${provider.baseUrl}/chat/completions`;
  const partial = createEmptyStreamResult();

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: requestSignal
    }, { retries: 1, retryMethods: new Set(["POST"]) });

    if (!response.ok) {
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      const message = data?.error?.message || data?.message || text || response.statusText;
      throw new Error(`模型接口请求失败 ${response.status}: ${message}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("模型接口没有返回可读取的流。");

    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetTimeout();
      partial.buffer += decoder.decode(value, { stream: true });

      const lines = partial.buffer.split(/\r?\n/);
      partial.buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (useResponses) {
          consumeResponsesStreamLine(line, partial, onDelta);
        } else {
          consumeStreamLine(line, partial, onDelta);
        }
      }
    }

    partial.buffer += decoder.decode();
    const finalLines = partial.buffer.split(/\r?\n/);
    partial.buffer = "";
    for (const line of finalLines) {
      if (useResponses) {
        consumeResponsesStreamLine(line, partial, onDelta);
      } else {
        consumeStreamLine(line, partial, onDelta);
      }
    }

    return buildStreamResponse(partial);
  } catch (error) {
    if (hasPartialStreamContent(partial) && !isExternallyAborted()) {
      return buildStreamResponse(partial, {
        interrupted: true,
        streamError: error instanceof Error ? error.message : String(error)
      });
    }
    if (error?.name === "AbortError") {
      if (isExternallyAborted()) throw new Error("请求已取消。");
      throw new Error(`模型接口请求超时（${Math.round(timeoutMs / 1000)} 秒）。请检查 API key、余额、网络或 Base URL。`);
    }
    throw error;
  } finally {
    cleanup();
  }
}

function createEmptyStreamResult() {
  return {
    buffer: "",
    content: "",
    reasoningContent: "",
    finishReason: null,
    usage: null,
    toolCalls: [],
    responseId: "",
    responseOutput: [],
    responseOutputByIndex: {}
  };
}

function consumeStreamLine(line, partial, onDelta) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return;

  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return;
  }

  if (data.usage) partial.usage = data.usage;
  const choice = data.choices?.[0];
  if (!choice) return;
  if (choice.finish_reason) partial.finishReason = choice.finish_reason;

  const delta = choice.delta ?? {};
  if (delta.content) {
    partial.content += delta.content;
    onDelta?.({ type: "content", text: delta.content });
  }
  const reasoningText = delta.reasoning_content || delta.reasoning || "";
  if (reasoningText) {
    partial.reasoningContent += reasoningText;
    onDelta?.({ type: "reasoning", text: reasoningText });
  }
  if (delta.tool_calls) {
    for (const toolDelta of delta.tool_calls) {
      if (toolDelta.function?.arguments) {
        onDelta?.({
          type: "tool_call_delta",
          name: toolDelta.function?.name || "",
          text: toolDelta.function.arguments
        });
      }
    }
    mergeToolCallDeltas(partial.toolCalls, delta.tool_calls);
  }
}

function buildStreamResponse(partial, options = {}) {
  const interrupted = Boolean(options.interrupted);
  const toolCalls = compactToolCalls(partial.toolCalls);
  return {
    message: {
      role: "assistant",
      content: partial.content,
      reasoning_content: partial.reasoningContent || undefined,
      tool_calls: !interrupted && toolCalls.length > 0 ? toolCalls : undefined,
      response_id: partial.responseId || undefined,
      response_output: !interrupted && partial.responseOutput?.length > 0 ? partial.responseOutput : undefined
    },
    finishReason: interrupted ? "stream_interrupted" : partial.finishReason,
    usage: partial.usage,
    interrupted,
    streamError: options.streamError || ""
  };
}

function hasPartialStreamContent(partial) {
  return Boolean(
    partial.content ||
    partial.reasoningContent ||
    partial.toolCalls.length > 0 ||
    partial.buffer.trim()
  );
}

function createRequestSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromExternal = () => controller.abort();

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  return {
    signal: controller.signal,
    isExternallyAborted: () => !timedOut && Boolean(externalSignal?.aborted),
    resetTimeout: () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    },
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const retries = Math.max(0, Number(retryOptions.retries) || 0);
  const retryMethods = retryOptions.retryMethods ?? new Set(["GET", "HEAD", "OPTIONS", "POST"]);
  const method = String(options.method || "GET").toUpperCase();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!shouldRetryResponse(response, method, retryMethods) || attempt === retries) return response;
      await response.body?.cancel?.().catch?.(() => {});
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      if (!shouldRetryError(error) || attempt === retries) throw error;
    }

    await sleep(backoffDelay(attempt));
  }

  throw lastError || new Error("fetch failed");
}

function shouldRetryResponse(response, method, retryMethods) {
  return retryMethods.has(method) && [408, 425, 429, 500, 502, 503, 504].includes(response.status);
}

function shouldRetryError(error) {
  return error?.name !== "AbortError";
}

function backoffDelay(attempt) {
  const base = 350 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 160);
  return base + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usesResponsesApi(provider) {
  return provider.provider === "openai" || provider.wireApi === "responses";
}

function getResponsesUrl(provider) {
  return `${ensureOpenAiVersionBaseUrl(provider.baseUrl)}/responses`;
}

function ensureOpenAiVersionBaseUrl(baseUrl) {
  const base = trimTrailingSlash(baseUrl)
    .replace(/\/responses$/i, "")
    .replace(/\/chat\/completions$/i, "");
  if (/\/v\d+(?:\.\d+)?$/i.test(base)) return base;
  return `${base}/v1`;
}

function buildResponsesRequestBody(provider, bodyOverrides = {}) {
  const maxOutputTokens = bodyOverrides.max_completion_tokens ?? bodyOverrides.max_tokens ?? provider.maxTokens;
  const body = {
    model: provider.model,
    input: chatMessagesToResponsesInput(bodyOverrides.messages || []),
    max_output_tokens: maxOutputTokens,
    store: false
  };

  if (bodyOverrides.stream) {
    body.stream = true;
  }

  if (bodyOverrides.tools && provider.capability?.supportsToolCalls) {
    body.tools = convertToolsForResponses(bodyOverrides.tools);
    if (bodyOverrides.tool_choice) {
      body.tool_choice = bodyOverrides.tool_choice;
    }
  }

  if (provider.capability?.supportsThinking && provider.thinkingMode === "enabled") {
    body.reasoning = {
      effort: mapReasoningEffortForResponses(provider.reasoningEffort)
    };
    body.include = ["reasoning.encrypted_content"];
  } else if (provider.capability?.supportsTemperature) {
    body.temperature = provider.temperature;
  }

  return body;
}

function chatMessagesToResponsesInput(messages) {
  const input = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = message.role;

    if (role === "tool") {
      const callId = String(message.tool_call_id || "").trim();
      if (!callId) continue;
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: String(message.content ?? "")
      });
      continue;
    }

    if (role === "assistant") {
      if (Array.isArray(message.response_output) && message.response_output.length > 0) {
        input.push(...message.response_output);
        continue;
      }

      const content = normalizeResponsesMessageContent(role, message.content);
      if (hasResponsesContent(content)) {
        input.push({ role: "assistant", content });
      }

      for (const toolCall of normalizeToolCallsForResponsesInput(message.tool_calls)) {
        input.push(toolCall);
      }
      continue;
    }

    if (role === "system" || role === "user") {
      const content = normalizeResponsesMessageContent(role, message.content);
      if (hasResponsesContent(content)) {
        input.push({ role, content });
      }
    }
  }

  return input;
}

function normalizeResponsesMessageContent(role, content) {
  if (!Array.isArray(content)) return String(content ?? "");

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return null;
      if (part.type === "text") {
        return {
          type: role === "assistant" ? "output_text" : "input_text",
          text: String(part.text ?? "")
        };
      }
      if (part.type === "image_url") {
        const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
        if (!imageUrl) return null;
        return {
          type: "input_image",
          image_url: imageUrl
        };
      }
      return part;
    })
    .filter(Boolean);
}

function hasResponsesContent(content) {
  return Array.isArray(content) ? content.length > 0 : String(content || "").trim().length > 0;
}

function normalizeToolCallsForResponsesInput(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((toolCall) => {
      const callId = String(toolCall?.id || "").trim();
      const fn = toolCall?.function || {};
      const name = String(fn.name || "").trim();
      if (!callId || !name) return null;
      return {
        type: "function_call",
        call_id: callId,
        name,
        arguments: String(fn.arguments ?? ""),
        status: "completed"
      };
    })
    .filter(Boolean);
}

function convertToolsForResponses(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      if (tool?.type === "function" && tool.function) {
        return {
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        };
      }
      return tool;
    })
    .filter(Boolean);
}

function mapReasoningEffortForResponses(reasoningEffort) {
  if (reasoningEffort === "max") return "xhigh";
  return reasoningEffort || "medium";
}

function normalizeResponsesDataToChatCompletion(provider, data) {
  const message = responseDataToChatMessage(data);
  return {
    id: data.id,
    model: data.model ?? provider.model,
    choices: [
      {
        message,
        finish_reason: responseFinishReason(data)
      }
    ],
    usage: normalizeResponsesUsage(data.usage),
    response: data
  };
}

function compactToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.filter((toolCall) => toolCall?.id && toolCall?.function?.name);
}

function responseDataToChatMessage(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  const toolCalls = extractResponsesToolCalls(data);
  return {
    role: "assistant",
    content: extractResponsesOutputText(data),
    reasoning_content: extractResponsesReasoningText(output) || undefined,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    response_id: data?.id || undefined,
    response_output: output.length > 0 ? output : undefined
  };
}

function extractResponsesOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const output = Array.isArray(data?.output) ? data.output : [];
  let text = "";

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message") {
      text += extractResponsesContentText(item.content);
    } else if (item.type === "output_text" || item.type === "text") {
      text += String(item.text ?? "");
    }
  }

  return text;
}

function extractResponsesContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "output_text" || part.type === "text" || part.type === "input_text") {
      text += String(part.text ?? "");
    } else if (part.type === "refusal") {
      text += String(part.refusal ?? "");
    }
  }

  return text;
}

function extractResponsesToolCalls(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  return output
    .map((item) => {
      if (item?.type !== "function_call") return null;
      const callId = String(item.call_id || item.id || "").trim();
      const name = String(item.name || "").trim();
      if (!callId || !name) return null;
      return {
        id: callId,
        type: "function",
        function: {
          name,
          arguments: String(item.arguments ?? "")
        }
      };
    })
    .filter(Boolean);
}

function extractResponsesReasoningText(output) {
  let text = "";
  for (const item of output) {
    if (item?.type !== "reasoning" || !Array.isArray(item.summary)) continue;
    for (const summary of item.summary) {
      const summaryText = summary?.text ?? summary?.summary_text;
      if (summaryText) text += `${summaryText}\n`;
    }
  }
  return text.trim();
}

function responseFinishReason(data) {
  if (data?.status === "incomplete") {
    return data?.incomplete_details?.reason || "incomplete";
  }
  return data?.status || null;
}

function normalizeResponsesUsage(usage) {
  if (!usage || typeof usage !== "object") return usage ?? null;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens;
  return {
    ...usage,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.total_tokens ?? ((Number(promptTokens) || 0) + (Number(completionTokens) || 0))
  };
}

function consumeResponsesStreamLine(line, partial, onDelta) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return;

  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return;
  }

  if (data.type === "error") {
    const message = data?.error?.message || data?.message || "Responses stream error";
    throw new Error(message);
  }

  if (data.response_id && !partial.responseId) partial.responseId = data.response_id;

  if (data.type === "response.output_text.delta" && data.delta) {
    partial.content += data.delta;
    onDelta?.({ type: "content", text: data.delta });
    return;
  }

  if (data.type === "response.output_text.done" && data.text && !partial.content) {
    partial.content = data.text;
    onDelta?.({ type: "content", text: data.text });
    return;
  }

  if (data.type === "response.reasoning_summary_text.delta" && data.delta) {
    partial.reasoningContent += data.delta;
    onDelta?.({ type: "reasoning", text: data.delta });
    return;
  }

  if (data.type === "response.output_item.added" && data.item) {
    const index = Number.isFinite(data.output_index) ? data.output_index : partial.responseOutput.length;
    partial.responseOutputByIndex[index] = data.item;
    syncResponsesOutput(partial);
    if (data.item.type === "function_call") {
      upsertResponsesToolCall(partial, index, {
        id: data.item.call_id || data.item.id || "",
        name: data.item.name || "",
        arguments: data.item.arguments || ""
      });
    }
    return;
  }

  if (data.type === "response.function_call_arguments.delta") {
    const index = Number.isFinite(data.output_index) ? data.output_index : partial.toolCalls.length;
    const item = partial.responseOutputByIndex[index];
    if (item?.type === "function_call") {
      item.arguments = `${item.arguments || ""}${data.delta || ""}`;
      syncResponsesOutput(partial);
    }
    upsertResponsesToolCall(partial, index, {
      arguments: data.delta || ""
    });
    if (data.delta) {
      onDelta?.({
        type: "tool_call_delta",
        name: partial.toolCalls[index]?.function?.name || "",
        text: data.delta
      });
    }
    return;
  }

  if (data.type === "response.function_call_arguments.done") {
    const index = Number.isFinite(data.output_index) ? data.output_index : partial.toolCalls.length;
    const item = partial.responseOutputByIndex[index];
    if (item?.type === "function_call" && typeof data.arguments === "string") {
      item.arguments = data.arguments;
      syncResponsesOutput(partial);
      setResponsesToolCallArguments(partial, index, data.arguments);
    }
    return;
  }

  if (data.type === "response.output_item.done" && data.item) {
    const index = Number.isFinite(data.output_index) ? data.output_index : partial.responseOutput.length;
    partial.responseOutputByIndex[index] = data.item;
    syncResponsesOutput(partial);
    if (data.item.type === "function_call") {
      upsertResponsesToolCall(partial, index, {
        id: data.item.call_id || data.item.id || "",
        name: data.item.name || "",
        arguments: ""
      });
      setResponsesToolCallArguments(partial, index, String(data.item.arguments ?? ""));
    } else if (data.item.type === "message" && !partial.content) {
      const text = extractResponsesContentText(data.item.content);
      if (text) {
        partial.content = text;
        onDelta?.({ type: "content", text });
      }
    }
    return;
  }

  if (data.type === "response.completed" && data.response) {
    applyCompletedResponsesData(partial, data.response);
  }
}

function upsertResponsesToolCall(partial, index, delta) {
  if (!partial.toolCalls[index]) {
    partial.toolCalls[index] = {
      id: delta.id || "",
      type: "function",
      function: { name: delta.name || "", arguments: "" }
    };
  }

  const target = partial.toolCalls[index];
  if (delta.id) target.id = delta.id;
  if (delta.name) target.function.name = delta.name;
  if (delta.arguments) target.function.arguments += delta.arguments;
}

function setResponsesToolCallArguments(partial, index, argumentsText) {
  if (!partial.toolCalls[index]) return;
  partial.toolCalls[index].function.arguments = argumentsText;
}

function syncResponsesOutput(partial) {
  partial.responseOutput = Object.keys(partial.responseOutputByIndex)
    .map((key) => [Number(key), partial.responseOutputByIndex[key]])
    .sort(([left], [right]) => left - right)
    .map(([, item]) => item);
}

function applyCompletedResponsesData(partial, response) {
  partial.responseId = response.id || partial.responseId;
  partial.finishReason = responseFinishReason(response);
  partial.usage = normalizeResponsesUsage(response.usage);
  partial.content = extractResponsesOutputText(response);
  partial.reasoningContent = extractResponsesReasoningText(Array.isArray(response.output) ? response.output : []);
  partial.toolCalls = extractResponsesToolCalls(response);
  partial.responseOutput = Array.isArray(response.output) ? response.output : partial.responseOutput;
  partial.responseOutputByIndex = {};
  partial.responseOutput.forEach((item, index) => {
    partial.responseOutputByIndex[index] = item;
  });
}

function buildRequestBody(provider, bodyOverrides) {
  const body = {
    model: provider.model,
    temperature: provider.temperature,
    max_tokens: provider.maxTokens,
    ...bodyOverrides
  };

  if (!provider.capability?.supportsToolCalls) {
    delete body.tools;
    delete body.tool_choice;
  }

  if (!provider.capability?.supportsTemperature) {
    delete body.temperature;
  }

  if (provider.provider === "deepseek") {
    if (provider.capability?.supportsThinking) {
      body.thinking = { type: provider.thinkingMode };
      body.reasoning_effort = provider.reasoningEffort;
    }
    if (provider.thinkingMode === "enabled") {
      delete body.tool_choice;
    }
  }

  const isOpenAiReasoning = (provider.provider === "openai" || provider.provider === "openai-compatible") &&
    provider.capability?.supportsThinking && (
      (provider.model && /^o[1-9]/i.test(provider.model)) ||
      provider.thinkingMode === "enabled"
    );

  if (isOpenAiReasoning) {
    body.reasoning_effort = provider.reasoningEffort;
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    delete body.temperature;
  }

  return body;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function mergeToolCallDeltas(toolCalls, deltas) {
  for (const delta of deltas) {
    const index = Number.isFinite(delta.index) ? delta.index : toolCalls.length;
    if (!toolCalls[index]) {
      toolCalls[index] = {
        id: delta.id ?? "",
        type: delta.type ?? "function",
        function: { name: "", arguments: "" }
      };
    }

    const target = toolCalls[index];
    if (delta.id) target.id = delta.id;
    if (delta.type) target.type = delta.type;
    if (delta.function?.name) target.function.name += delta.function.name;
    if (delta.function?.arguments) target.function.arguments += delta.function.arguments;
  }
}

export const __test__ = {
  buildRequestBody,
  buildResponsesRequestBody,
  chatMessagesToResponsesInput,
  convertToolsForResponses,
  ensureOpenAiVersionBaseUrl,
  normalizeResponsesDataToChatCompletion,
  normalizeProviderConfig,
  trimTrailingSlash
};
