import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translations } from "../i18n";
import type { EventLogItem, ProviderBalanceResult, ProviderConfig, ProviderTestFeedback } from "../types";
import { defaultConfig } from "../types";
import { getModelCapability, normalizeConfigForCapabilities } from "../../shared/providerCapabilities";

type Translation = typeof translations[keyof typeof translations];

type UseProviderConfigParams = {
  appendEvent: (kind: EventLogItem["kind"], title: string, body: string) => void;
  busy: boolean;
  setIsOnline: (online: boolean) => void;
  t: Translation;
};

export function useProviderConfig({ appendEvent, busy, setIsOnline, t }: UseProviderConfigParams) {
  const [config, setConfigState] = useState<ProviderConfig>(() => normalizeProviderConfig(defaultConfig));
  const [testingApi, setTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<ProviderTestFeedback | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [balanceResult, setBalanceResult] = useState<ProviderBalanceResult | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    window.agentWindow.loadConfig().then(({ config: fileConfig, path }) => {
      const legacyKey = localStorage.getItem("agent-api-key") || "";
      if (legacyKey) localStorage.removeItem("agent-api-key");
      setConfigState(normalizeProviderConfig({ ...defaultConfig, ...fileConfig, apiKey: legacyKey || fileConfig.apiKey || "" }));
      setConfigPath(path);
      setConfigLoaded(true);
      if ("recoveredFromError" in fileConfig && fileConfig.recoveredFromError) {
        appendEvent("status", "配置已恢复", `配置文件损坏，已恢复默认值：${String(fileConfig.recoveredFromError)}`);
      }
    }).catch((error) => {
      appendEvent("error", "配置读取失败", error instanceof Error ? error.message : String(error));
      setConfigLoaded(true);
    });
  }, [appendEvent]);

  useEffect(() => {
    if (!configLoaded) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      window.agentWindow.saveConfig(config).catch((error) => {
        appendEvent("error", "配置保存失败", error instanceof Error ? error.message : String(error));
      });
    }, 500);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [appendEvent, config, configLoaded]);

  const providerHint = useMemo(() => {
    if (config.provider === "deepseek") {
      return `${t.providerHintDeepSeek} ${config.capability?.label || config.model}: ${config.contextTokens.toLocaleString("en-US")} context / ${config.capability?.maxOutputTokens.toLocaleString("en-US")} max output.`;
    }
    if (config.provider === "openai") {
      return `OpenAI ${config.capability?.label || config.model}: ${config.contextTokens.toLocaleString("en-US")} context / ${config.capability?.maxOutputTokens.toLocaleString("en-US")} max output.`;
    }
    return t.providerHintCompatible;
  }, [config.capability, config.contextTokens, config.model, config.provider, t]);

  const updateProvider = useCallback((provider: ProviderConfig["provider"]) => {
    const nextDefaults =
      provider === "deepseek"
        ? { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", summaryModel: "deepseek-v4-flash", wireApi: "chat-completions" as const, thinkingMode: "enabled" as const, reasoningEffort: "max" as const, contextTokens: 1000000, maxTokens: 32768 }
        : provider === "openai"
          ? { baseUrl: "https://bmapi.020212.xyz", model: "gpt-5.5", summaryModel: "", wireApi: "responses" as const, thinkingMode: "enabled" as const, reasoningEffort: "max" as const, contextTokens: 1000000, maxTokens: 32768 }
          : { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", summaryModel: "", wireApi: "chat-completions" as const, thinkingMode: "disabled" as const, reasoningEffort: "medium" as const, contextTokens: 128000, maxTokens: 4096 };
    setConfigState((current) => normalizeProviderConfig({ ...current, provider, ...nextDefaults }));
  }, []);

  const setConfig = useCallback((nextConfig: ProviderConfig) => {
    setConfigState(normalizeProviderConfig(nextConfig));
  }, []);

  const testApi = useCallback(async () => {
    if (testingApi || busy) return;
    if (!navigator.onLine) {
      setIsOnline(false);
      appendEvent("error", t.offlineTitle, t.offlineBody);
      setApiTestResult({
        status: "error",
        checkedAt: Date.now(),
        provider: config.provider,
        model: config.model,
        error: t.offlineBody
      });
      return;
    }
    setTestingApi(true);
    setApiTestResult({
      status: "running",
      checkedAt: Date.now(),
      provider: config.provider,
      model: config.model
    });
    appendEvent("status", "API 检测", "正在发送最小 health check 请求...");
    try {
      const result = await window.agentWindow.testProvider(config);
      if (result.ok) {
        setApiTestResult({
          status: "success",
          checkedAt: Date.now(),
          provider: config.provider,
          model: result.result.model,
          latencyMs: result.result.latencyMs,
          reply: result.result.content,
          usage: result.result.usage
        });
        appendEvent(
          "status",
          "API 可用",
          JSON.stringify(
            {
              model: result.result.model,
              latency_ms: result.result.latencyMs,
              reply: result.result.content,
              usage: result.result.usage
            },
            null,
            2
          )
        );
      } else {
        setApiTestResult({
          status: "error",
          checkedAt: Date.now(),
          provider: config.provider,
          model: config.model,
          error: result.error
        });
        appendEvent("error", "API 不可用", result.error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApiTestResult({
        status: "error",
        checkedAt: Date.now(),
        provider: config.provider,
        model: config.model,
        error: message
      });
      appendEvent("error", "API 检测失败", message);
    } finally {
      setTestingApi(false);
    }
  }, [appendEvent, busy, config, setIsOnline, t, testingApi]);

  const queryBalance = useCallback(async (silent = false) => {
    if (checkingBalance || (!silent && busy)) return;
    if (!navigator.onLine) {
      if (!silent) {
        setIsOnline(false);
        appendEvent("error", t.offlineTitle, t.offlineBody);
      }
      return;
    }
    setCheckingBalance(true);
    if (!silent) {
      setBalanceResult(null);
      appendEvent("status", "API 余额查询", "正在请求 DeepSeek 官方余额接口...");
    }
    try {
      const result = await window.agentWindow.getBalance(config);
      if (result.ok) {
        setBalanceResult(result.result);
        if (!silent) {
          appendEvent("status", "API 余额查询成功", JSON.stringify(result.result, null, 2));
        }
      } else {
        if (!silent) {
          appendEvent("error", "API 余额查询失败", result.error);
        }
      }
    } finally {
      setCheckingBalance(false);
    }
  }, [appendEvent, busy, checkingBalance, config, setIsOnline, t]);

  const lastQueryKeyRef = useRef("");
  const queryBalanceRef = useRef(queryBalance);
  queryBalanceRef.current = queryBalance;

  useEffect(() => {
    if (configLoaded && config.provider === "deepseek" && config.apiKey) {
      const key = `${config.provider}:${config.apiKey}`;
      if (lastQueryKeyRef.current !== key) {
        lastQueryKeyRef.current = key;
        queryBalanceRef.current(true);
      }
    } else {
      lastQueryKeyRef.current = "";
    }
  }, [configLoaded, config.provider, config.apiKey]);

  const importCodexConfig = useCallback(async () => {
    if (busy) return;
    appendEvent("status", "导入 Codex 配置", "正在读取 ~/.codex/ 配置文件...");
    try {
      const result = await window.agentWindow.importCodexConfig();
      if (result.ok) {
        setConfigState((current) => normalizeProviderConfig({ ...current, ...result.config }));
        appendEvent(
          "status",
          "Codex 配置导入成功",
          `已成功导入以下配置：\n` +
          `- 提供商: ${result.config.provider ?? "未修改"}\n` +
          `- 模型: ${result.config.model ?? "未修改"}\n` +
          `- 接口地址: ${result.config.baseUrl ?? "未修改"}\n` +
          `- Wire API: ${result.config.wireApi ?? "未修改"}\n` +
          `- API Key: 已填入`
        );
      } else {
        appendEvent("error", "Codex 配置导入失败", result.error);
      }
    } catch (error) {
      appendEvent("error", "Codex 配置导入出错", error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, busy]);

  return {
    apiTestResult,
    balanceResult,
    checkingBalance,
    config,
    configLoaded,
    configPath,
    providerHint,
    queryBalance,
    setConfig,
    testingApi,
    testApi,
    updateProvider,
    importCodexConfig
  };
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  const uiConfig = {
    ...config,
    provider: config.provider === "openai-compatible" ? "openai" : config.provider
  } as ProviderConfig;
  const normalized = normalizeConfigForCapabilities(uiConfig);
  const { provider, capability } = getModelCapability(normalized);
  return {
    ...uiConfig,
    ...normalized,
    capability: {
      label: capability.label,
      contextTokens: capability.contextTokens,
      maxOutputTokens: capability.maxOutputTokens,
      supportsThinking: capability.supportsThinking,
      supportsToolCalls: capability.supportsToolCalls,
      supportsTemperature: capability.supportsTemperature,
      balancePath: provider.balancePath
    }
  };
}
