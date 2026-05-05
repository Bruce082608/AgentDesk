const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKeyEnv: "DEEPSEEK_API_KEY"
  },
  "openai-compatible": {
    label: "OpenAI-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKeyEnv: "OPENAI_API_KEY"
  }
};

export function normalizeProviderConfig(config = {}) {
  const preset = PROVIDERS[config.provider] ?? PROVIDERS.deepseek;
  return {
    provider: config.provider ?? "deepseek",
    label: preset.label,
    baseUrl: trimTrailingSlash(config.baseUrl || process.env.AGENT_API_BASE_URL || preset.baseUrl),
    model: config.model || process.env.AGENT_MODEL || preset.model,
    apiKey: config.apiKey || process.env.AGENT_API_KEY || process.env[preset.apiKeyEnv] || "",
    temperature: numeric(config.temperature, 0.2),
    maxTokens: Math.max(1, Math.floor(numeric(config.maxTokens, 32768))),
    contextTokens: Math.max(4096, Math.floor(numeric(config.contextTokens, 1000000))),
    thinkingMode: config.thinkingMode === "disabled" ? "disabled" : "enabled",
    reasoningEffort: ["low", "medium", "high", "max"].includes(config.reasoningEffort) ? config.reasoningEffort : "max"
  };
}

export async function completeWithTools({ config, messages, tools, signal }) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${PROVIDERS[provider.provider]?.apiKeyEnv ?? "AGENT_API_KEY"}。`);
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

export async function streamWithTools({ config, messages, tools, onDelta, signal }) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${PROVIDERS[provider.provider]?.apiKeyEnv ?? "AGENT_API_KEY"}。`);
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
    120000,
    signal
  );

  return {
    message: response.message,
    finishReason: response.finishReason,
    usage: response.usage,
    provider
  };
}

export async function testProviderConnection(config = {}) {
  const provider = normalizeProviderConfig(config);
  if (!provider.apiKey) {
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${PROVIDERS[provider.provider]?.apiKeyEnv ?? "AGENT_API_KEY"}。`);
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
    throw new Error(`缺少 API key。请在界面中填写，或设置 ${PROVIDERS[provider.provider]?.apiKeyEnv ?? "AGENT_API_KEY"}。`);
  }
  if (provider.provider !== "deepseek") {
    throw new Error("当前只支持查询 DeepSeek 官方 API 余额。OpenAI-compatible 供应商的余额接口不统一。");
  }

  const { signal, cleanup, isExternallyAborted } = createRequestSignal(30000);
  try {
    const balanceBaseUrl = provider.baseUrl.replace(/\/v1$/i, "");
    const response = await fetch(`${balanceBaseUrl}/user/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`
      },
      signal
    });
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
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: requestSignal
    });

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
  const { signal: requestSignal, cleanup, isExternallyAborted } = createRequestSignal(timeoutMs, signal);
  const body = buildRequestBody(provider, bodyOverrides);

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: requestSignal
    });

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
    let buffer = "";
    let content = "";
    let reasoningContent = "";
    let finishReason = null;
    let usage = null;
    const toolCalls = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }

        if (data.usage) usage = data.usage;
        const choice = data.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta ?? {};
        if (delta.content) {
          content += delta.content;
          onDelta?.({ type: "content", text: delta.content });
        }
        if (delta.reasoning_content) {
          reasoningContent += delta.reasoning_content;
          onDelta?.({ type: "reasoning", text: delta.reasoning_content });
        }
        if (delta.tool_calls) {
          mergeToolCallDeltas(toolCalls, delta.tool_calls);
        }
      }
    }

    return {
      message: {
        role: "assistant",
        content,
        reasoning_content: reasoningContent || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      },
      finishReason,
      usage
    };
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

function createRequestSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
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
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

function buildRequestBody(provider, bodyOverrides) {
  const body = {
    model: provider.model,
    temperature: provider.temperature,
    max_tokens: provider.maxTokens,
    ...bodyOverrides
  };

  if (provider.provider === "deepseek") {
    body.thinking = { type: provider.thinkingMode };
    body.reasoning_effort = provider.reasoningEffort;
    if (provider.thinkingMode === "enabled") {
      delete body.temperature;
      delete body.tool_choice;
    }
  }

  return body;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function numeric(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
