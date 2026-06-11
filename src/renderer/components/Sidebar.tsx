import { memo } from "react";
import { Check, ChevronDown, ChevronRight, FileText, FolderOpen, LoaderCircle, MessageSquareMore, PencilLine, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import type { Language, translations } from "../i18n";
import type {
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
  busy: boolean;
  cancelRenameSession: () => void;
  cancelSearchWorkspace: () => void;
  chooseWorkspace: () => void;
  commitRenameSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  expandedDirs: Set<string>;
  fileSearch: string;
  language: Language;
  loadingDirs: Set<string>;
  openFile: (path: string) => void;
  renamingSessionId: string;
  renamingTitle: string;
  searchResults: SearchMatch[];
  searchingFiles: boolean;
  searchWorkspace: () => void;
  selectSession: (sessionId: string) => void;
  sessions: ChatSession[];
  setFileSearch: (value: string) => void;
  setRenamingTitle: (value: string) => void;
  setSidebarSection: (section: SidebarSection) => void;
  sidebarSection: SidebarSection;
  startNewSession: () => void;
  startRenameSession: (sessionId: string) => void;
  t: Translation;
  toggleDirectory: (path: string) => void;
  tree: WorkspaceTreeItem[];
  visibleTree: WorkspaceTreeItem[];
  workspace: string;
  onOpenSettings: () => void;
};

type SessionGroup = {
  key: string;
  label: string;
  sessions: ChatSession[];
};

const appName = "AgentDesk";
const brandIconUrl = new URL("../assets/bruce-secret-base.jpg", import.meta.url).href;

export const Sidebar = memo(function Sidebar({
  activeSessionId,
  busy,
  cancelRenameSession,
  cancelSearchWorkspace,
  chooseWorkspace,
  commitRenameSession,
  deleteSession,
  expandedDirs,
  fileSearch,
  language,
  loadingDirs,
  openFile,
  renamingSessionId,
  renamingTitle,
  searchResults,
  searchingFiles,
  searchWorkspace,
  selectSession,
  sessions,
  setFileSearch,
  setRenamingTitle,
  setSidebarSection,
  sidebarSection,
  startNewSession,
  startRenameSession,
  t,
  toggleDirectory,
  tree,
  visibleTree,
  workspace,
  onOpenSettings
}: SidebarProps) {
  const sessionGroups = groupSessionsByWorkspace(sessions, language);

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

      <nav className="section-tabs sidebar-nav" aria-label={t.sidebarNav}>
        <button className={sidebarSection === "chats" ? "active" : ""} onClick={() => setSidebarSection("chats")} title={t.chats} aria-label={t.chats}>
          <MessageSquareMore size={18} strokeWidth={2.3} aria-hidden="true" />
        </button>
        <button className={sidebarSection === "files" ? "active" : ""} onClick={() => setSidebarSection("files")} title={t.files} aria-label={t.files}>
          <FolderOpen size={18} strokeWidth={2.3} aria-hidden="true" />
        </button>
      </nav>

      {sidebarSection === "chats" && (
        <section className="panel chats-panel">
          <div className="panel-title row-title">
            <span>{t.chats}</span>
            <button className="icon-button new-chat-button" onClick={startNewSession} disabled={busy} title={t.newChat} aria-label={t.newChat}>
              <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
            </button>
          </div>
          <div className="session-list grouped">
            {sessionGroups.map((group) => (
              <section className="session-group" key={group.key}>
                <div className="session-group-title" title={group.key === "__no_workspace__" ? "" : group.key}>{group.label}</div>
                {group.sessions.map((session) => (
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
                          <button type="button" disabled={!renamingTitle.trim()} onClick={() => commitRenameSession(session.id)} title={t.rename} aria-label={t.rename}>
                            <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={cancelRenameSession} title={t.discard} aria-label={t.discard}>
                            <X size={13} strokeWidth={2.6} aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" disabled={busy} onClick={() => startRenameSession(session.id)} title={t.rename} aria-label={t.rename}>
                            <PencilLine size={13} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                          <button type="button" disabled={busy || sessions.length <= 1} onClick={() => deleteSession(session.id)} title={t.deleteSession} aria-label={t.deleteSession}>
                            <Trash2 size={13} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </section>
      )}

      {sidebarSection === "files" && (
        <section className="panel compact-panel file-panel">
          <div className="panel-title row-title">
            <span>{t.files}</span>
            <button className="secondary tiny icon-text-button" onClick={chooseWorkspace}>
              <FolderOpen size={13} strokeWidth={2.4} aria-hidden="true" />
              <span>{t.chooseFolder}</span>
            </button>
          </div>
          <div className="path-box">{workspace || t.notSelected}</div>
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
            <button
              className="secondary icon-only-button"
              disabled={!workspace || (!fileSearch.trim() && !searchingFiles)}
              onClick={searchingFiles ? cancelSearchWorkspace : searchWorkspace}
              title={searchingFiles ? t.cancel : t.search}
              aria-label={searchingFiles ? t.cancel : t.search}
            >
              {searchingFiles ? <X size={15} strokeWidth={2.5} aria-hidden="true" /> : <Search size={15} strokeWidth={2.5} aria-hidden="true" />}
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
                <span className="file-node-icon">
                  {item.type === "directory"
                    ? loadingDirs.has(item.path)
                      ? <LoaderCircle className="status-icon spin" size={13} strokeWidth={2.4} aria-hidden="true" />
                      : expandedDirs.has(item.path)
                        ? <ChevronDown size={13} strokeWidth={2.5} aria-hidden="true" />
                        : <ChevronRight size={13} strokeWidth={2.5} aria-hidden="true" />
                    : <FileText size={12} strokeWidth={2.4} aria-hidden="true" />}
                </span>
                <span className="file-node-name" title={item.path}>{item.name}</span>
                {item.type === "directory" && item.hasChildren === false && !hasTreeChildren(tree, item.path) && <small>{t.emptyDir}</small>}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="sidebar-footer">
        <button
          className="sidebar-footer-btn"
          onClick={onOpenSettings}
          title={t.advanced}
          aria-label={t.advanced}
        >
          <Settings2 size={16} strokeWidth={2.2} aria-hidden="true" />
          <span>{t.advanced}</span>
        </button>
      </div>
    </aside>
  );
});

function groupSessionsByWorkspace(sessions: ChatSession[], language: Language): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const workspace = session.workspace.trim();
    const key = workspace || "__no_workspace__";
    const label = workspace ? formatWorkspaceLabel(workspace) : (language === "zh" ? "未选择工作目录" : "No workspace");
    if (!groups.has(key)) groups.set(key, { key, label, sessions: [] });
    groups.get(key)?.sessions.push(session);
  }
  return [...groups.values()];
}

function formatWorkspaceLabel(workspace: string) {
  const normalized = workspace.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) || workspace;
}
