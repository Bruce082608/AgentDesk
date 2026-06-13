import { Coins, AlertCircle, LoaderCircle } from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { ProviderConfig, ProviderBalanceResult, TokenUsageStats } from "../../types";
import { formatBalanceAmount, formatInteger } from "../../utils";

type Translation = typeof translations[keyof typeof translations];

type UsageTabProps = {
  language: Language;
  config: ProviderConfig;
  queryBalance: () => void;
  busy: boolean;
  checkingBalance: boolean;
  balanceResult: ProviderBalanceResult | null;
  tokenUsage: TokenUsageStats;
  t: Translation;
};

export function UsageTab({
  language,
  config,
  queryBalance,
  busy,
  checkingBalance,
  balanceResult,
  tokenUsage,
  t
}: UsageTabProps) {
  return (
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
  );
}
