import React, { useState } from "react";
import { X, Globe, Palette, Cpu, Coins, Check, AlertCircle, LoaderCircle } from "lucide-react";
import type { Language, translations } from "../i18n";
import type { ThemeMode, ProviderConfig, ProviderBalanceResult, TokenUsageStats } from "../types";
import { formatBalanceAmount, formatInteger } from "../utils";

type Translation = typeof translations[keyof typeof translations];

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  configPath: string;
  providerHint: string;
  testingApi: boolean;
  testApi: () => void;
  checkingBalance: boolean;
  queryBalance: () => void;
  balanceResult: ProviderBalanceResult | null;
  tokenUsage: TokenUsageStats;
  updateProvider: (provider: ProviderConfig["provider"]) => void;
  busy: boolean;
  t: Translation;
};

type TabId = "general" | "api" | "usage";

export function SettingsModal({
  isOpen,
  onClose,
  language,
  setLanguage,
  theme,
  setTheme,
  config,
  setConfig,
  configPath,
  providerHint,
  testingApi,
  testApi,
  checkingBalance,
  queryBalance,
  balanceResult,
  tokenUsage,
  updateProvider,
  busy,
  t
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("general");

  if (!isOpen) return null;

  const tabs = [
    { id: "general" as TabId, label: language === "zh" ? "常规设置" : "General Settings", icon: Palette },
    { id: "api" as TabId, label: language === "zh" ? "API 与模型" : "API & Models", icon: Cpu },
    { id: "usage" as TabId, label: language === "zh" ? "用量与余额" : "Usage & Balance", icon: Coins }
  ];

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal-container" onClick={(e) => e.stopPropagation()}>
        <header className="settings-modal-header">
          <div className="header-title">
            <h3>{language === "zh" ? "应用设置" : "Application Settings"}</h3>
            <p className="subtitle">{language === "zh" ? "配置您的偏好设置、API 服务及模型参数" : "Configure your preferences, API services and model parameters"}</p>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close settings">
            <X size={18} strokeWidth={2.4} />
          </button>
        </header>

        <div className="settings-modal-body">
          {/* Left Navigation */}
          <aside className="settings-modal-nav">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`nav-tab-item ${activeTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={16} strokeWidth={2.2} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Right Content Area */}
          <main className="settings-modal-content">
            {activeTab === "general" && (
              <section className="settings-section">
                <div className="section-header">
                  <h4>{language === "zh" ? "常规偏好" : "General Preferences"}</h4>
                  <p>{language === "zh" ? "调整界面的外观显示与语言环境" : "Adjust appearance details and regional language"}</p>
                </div>

                <div className="settings-group">
                  <div className="settings-field">
                    <label htmlFor="setting-theme">{t.theme}</label>
                    <div className="select-wrapper">
                      <select
                        id="setting-theme"
                        value={theme}
                        onChange={(e) => setTheme(e.target.value as ThemeMode)}
                      >
                        <option value="light">{t.light}</option>
                        <option value="dark">{t.dark}</option>
                        <option value="system">{t.system}</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-field">
                    <label htmlFor="setting-lang">{t.language}</label>
                    <div className="select-wrapper">
                      <select
                        id="setting-lang"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as Language)}
                      >
                        <option value="zh">中文</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "api" && (
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
                    <input
                      id="setting-model"
                      type="text"
                      value={config.model}
                      readOnly={config.provider === "deepseek"}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    />
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
                    <label htmlFor="setting-summary-model">{t.summaryModel}</label>
                    <input
                      id="setting-summary-model"
                      type="text"
                      value={config.summaryModel}
                      placeholder={t.summaryModelPlaceholder}
                      onChange={(e) => setConfig({ ...config, summaryModel: e.target.value })}
                    />
                  </div>

                  <div className="settings-field">
                    <label htmlFor="setting-apikey">{t.apiKey}</label>
                    <input
                      id="setting-apikey"
                      type="password"
                      value={config.apiKey}
                      placeholder={t.apiKeyPlaceholder}
                      onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                    />
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
            )}

            {activeTab === "usage" && (
              <section className="settings-section">
                <div className="section-header">
                  <h4>{language === "zh" ? "服务额度与本地用量" : "Quotas & Local Usage"}</h4>
                  <p>{language === "zh" ? "查询云端 API 账户剩余额度以及当前设备的本地 Token 消费统计" : "Check cloud API balance details and track local Token consumption statistics"}</p>
                </div>

                <div className="settings-group scrollable-group">
                  <div className="usage-control-row">
                    <button
                      type="button"
                      className="settings-action-btn secondary"
                      onClick={queryBalance}
                      disabled={busy || checkingBalance || config.provider !== "deepseek"}
                    >
                      {checkingBalance ? (
                        <>
                          <LoaderCircle className="spin-icon spin" size={14} />
                          <span>{t.balanceChecking}</span>
                        </>
                      ) : (
                        t.queryBalance
                      )}
                    </button>
                    {config.provider !== "deepseek" && (
                      <span className="balance-notice">
                        <AlertCircle size={14} />
                        <span>{language === "zh" ? "仅 DeepSeek Provider 支持自动查询余额" : "Balance query is only supported for the DeepSeek provider"}</span>
                      </span>
                    )}
                  </div>

                  {balanceResult && (
                    <div className="balance-info-card">
                      <div className={`status-badge ${balanceResult.is_available ? "available" : "unavailable"}`}>
                        {balanceResult.is_available ? t.balanceAvailable : t.balanceUnavailable}
                      </div>
                      <div className="balance-details">
                        {balanceResult.balance_infos.map((info) => (
                          <div className="currency-block" key={info.currency}>
                            <div className="balance-row">
                              <span>{t.totalBalance}</span>
                              <strong>{formatBalanceAmount(info.total_balance, info.currency, language)}</strong>
                            </div>
                            <div className="balance-row sub-row">
                              <span>{t.grantedBalance}</span>
                              <span>{formatBalanceAmount(info.granted_balance, info.currency, language)}</span>
                            </div>
                            <div className="balance-row sub-row">
                              <span>{t.toppedUpBalance}</span>
                              <span>{formatBalanceAmount(info.topped_up_balance, info.currency, language)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="local-usage-card">
                    <span className="card-title">{t.localTokenUsage}</span>
                    <div className="usage-stats-grid">
                      <div className="usage-stat-item">
                        <span className="label">{t.promptTokens}</span>
                        <strong className="value">{formatInteger(tokenUsage.promptTokens, language)}</strong>
                      </div>
                      <div className="usage-stat-item">
                        <span className="label">{t.completionTokens}</span>
                        <strong className="value">{formatInteger(tokenUsage.completionTokens, language)}</strong>
                      </div>
                      <div className="usage-stat-item">
                        <span className="label">{t.totalTokens}</span>
                        <strong className="value">{formatInteger(tokenUsage.totalTokens, language)}</strong>
                      </div>
                      <div className="usage-stat-item">
                        <span className="label">{t.usageRequests}</span>
                        <strong className="value">{formatInteger(tokenUsage.requests, language)}</strong>
                      </div>
                    </div>
                    <p className="usage-hint">{t.balanceHint}</p>
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
