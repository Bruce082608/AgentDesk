import React, { useState } from "react";
import { X, Palette, Cpu, Coins, Send, Zap } from "lucide-react";
import type { Language, translations } from "../i18n";
import type { ThemeMode, ProviderConfig, ProviderBalanceResult, TokenUsageStats } from "../types";

// Extracted Tab subcomponents
import { GeneralTab } from "./settings/GeneralTab";
import { ApiTab } from "./settings/ApiTab";
import { TelegramTab } from "./settings/TelegramTab";
import { UsageTab } from "./settings/UsageTab";
import { SkillsTab } from "./settings/SkillsTab";

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
  importCodexConfig: () => void;
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
  importCodexConfig,
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
              <GeneralTab
                language={language}
                theme={theme}
                setTheme={setTheme}
                setLanguage={setLanguage}
                t={t}
              />
            )}

            {activeTab === "api" && (
              <ApiTab
                language={language}
                config={config}
                setConfig={setConfig}
                updateProvider={updateProvider}
                showApiKeys={showApiKeys}
                setShowApiKeys={setShowApiKeys}
                testApi={testApi}
                importCodexConfig={importCodexConfig}
                busy={busy}
                testingApi={testingApi}
                providerHint={providerHint}
                configPath={configPath}
                t={t}
              />
            )}

            {activeTab === "telegram" && (
              <TelegramTab
                language={language}
                config={config}
                setConfig={setConfig}
                showApiKeys={showApiKeys}
                setShowApiKeys={setShowApiKeys}
              />
            )}

            {activeTab === "usage" && (
              <UsageTab
                language={language}
                config={config}
                queryBalance={queryBalance}
                busy={busy}
                checkingBalance={checkingBalance}
                balanceResult={balanceResult}
                tokenUsage={tokenUsage}
                t={t}
              />
            )}

            {activeTab === "skills" && (
              <SkillsTab
                language={language}
                skills={skills}
                loadingSkills={loadingSkills}
                editingSkill={editingSkill}
                setEditingSkill={setEditingSkill}
                handleToggleSkill={handleToggleSkill}
                handleDeleteSkill={handleDeleteSkill}
                handleSaveSkill={handleSaveSkill}
                config={config}
                setConfig={setConfig}
                showApiKeys={showApiKeys}
                setShowApiKeys={setShowApiKeys}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
