import {
  PanelLeftOpen,
  PanelLeftClose,
  FolderOpen,
  LoaderCircle,
  CheckCircle2,
  TriangleAlert,
  ArrowUpCircle,
  Square,
  PanelRightOpen,
  PanelRightClose
} from "lucide-react";
import type { Language, translations } from "../../i18n";

type Translation = typeof translations[keyof typeof translations];

type TopBarProps = {
  language: Language;
  t: Translation;
  workspace: string;
  busy: boolean;
  leftSidebarCollapsed: boolean;
  toggleLeftSidebar: () => void;
  rightSidebarCollapsed: boolean;
  toggleRightSidebar: () => void;
  gitUpdateState: {
    available: boolean;
    status: "idle" | "checking" | "updating" | "completed" | "error";
    detail: string;
  };
  handleApplyUpdate: () => void;
  cancelActiveRequest: () => void;
};

export function TopBar({
  language,
  t,
  workspace,
  busy,
  leftSidebarCollapsed,
  toggleLeftSidebar,
  rightSidebarCollapsed,
  toggleRightSidebar,
  gitUpdateState,
  handleApplyUpdate,
  cancelActiveRequest
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-toggle-btn"
          onClick={toggleLeftSidebar}
          title={leftSidebarCollapsed ? t.expandLeftSidebar : t.collapseLeftSidebar}
          aria-label="Toggle left sidebar"
        >
          {leftSidebarCollapsed ? <PanelLeftOpen size={16} strokeWidth={2.2} /> : <PanelLeftClose size={16} strokeWidth={2.2} />}
        </button>
        <span className="topbar-divider">|</span>
        <FolderOpen size={14} strokeWidth={2.2} className="topbar-icon" />
        <span className="topbar-workspace" title={workspace || t.notSelected}>
          {workspace || t.notSelected}
        </span>
        <span className={`status-badge ${busy ? "running" : "ready"}`}>
          {busy ? t.running : t.ready}
        </span>
      </div>
      <div className="topbar-actions">
        {gitUpdateState.available && (
          <button
            type="button"
            className={`update-badge-btn ${gitUpdateState.status}`}
            onClick={handleApplyUpdate}
            disabled={gitUpdateState.status === "updating" || gitUpdateState.status === "completed"}
            title={gitUpdateState.detail || (language === "zh" ? "检测到新版本，点击自动更新" : "New version detected, click to auto update")}
          >
            {gitUpdateState.status === "updating" && (
              <LoaderCircle className="spin" size={13} strokeWidth={2.5} />
            )}
            {gitUpdateState.status === "completed" && (
              <CheckCircle2 size={13} strokeWidth={2.5} />
            )}
            {gitUpdateState.status === "error" && (
              <TriangleAlert size={13} strokeWidth={2.5} />
            )}
            {gitUpdateState.status === "idle" && (
              <ArrowUpCircle size={13} strokeWidth={2.5} />
            )}
            <span>
              {gitUpdateState.status === "idle" && (language === "zh" ? "新版本" : "New Version")}
              {gitUpdateState.status === "updating" && (language === "zh" ? "更新中..." : "Updating...")}
              {gitUpdateState.status === "completed" && (language === "zh" ? "请重启" : "Restart App")}
              {gitUpdateState.status === "error" && (language === "zh" ? "重试" : "Retry")}
            </span>
          </button>
        )}
        {busy && (
          <button className="secondary danger icon-text-button" onClick={cancelActiveRequest}>
            <Square size={13} strokeWidth={2.5} aria-hidden="true" />
            <span>{t.stop}</span>
          </button>
        )}
        <button
          type="button"
          className="topbar-toggle-btn"
          onClick={toggleRightSidebar}
          title={rightSidebarCollapsed ? t.expandRightSidebar : t.collapseRightSidebar}
          aria-label="Toggle right sidebar"
        >
          {rightSidebarCollapsed ? <PanelRightOpen size={16} strokeWidth={2.2} /> : <PanelRightClose size={16} strokeWidth={2.2} />}
        </button>
      </div>
    </header>
  );
}
