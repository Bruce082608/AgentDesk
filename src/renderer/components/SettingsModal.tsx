import React, { useState } from "react";
import { X, Globe, Palette, Cpu, Coins, Check, AlertCircle, LoaderCircle, Send, Zap } from "lucide-react";
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

type TabId = "general" | "api" | "telegram" | "usage" | "skills";

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
  const [showApiKeys, setShowApiKeys] = useState(false);

  const [skills, setSkills] = useState<any[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [editingSkill, setEditingSkill] = useState<any | null>(null);

  React.useEffect(() => {
    if (isOpen && activeTab === "skills") {
      void loadSkills();
    }
  }, [isOpen, activeTab]);

  const loadSkills = async () => {
    setLoadingSkills(true);
    try {
      const list = await (window as any).agentWindow.loadSkills();
      setSkills(list);
    } catch (err) {
      console.error("Failed to load skills:", err);
    } finally {
      setLoadingSkills(false);
    }
  };

  const handleToggleSkill = async (skillId: string, enabled: boolean) => {
    const updated = skills.map((s) => (s.id === skillId ? { ...s, enabled } : s));
    setSkills(updated);
    try {
      await (window as any).agentWindow.saveSkills(updated);
    } catch (err) {
      console.error("Failed to toggle skill:", err);
      void loadSkills();
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    const updated = skills.filter((s) => s.id !== skillId);
    setSkills(updated);
    try {
      await (window as any).agentWindow.saveSkills(updated);
    } catch (err) {
      console.error("Failed to delete skill:", err);
      void loadSkills();
    }
  };

  const handleSaveSkill = async (skill: any) => {
    let updated: any[];
    if (skill.id) {
      updated = skills.map((s) => (s.id === skill.id ? { ...skill, updatedAt: Date.now() } : s));
    } else {
      const newSkill = {
        ...skill,
        id: "skill_" + Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      updated = [newSkill, ...skills];
    }
    setSkills(updated);
    setEditingSkill(null);
    try {
      await (window as any).agentWindow.saveSkills(updated);
      void loadSkills();
    } catch (err) {
      console.error("Failed to save skill:", err);
      void loadSkills();
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: "general" as TabId, label: language === "zh" ? "常规设置" : "General Settings", icon: Palette },
    { id: "api" as TabId, label: language === "zh" ? "API 与模型" : "API & Models", icon: Cpu },
    { id: "telegram" as TabId, label: language === "zh" ? "Telegram 远控" : "Telegram Remote", icon: Send },
    { id: "usage" as TabId, label: language === "zh" ? "用量与余额" : "Usage & Balance", icon: Coins },
    { id: "skills" as TabId, label: language === "zh" ? "技能管理" : "Skills Management", icon: Zap }
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

            {activeTab === "telegram" && (
              <section className="settings-section">
                <div className="section-header">
                  <h4>{language === "zh" ? "Telegram 远程控制" : "Telegram Remote Control"}</h4>
                  <p>{language === "zh" ? "通过手机 Telegram 客户端向本设备发送开发指令并执行" : "Send development instructions to this device via Telegram on your mobile phone"}</p>
                </div>

                <div className="settings-group scrollable-group">
                  <div className="settings-field">
                    <label htmlFor="setting-tg-enabled">{language === "zh" ? "启用远程控制" : "Enable Remote Control"}</label>
                    <div className="select-wrapper">
                      <select
                        id="setting-tg-enabled"
                        value={config.telegramEnabled ? "true" : "false"}
                        onChange={(e) => setConfig({ ...config, telegramEnabled: e.target.value === "true" })}
                      >
                        <option value="false">{language === "zh" ? "禁用" : "Disabled"}</option>
                        <option value="true">{language === "zh" ? "启用" : "Enabled"}</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-field">
                    <label htmlFor="setting-tg-token">{language === "zh" ? "机器人 Token (Bot Token)" : "Telegram Bot Token"}</label>
                    <input
                      id="setting-tg-token"
                      type={showApiKeys ? "text" : "password"}
                      placeholder={language === "zh" ? "输入从 @BotFather 获取的 Token" : "Enter Token from @BotFather"}
                      value={config.telegramBotToken || ""}
                      onChange={(e) => setConfig({ ...config, telegramBotToken: e.target.value })}
                    />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "-6px", marginBottom: "2px" }}>
                    <input
                      id="setting-show-keys-tg"
                      type="checkbox"
                      style={{ width: "14px", height: "14px", cursor: "pointer" }}
                      checked={showApiKeys}
                      onChange={(e) => setShowApiKeys(e.target.checked)}
                    />
                    <label htmlFor="setting-show-keys-tg" style={{ cursor: "pointer", fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
                      {language === "zh" ? "显示明文" : "Show plain text"}
                    </label>
                  </div>

                  <div className="settings-field">
                    <label htmlFor="setting-tg-user-id">{language === "zh" ? "授权用户 ID (Allowed User ID)" : "Allowed Telegram User ID"}</label>
                    <input
                      id="setting-tg-user-id"
                      type="text"
                      placeholder={language === "zh" ? "输入你的 Telegram 用户 ID (例如: 12345678)" : "Enter your Telegram User ID (e.g. 12345678)"}
                      value={config.telegramAllowedUserId || ""}
                      onChange={(e) => setConfig({ ...config, telegramAllowedUserId: e.target.value })}
                    />
                  </div>

                  <div className="model-capability-card" style={{ marginTop: "12px" }}>
                    <span className="card-title">{language === "zh" ? "设置向导说明" : "Setup Instructions"}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, padding: "4px" }}>
                      <p>
                        {language === "zh" ? (
                          <>1. 在 Telegram 中找 <strong>@BotFather</strong> 创建新机器人，并获取 API Token。</>
                        ) : (
                          <>1. Search for <strong>@BotFather</strong> on Telegram to create a new bot and obtain the API Token.</>
                        )}
                      </p>
                      <p>
                        {language === "zh" ? (
                          <>2. 在 Telegram 中找 <strong>@userinfobot</strong> 发送任意消息以获取你本人的 User ID。</>
                        ) : (
                          <>2. Search for <strong>@userinfobot</strong> on Telegram to find your Telegram User ID.</>
                        )}
                      </p>
                      <p>
                        {language === "zh" ? (
                          <>3. 填写上方信息并保存，启动后即可直接私聊你的机器人发送自然语言指令（例如：“/status” 或 “新建 README.md”）。</>
                        ) : (
                          <>3. Fill in the fields above, save settings, and start chatting with your bot using natural language (e.g., "/status" or "create README.md").</>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "skills" && (
              <section className="settings-section">
                <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h4>{language === "zh" ? "技能管理 (Skills)" : "Skills Management"}</h4>
                    <p>{language === "zh" ? "配置定时自动触发的开发或查询任务（支持自然语言或 JS 代码）" : "Configure scheduled developer or query tasks using prompts or code"}</p>
                  </div>
                  {!editingSkill && (
                    <button
                      className="test-btn"
                      onClick={() => setEditingSkill({ title: "", description: "", enabled: true, type: "prompt", prompt: "", code: "", intervalMinutes: 60 })}
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                    >
                      {language === "zh" ? "+ 新建技能" : "+ New Skill"}
                    </button>
                  )}
                </div>

                <div className="settings-group scrollable-group" style={{ maxHeight: "460px", overflowY: "auto" }}>
                  {editingSkill ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
                      <div className="settings-field">
                        <label>{language === "zh" ? "技能标题" : "Title"}</label>
                        <input
                          type="text"
                          placeholder={language === "zh" ? "例如: ETH 价格追踪" : "e.g. ETH Price Tracker"}
                          value={editingSkill.title || ""}
                          onChange={(e) => setEditingSkill({ ...editingSkill, title: e.target.value })}
                        />
                      </div>

                      <div className="settings-field">
                        <label>{language === "zh" ? "描述信息" : "Description"}</label>
                        <input
                          type="text"
                          placeholder={language === "zh" ? "简单描述下此技能的用途" : "Brief description of the skill"}
                          value={editingSkill.description || ""}
                          onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                        />
                      </div>

                      <div className="settings-field">
                        <label>{language === "zh" ? "定时触发间隔 (分钟)" : "Interval (Minutes)"}</label>
                        <input
                          type="number"
                          min="1"
                          placeholder="60"
                          value={editingSkill.intervalMinutes || ""}
                          onChange={(e) => setEditingSkill({ ...editingSkill, intervalMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        />
                      </div>

                      <div className="settings-field">
                        <label>{language === "zh" ? "技能类型" : "Type"}</label>
                        <div className="select-wrapper">
                          <select
                            value={editingSkill.type || "prompt"}
                            onChange={(e) => setEditingSkill({ ...editingSkill, type: e.target.value as any })}
                          >
                            <option value="prompt">{language === "zh" ? "对话 Prompt (调用 Agent 运行)" : "Agent Prompt"}</option>
                            <option value="code">{language === "zh" ? "Node.js 代码" : "Node.js Code"}</option>
                          </select>
                        </div>
                      </div>

                      {editingSkill.type === "prompt" ? (
                        <div className="settings-field">
                          <label>{language === "zh" ? "对话 Prompt 指令" : "Prompt Instruction"}</label>
                          <textarea
                            style={{
                              width: "100%",
                              height: "100px",
                              backgroundColor: "var(--input-bg)",
                              color: "var(--text-primary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "8px",
                              fontSize: "12px",
                              resize: "vertical",
                              fontFamily: "inherit"
                            }}
                            placeholder={language === "zh" ? "在此输入要求 Agent 定时执行的任务提示词..." : "Enter prompt instruction for the Agent..."}
                            value={editingSkill.prompt || ""}
                            onChange={(e) => setEditingSkill({ ...editingSkill, prompt: e.target.value })}
                          />
                        </div>
                      ) : (
                        <div className="settings-field">
                          <label>{language === "zh" ? "JS 源代码" : "JavaScript Code"}</label>
                          <textarea
                            style={{
                              width: "100%",
                              height: "140px",
                              backgroundColor: "var(--input-bg)",
                              color: "var(--text-primary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "8px",
                              fontSize: "11px",
                              fontFamily: "monospace",
                              resize: "vertical"
                            }}
                            placeholder="// Node.js Code here..."
                            value={editingSkill.code || ""}
                            onChange={(e) => setEditingSkill({ ...editingSkill, code: e.target.value })}
                          />
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                        <button
                          className="test-btn"
                          style={{ backgroundColor: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)" }}
                          onClick={() => setEditingSkill(null)}
                        >
                          {language === "zh" ? "取消" : "Cancel"}
                        </button>
                        <button
                          className="test-btn"
                          disabled={!editingSkill.title || (editingSkill.type === "prompt" ? !editingSkill.prompt : !editingSkill.code)}
                          onClick={() => handleSaveSkill(editingSkill)}
                        >
                          {language === "zh" ? "保存" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
                      {loadingSkills && (
                        <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
                          <LoaderCircle className="animate-spin" size={20} />
                        </div>
                      )}
                      {!loadingSkills && skills.length === 0 && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", color: "var(--text-muted)", fontSize: "12px" }}>
                          <AlertCircle size={24} style={{ marginBottom: "8px" }} />
                          <p>{language === "zh" ? "目前还没有添加任何定时技能" : "No scheduled skills added yet"}</p>
                        </div>
                      )}
                      {!loadingSkills && skills.map((skill) => (
                        <div
                          key={skill.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "12px",
                            backgroundColor: "var(--card-bg)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, marginRight: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)" }}>{skill.title}</span>
                              <span
                                style={{
                                  fontSize: "10px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  backgroundColor: skill.type === "prompt" ? "rgba(38, 99, 235, 0.15)" : "rgba(16, 185, 129, 0.15)",
                                  color: skill.type === "prompt" ? "#3b82f6" : "#10b981"
                                }}
                              >
                                {skill.type === "prompt" ? "Prompt" : "Code"}
                              </span>
                            </div>
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{skill.description || "无描述"}</span>
                            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                              {language === "zh" ? `执行周期: 每 ${skill.intervalMinutes} 分钟` : `Interval: Every ${skill.intervalMinutes}m`}
                              {skill.lastRunAt > 0 && ` | ${language === "zh" ? "上次运行: " : "Last Run: "}${new Date(skill.lastRunAt).toLocaleTimeString()}`}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <input
                              type="checkbox"
                              checked={skill.enabled}
                              onChange={(e) => handleToggleSkill(skill.id, e.target.checked)}
                              style={{ width: "16px", height: "16px", cursor: "pointer" }}
                            />
                            <button
                              onClick={() => setEditingSkill(skill)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--text-secondary)",
                                cursor: "pointer",
                                fontSize: "11px",
                                padding: "4px 8px",
                                borderRadius: "4px"
                              }}
                            >
                              {language === "zh" ? "编辑" : "Edit"}
                            </button>
                            <button
                              onClick={() => handleDeleteSkill(skill.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#ef4444",
                                cursor: "pointer",
                                fontSize: "11px",
                                padding: "4px 8px",
                                borderRadius: "4px"
                              }}
                            >
                              {language === "zh" ? "删除" : "Delete"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
