import { LoaderCircle } from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { ProviderConfig } from "../../types";
import { formatInteger } from "../../utils";
import { PROVIDER_CAPABILITIES } from "../../../shared/providerCapabilities";

type Translation = typeof translations[keyof typeof translations];

type ApiTabProps = {
  language: Language;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  updateProvider: (provider: ProviderConfig["provider"]) => void;
  showApiKeys: boolean;
  setShowApiKeys: (show: boolean) => void;
  testApi: () => void;
  importCodexConfig: () => void;
  busy: boolean;
  testingApi: boolean;
  providerHint: string;
  configPath: string;
  t: Translation;
};

export function ApiTab({
  language,
  config,
  setConfig,
  updateProvider,
  showApiKeys,
  setShowApiKeys,
  testApi,
  importCodexConfig,
  busy,
  testingApi,
  providerHint,
  configPath,
  t
}: ApiTabProps) {
  return (
    <section className="settings-section">
      <div className="section-header">
        <h4>{language === "zh" ? "API 服务与大语言模型" : "API Services & LLMs"}</h4>
        <p>{language === "zh" ? "配置用于与 Agent 交互的深度神经网络模型参数" : "Configure the API provider and model parameters used for Agent conversations"}</p>
      </div>

      <div className="settings-group scrollable-group">
        <div className="settings-field">
          <label htmlFor="setting-provider">{t.provider}</label>
          <div className="select-wrapper">
            <select
              id="setting-provider"
              value={config.provider}
              onChange={(e) => updateProvider(e.target.value as ProviderConfig["provider"])}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </div>
        </div>

        <div className="settings-field">
          <label htmlFor="setting-baseurl">{t.baseUrl}</label>
          <input
            id="setting-baseurl"
            type="text"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          />
        </div>

        <div className="settings-field">
          <label htmlFor="setting-model">{t.model}</label>
          {config.provider === "deepseek" ? (
            <div className="select-wrapper">
              <select
                id="setting-model"
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
              >
                {Object.entries(PROVIDER_CAPABILITIES[config.provider]?.models || {}).map(([key, m]) => (
                  <option key={key} value={key}>{(m as any).label || key}</option>
                ))}
              </select>
            </div>
          ) : (
            <input
              id="setting-model"
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder={config.provider === "openai" ? "e.g. gpt-4.1-mini, o4-mini, gpt-5.5" : "e.g. gpt-4.1-mini"}
            />
          )}
        </div>

        {config.capability && (
          <div className="model-capability-card">
            <span className="card-title">{language === "zh" ? "支持的扩展能力" : "Model Capabilities"}</span>
            <div className="capability-grid">
              <div className="cap-item">
                <span className="label">Context</span>
                <strong className="value">{formatInteger(config.capability.contextTokens, language)}</strong>
              </div>
              <div className="cap-item">
                <span className="label">Max Output</span>
                <strong className="value">{formatInteger(config.capability.maxOutputTokens, language)}</strong>
              </div>
              <div className="cap-item">
                <span className="label">Thinking</span>
                <strong className="value">{config.capability.supportsThinking ? t.enabled : t.disabled}</strong>
              </div>
              <div className="cap-item">
                <span className="label">Tool Calls</span>
                <strong className="value">{config.capability.supportsToolCalls ? t.enabled : t.disabled}</strong>
              </div>
            </div>
          </div>
        )}



        <div className="settings-field">
          <label htmlFor="setting-apikey">{t.apiKey}</label>
          <input
            id="setting-apikey"
            type={showApiKeys ? "text" : "password"}
            value={config.apiKey}
            placeholder={t.apiKeyPlaceholder}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "-6px", marginBottom: "2px" }}>
          <input
            id="setting-show-keys-api"
            type="checkbox"
            style={{ width: "14px", height: "14px", cursor: "pointer" }}
            checked={showApiKeys}
            onChange={(e) => setShowApiKeys(e.target.checked)}
          />
          <label htmlFor="setting-show-keys-api" style={{ cursor: "pointer", fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
            {language === "zh" ? "显示明文" : "Show plain text"}
          </label>
        </div>

        <div className="settings-field">
          <label htmlFor="setting-maxtokens">{t.maxOutputTokens}</label>
          <input
            id="setting-maxtokens"
            type="number"
            min="1"
            max={config.capability?.maxOutputTokens || undefined}
            step="1024"
            value={config.maxTokens}
            onChange={(e) => {
              const limit = config.capability?.maxOutputTokens || Number.MAX_SAFE_INTEGER;
              setConfig({ ...config, maxTokens: Math.min(Number(e.target.value), limit) });
            }}
          />
        </div>

        <div className="settings-field">
          <label htmlFor="setting-maxsteps">{t.maxAgentSteps}</label>
          <input
            id="setting-maxsteps"
            type="number"
            min="8"
            max="256"
            step="1"
            value={config.maxAgentSteps}
            onChange={(e) => {
              const nextValue = Math.min(Math.max(Math.floor(Number(e.target.value) || 64), 8), 256);
              setConfig({ ...config, maxAgentSteps: nextValue });
            }}
          />
        </div>

        <div className="settings-field">
          <label htmlFor="setting-thinking">{t.thinkingMode}</label>
          <div className="select-wrapper">
            <select
              id="setting-thinking"
              value={config.thinkingMode}
              disabled={!config.capability?.supportsThinking}
              onChange={(e) => setConfig({ ...config, thinkingMode: e.target.value as ProviderConfig["thinkingMode"] })}
            >
              <option value="enabled">{t.enabled}</option>
              <option value="disabled">{t.disabled}</option>
            </select>
          </div>
        </div>

        <div className="settings-field">
          <label htmlFor="setting-effort">{t.reasoningEffort}</label>
          <div className="select-wrapper">
            <select
              id="setting-effort"
              value={config.reasoningEffort}
              disabled={!config.capability?.supportsThinking}
              onChange={(e) => setConfig({ ...config, reasoningEffort: e.target.value as ProviderConfig["reasoningEffort"] })}
            >
              <option value="max">Max</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        <div className="settings-field">
          <label htmlFor="setting-temperature">{t.temperature}</label>
          <input
            id="setting-temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={config.temperature}
            disabled={config.capability ? !config.capability.supportsTemperature : false}
            onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })}
          />
        </div>

        <div className="settings-actions-footer">
          <button
            type="button"
            className="settings-action-btn secondary"
            onClick={importCodexConfig}
            disabled={busy}
            style={{ marginRight: "auto" }}
          >
            {(t as any).importCodexConfig || "Import Codex Config"}
          </button>
          <button
            type="button"
            className="settings-action-btn primary"
            onClick={testApi}
            disabled={busy || testingApi}
          >
            {testingApi ? (
              <>
                <LoaderCircle className="spin-icon spin" size={14} />
                <span>{t.testing}</span>
              </>
            ) : (
              t.testApi
            )}
          </button>
          {providerHint && <p className="provider-hint">{providerHint}</p>}
          {configPath && <p className="config-path-hint">{t.config}: {configPath}</p>}
        </div>
      </div>
    </section>
  );
}
