import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translations } from "../i18n";
import type { EventLogItem, ProviderBalanceResult, ProviderConfig } from "../types";
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
    return t.providerHintCompatible;
  }, [config.capability, config.contextTokens, config.model, config.provider, t]);

  const updateProvider = useCallback((provider: ProviderConfig["provider"]) => {
    const nextDefaults =
      provider === "deepseek"
        ? { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", summaryModel: "deepseek-v4-flash", thinkingMode: "enabled" as const, reasoningEffort: "max" as const, contextTokens: 1000000, maxTokens: 32768 }
        : { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", summaryModel: "", thinkingMode: "disabled" as const, reasoningEffort: "medium" as const, contextTokens: 128000, maxTokens: 4096 };
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
      return;
    }
    setTestingApi(true);
    appendEvent("status", "API 检测", "正在发送最小 health check 请求...");
    try {
      const result = await window.agentWindow.testProvider(config);
      if (result.ok) {
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
        appendEvent("error", "API 不可用", result.error);
      }
    } finally {
      setTestingApi(false);
    }
  }, [appendEvent, busy, config, setIsOnline, t, testingApi]);

  const queryBalance = useCallback(async () => {
    if (checkingBalance || busy) return;
    if (!navigator.onLine) {
      setIsOnline(false);
      appendEvent("error", t.offlineTitle, t.offlineBody);
      return;
    }
    setCheckingBalance(true);
    setBalanceResult(null);
    appendEvent("status", "API 余额查询", "正在请求 DeepSeek 官方余额接口...");
    try {
      const result = await window.agentWindow.getBalance(config);
      if (result.ok) {
        setBalanceResult(result.result);
        appendEvent("status", "API 余额查询成功", JSON.stringify(result.result, null, 2));
      } else {
        appendEvent("error", "API 余额查询失败", result.error);
      }
    } finally {
      setCheckingBalance(false);
    }
  }, [appendEvent, busy, checkingBalance, config, setIsOnline, t]);

  return {
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
    updateProvider
  };
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  const normalized = normalizeConfigForCapabilities(config);
  const { provider, capability } = getModelCapability(normalized);
  return {
    ...config,
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
