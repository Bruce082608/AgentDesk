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
      max_tokens: 16,
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
  const body = buildRequestBody(provider, bodyOverrides);

  try {
    const response = await fetchWithRetry(`${provider.baseUrl}/chat/completions`, {
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

    return data;
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
  const body = buildRequestBody(provider, bodyOverrides);
  const partial = createEmptyStreamResult();

  try {
    const response = await fetchWithRetry(`${provider.baseUrl}/chat/completions`, {
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
    toolCalls: []
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
  return {
    message: {
      role: "assistant",
      content: partial.content,
      reasoning_content: partial.reasoningContent || undefined,
      tool_calls: !interrupted && partial.toolCalls.length > 0 ? partial.toolCalls : undefined
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

  if (provider.provider === "openai" && provider.capability?.supportsThinking) {
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
  normalizeProviderConfig,
  trimTrailingSlash
};
