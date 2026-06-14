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
  PanelRightClose,
  Coins
} from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { ProviderBalanceResult, ProviderConfig } from "../../types";
import { formatBalanceAmount } from "../../utils";

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
  balanceResult: ProviderBalanceResult | null;
  checkingBalance: boolean;
  providerConfig: ProviderConfig;
  queryBalance: (silent?: boolean) => void;
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
  cancelActiveRequest,
  balanceResult,
  checkingBalance,
  providerConfig,
  queryBalance
}: TopBarProps) {
  const getDisplayBalanceString = () => {
    if (!balanceResult || !balanceResult.balance_infos || balanceResult.balance_infos.length === 0) {
      return "—";
    }
    const nonZeroBalances = balanceResult.balance_infos.filter(
      (info) => Number(info.total_balance) > 0
    );
    const targets = nonZeroBalances.length > 0 ? nonZeroBalances : [balanceResult.balance_infos[0]];
    return targets
      .map((info) =>
        formatBalanceAmount(
          info.total_balance || "0",
          info.currency || "CNY",
          language
        ).replace("CNY", "¥").replace("USD", "$")
      )
      .join(" / ");
  };

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
      </div>

      {providerConfig.provider === "deepseek" && providerConfig.apiKey && (
        <div className="topbar-balance-container">
          <div
            className="balance-pill"
            onClick={() => queryBalance(false)}
            title={language === "zh" ? "点击手动刷新余额" : "Click to refresh balance"}
          >
            <Coins size={13} className="balance-icon" />
            <span className="balance-label">{language === "zh" ? "余额:" : "Balance:"}</span>
            <strong className="balance-value">
              {checkingBalance ? (
                <LoaderCircle className="spin-icon spin" size={11} style={{ verticalAlign: "middle" }} />
              ) : (
                getDisplayBalanceString()
              )}
            </strong>
          </div>
          <button
            type="button"
            className="balance-recharge-btn"
            onClick={() => window.agentWindow.shellOpen("https://platform.deepseek.com/usage")}
            title={language === "zh" ? "前往一键充值" : "Go to Recharge"}
          >
            <span>{language === "zh" ? "充值" : "Recharge"}</span>
          </button>
        </div>
      )}
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
