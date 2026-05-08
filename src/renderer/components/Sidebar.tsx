import { memo } from "react";
import type { Language, translations } from "../i18n";
import type {
  ActivityFilter,
  ChatSession,
  ProviderBalanceResult,
  ProviderConfig,
  SearchMatch,
  SidebarSection,
  TokenUsageStats,
  WorkspaceTreeItem
} from "../types";
import { formatBalanceAmount, formatInteger, formatSessionTime, hasTreeChildren } from "../utils";

type Translation = typeof translations[keyof typeof translations];

type SidebarProps = {
  activeSessionId: string;
  balanceResult: ProviderBalanceResult | null;
  busy: boolean;
  cancelRenameSession: () => void;
  cancelSearchWorkspace: () => void;
  checkingBalance: boolean;
  chooseWorkspace: () => void;
  commitRenameSession: (sessionId: string) => void;
  config: ProviderConfig;
  configPath: string;
  deleteSession: (sessionId: string) => void;
  expandedDirs: Set<string>;
  fileSearch: string;
  language: Language;
  loadingDirs: Set<string>;
  openFile: (path: string) => void;
  providerHint: string;
  queryBalance: () => void;
  renamingSessionId: string;
  renamingTitle: string;
  searchResults: SearchMatch[];
  searchingFiles: boolean;
  searchWorkspace: () => void;
  selectSession: (sessionId: string) => void;
  sessions: ChatSession[];
  setConfig: (config: ProviderConfig) => void;
  setFileSearch: (value: string) => void;
  setRenamingTitle: (value: string) => void;
  setSidebarSection: (section: SidebarSection) => void;
  sidebarSection: SidebarSection;
  startNewSession: () => void;
  startRenameSession: (sessionId: string) => void;
  t: Translation;
  testingApi: boolean;
  testApi: () => void;
  tokenUsage: TokenUsageStats;
  toggleDirectory: (path: string) => void;
  tree: WorkspaceTreeItem[];
  updateProvider: (provider: ProviderConfig["provider"]) => void;
  visibleTree: WorkspaceTreeItem[];
  workspace: string;
};

const appName = "Bruce的秘密基地";
const brandIconUrl = new URL("../assets/bruce-secret-base.jpg", import.meta.url).href;

export const Sidebar = memo(function Sidebar({
  activeSessionId,
  balanceResult,
  busy,
  cancelRenameSession,
  cancelSearchWorkspace,
  checkingBalance,
  chooseWorkspace,
  commitRenameSession,
  config,
  configPath,
  deleteSession,
  expandedDirs,
  fileSearch,
  language,
  loadingDirs,
  openFile,
  providerHint,
  queryBalance,
  renamingSessionId,
  renamingTitle,
  searchResults,
  searchingFiles,
  searchWorkspace,
  selectSession,
  sessions,
  setConfig,
  setFileSearch,
  setRenamingTitle,
  setSidebarSection,
  sidebarSection,
  startNewSession,
  startRenameSession,
  t,
  testingApi,
  testApi,
  tokenUsage,
  toggleDirectory,
  tree,
  updateProvider,
  visibleTree,
  workspace
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img src={brandIconUrl} alt="" />
        </div>
        <div>
          <h1>{appName}</h1>
          <p>{t.appSubtitle}</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-title row-title">
          <span>{t.chats}</span>
          <button className="icon-button new-chat-button" onClick={startNewSession} disabled={busy} title={t.newChat} aria-label={t.newChat}>+</button>
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <div className={`session-row ${session.id === activeSessionId ? "active" : ""}`} key={session.id}>
              {renamingSessionId === session.id ? (
                <input
                  className="session-edit-input"
                  value={renamingTitle}
                  autoFocus
                  aria-label={t.renameSessionPrompt}
                  onChange={(event) => setRenamingTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRenameSession(session.id);
                    if (event.key === "Escape") cancelRenameSession();
                  }}
                />
              ) : (
                <button
                  className="session-item"
                  onClick={() => selectSession(session.id)}
                  disabled={busy}
                >
                  <strong>{session.title}</strong>
                  <span>{session.messages.length} {t.messagesUnit} · {formatSessionTime(session.updatedAt, language)}</span>
                </button>
              )}
              <div className="session-actions">
                {renamingSessionId === session.id ? (
                  <>
                    <button type="button" disabled={!renamingTitle.trim()} onClick={() => commitRenameSession(session.id)} title={t.rename} aria-label={t.rename}>✓</button>
                    <button type="button" onClick={cancelRenameSession} title={t.discard} aria-label={t.discard}>×</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={busy} onClick={() => startRenameSession(session.id)} title={t.rename} aria-label={t.rename}>✎</button>
                    <button type="button" disabled={busy || sessions.length <= 1} onClick={() => deleteSession(session.id)} title={t.deleteSession} aria-label={t.deleteSession}>×</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">{t.workspace}</div>
        <button className="primary" onClick={chooseWorkspace}>{t.chooseFolder}</button>
        <div className="path-box">{workspace || t.notSelected}</div>
      </section>

      <nav className="section-tabs" aria-label={t.sidebarNav}>
        <button className={sidebarSection === "files" ? "active" : ""} onClick={() => setSidebarSection("files")} title={t.files} aria-label={t.files}>▦</button>
        <button className={sidebarSection === "advanced" ? "active" : ""} onClick={() => setSidebarSection("advanced")} title={t.advanced} aria-label={t.advanced}>⚙</button>
      </nav>

      {sidebarSection === "files" && (
        <section className="panel compact-panel">
          <div className="panel-title">{t.files}</div>
          <div className="file-search">
            <input
              value={fileSearch}
              placeholder={t.searchPlaceholder}
              disabled={!workspace}
              onChange={(event) => setFileSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") searchWorkspace();
              }}
            />
            <button className="secondary" disabled={!workspace || (!fileSearch.trim() && !searchingFiles)} onClick={searchingFiles ? cancelSearchWorkspace : searchWorkspace}>
              {searchingFiles ? t.cancel : t.search}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((match) => (
                <button key={`${match.file}:${match.line}:${match.text}`} onClick={() => openFile(match.file)}>
                  <strong>{match.file}:{match.line}</strong>
                  <span>{match.text}</span>
                </button>
              ))}
            </div>
          )}
          <div className="file-tree">
            {tree.length === 0 && <span className="muted">{t.noFiles}</span>}
            {visibleTree.map((item) => (
              <button
                className={`file-node ${item.type} ${item.type === "directory" && expandedDirs.has(item.path) ? "expanded" : ""}`}
                key={item.path}
                style={{ paddingLeft: `${8 + item.depth * 12}px` }}
                onClick={() => item.type === "directory" ? toggleDirectory(item.path) : openFile(item.path)}
              >
                <span>{item.type === "directory" ? (loadingDirs.has(item.path) ? "…" : expandedDirs.has(item.path) ? "▾" : "▸") : "·"}</span>
                {item.name}
                {item.type === "directory" && item.hasChildren === false && !hasTreeChildren(tree, item.path) && <small>{t.emptyDir}</small>}
              </button>
            ))}
          </div>
        </section>
      )}

      {sidebarSection === "advanced" && (
          <section className="panel">
            <div className="panel-title">{t.advanced}</div>
            <select value={config.provider} onChange={(event) => updateProvider(event.target.value as ProviderConfig["provider"])}>
              <option value="deepseek">DeepSeek</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
            <label>
              {t.baseUrl}
              <input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />
            </label>
            <label>
              {t.model}
              <input
                value={config.model}
                readOnly={config.provider === "deepseek"}
                onChange={(event) => setConfig({ ...config, model: event.target.value })}
              />
            </label>
            {config.capability && (
              <div className="usage-card">
                <div className="panel-title">{language === "zh" ? "模型能力" : "Model capabilities"}</div>
                <div className="metric">Context <strong>{formatInteger(config.capability.contextTokens, language)}</strong></div>
                <div className="metric">Max output <strong>{formatInteger(config.capability.maxOutputTokens, language)}</strong></div>
                <div className="metric">Thinking <strong>{config.capability.supportsThinking ? t.enabled : t.disabled}</strong></div>
                <div className="metric">Tool calls <strong>{config.capability.supportsToolCalls ? t.enabled : t.disabled}</strong></div>
              </div>
            )}
            <label>
              {t.summaryModel}
              <input
                value={config.summaryModel}
                placeholder={t.summaryModelPlaceholder}
                onChange={(event) => setConfig({ ...config, summaryModel: event.target.value })}
              />
            </label>
            <label>
              {t.apiKey}
              <input
                type="password"
                value={config.apiKey}
                placeholder={t.apiKeyPlaceholder}
                onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
              />
            </label>
            <button className="secondary full" onClick={testApi} disabled={busy || testingApi}>
              {testingApi ? t.testing : t.testApi}
            </button>
            <button className="secondary full" onClick={queryBalance} disabled={busy || checkingBalance || config.provider !== "deepseek"}>
              {checkingBalance ? t.balanceChecking : t.queryBalance}
            </button>
            {balanceResult && (
              <div className="balance-card">
                <div className={`balance-status ${balanceResult.is_available ? "available" : "unavailable"}`}>
                  {balanceResult.is_available ? t.balanceAvailable : t.balanceUnavailable}
                </div>
                {balanceResult.balance_infos.map((info) => (
                  <div className="balance-currency" key={info.currency}>
                    <div className="metric">{t.totalBalance} <strong>{formatBalanceAmount(info.total_balance, info.currency, language)}</strong></div>
                    <div className="metric">{t.grantedBalance} <strong>{formatBalanceAmount(info.granted_balance, info.currency, language)}</strong></div>
                    <div className="metric">{t.toppedUpBalance} <strong>{formatBalanceAmount(info.topped_up_balance, info.currency, language)}</strong></div>
                  </div>
                ))}
              </div>
            )}
            <div className="usage-card">
              <div className="panel-title">{t.localTokenUsage}</div>
              <div className="metric">{t.promptTokens} <strong>{formatInteger(tokenUsage.promptTokens, language)}</strong></div>
              <div className="metric">{t.completionTokens} <strong>{formatInteger(tokenUsage.completionTokens, language)}</strong></div>
              <div className="metric">{t.totalTokens} <strong>{formatInteger(tokenUsage.totalTokens, language)}</strong></div>
              <div className="metric">{t.usageRequests} <strong>{formatInteger(tokenUsage.requests, language)}</strong></div>
              <p className="hint">{t.balanceHint}</p>
            </div>
            <label>
              {t.maxOutputTokens}
              <input
                type="number"
                min="1"
                max={config.capability?.maxOutputTokens || undefined}
                step="1024"
                value={config.maxTokens}
                onChange={(event) => {
                  const limit = config.capability?.maxOutputTokens || Number.MAX_SAFE_INTEGER;
                  setConfig({ ...config, maxTokens: Math.min(Number(event.target.value), limit) });
                }}
              />
            </label>
            <label>
              {t.maxAgentSteps}
              <input
                type="number"
                min="8"
                max="256"
                step="1"
                value={config.maxAgentSteps}
                onChange={(event) => {
                  const nextValue = Math.min(Math.max(Math.floor(Number(event.target.value) || 64), 8), 256);
                  setConfig({ ...config, maxAgentSteps: nextValue });
                }}
              />
            </label>
            <label>
              {t.thinkingMode}
              <select
                value={config.thinkingMode}
                disabled={!config.capability?.supportsThinking}
                onChange={(event) => setConfig({ ...config, thinkingMode: event.target.value as ProviderConfig["thinkingMode"] })}
              >
                <option value="enabled">{t.enabled}</option>
                <option value="disabled">{t.disabled}</option>
              </select>
            </label>
            <label>
              {t.reasoningEffort}
              <select
                value={config.reasoningEffort}
                disabled={!config.capability?.supportsThinking}
                onChange={(event) => setConfig({ ...config, reasoningEffort: event.target.value as ProviderConfig["reasoningEffort"] })}
              >
                <option value="max">Max</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label>
              {t.temperature}
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature}
                disabled={config.capability ? !config.capability.supportsTemperature : false}
                onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })}
              />
            </label>
            <p className="hint">{providerHint}</p>
            {configPath && <p className="hint file-hint">{t.config}: {configPath}</p>}
          </section>
      )}
    </aside>
  );
});
