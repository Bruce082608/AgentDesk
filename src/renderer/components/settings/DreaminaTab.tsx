import { Image } from "lucide-react";
import type { Language } from "../../i18n";
import type { ProviderConfig } from "../../types";

type DreaminaTabProps = {
  language: Language;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  showApiKeys: boolean;
  setShowApiKeys: (show: boolean) => void;
};

export function DreaminaTab({
  language,
  config,
  setConfig,
  showApiKeys,
  setShowApiKeys
}: DreaminaTabProps) {
  const hasToken = Boolean(config.jimengToken);

  return (
    <section className="settings-section">
      <div className="section-header">
        <h4>{language === "zh" ? "即梦 (Jimeng) AI 创作" : "Jimeng AI Creation"}</h4>
        <p>
          {language === "zh"
            ? "配置即梦 CLI 凭证，使 Agent 可直接调用文生图、视频生成等能力"
            : "Configure Jimeng CLI credentials so the Agent can generate images and videos"}
        </p>
      </div>

      <div className="settings-group scrollable-group">
        {/* Token / Cookie input */}
        <div className="settings-field">
          <label htmlFor="setting-jimeng-token">
            {language === "zh" ? "即梦 Cookie / API Token" : "Jimeng Cookie / API Token"}
          </label>
          <input
            id="setting-jimeng-token"
            type={showApiKeys ? "text" : "password"}
            placeholder={
              language === "zh"
                ? "粘贴从浏览器开发者工具获取的 Cookie 或 API Token"
                : "Paste Cookie or API Token from browser DevTools"
            }
            value={config.jimengToken || ""}
            onChange={(e) => setConfig({ ...config, jimengToken: e.target.value })}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "-6px", marginBottom: "2px" }}>
          <input
            id="setting-show-keys-jimeng"
            type="checkbox"
            style={{ width: "14px", height: "14px", cursor: "pointer" }}
            checked={showApiKeys}
            onChange={(e) => setShowApiKeys(e.target.checked)}
          />
          <label
            htmlFor="setting-show-keys-jimeng"
            style={{ cursor: "pointer", fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}
          >
            {language === "zh" ? "显示明文" : "Show plain text"}
          </label>
        </div>

        {/* Status card */}
        <div className="model-capability-card" style={{ marginTop: "12px" }}>
          <span className="card-title">
            {language === "zh" ? "配置状态" : "Configuration Status"}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, padding: "4px" }}>
            {/* Token status */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: hasToken ? "var(--accent-color, #22c55e)" : "var(--text-muted)",
                  flexShrink: 0
                }}
              />
              <span>
                {hasToken
                  ? (language === "zh" ? "已配置 Token（已加密保存）" : "Token configured (encrypted)")
                  : (language === "zh" ? "未配置 Token" : "No token configured")}
              </span>
            </div>

            {/* Token preview */}
            {hasToken && (
              <div style={{ padding: "8px", background: "var(--bg-secondary)", borderRadius: "6px", wordBreak: "break-all", fontFamily: "monospace", fontSize: "11px" }}>
                {showApiKeys
                  ? config.jimengToken
                  : (config.jimengToken || "").length > 30
                    ? (config.jimengToken || "").slice(0, 15) + "..." + (config.jimengToken || "").slice(-10)
                    : "••••••••••••••••"}
              </div>
            )}
          </div>
        </div>

        {/* Setup instructions */}
        <div className="model-capability-card" style={{ marginTop: "12px" }}>
          <span className="card-title">
            {language === "zh" ? "设置向导" : "Setup Guide"}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6, padding: "4px" }}>
            <p style={{ margin: 0 }}>
              {language === "zh"
                ? "即梦 CLI (dreamina) 可通过两种方式认证："
                : "The Jimeng CLI (dreamina) supports two authentication methods:"}
            </p>

            <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: "6px" }}>
              <strong>{language === "zh" ? "方式一：OAuth 设备码登录（推荐）" : "Method 1: OAuth Device Flow (recommended)"}</strong>
              <p style={{ margin: "4px 0 0 0" }}>
                {language === "zh"
                  ? "在终端执行 dreamina login，扫码登录后长期有效。无需填写上方 Token。"
                  : "Run dreamina login in terminal, scan the QR code. No token needed above."}
              </p>
            </div>

            <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: "6px" }}>
              <strong>{language === "zh" ? "方式二：Cookie / Token 注入" : "Method 2: Cookie / Token Injection"}</strong>
              <p style={{ margin: "4px 0 0 0" }}>
                {language === "zh"
                  ? "1. 在浏览器中打开即梦官网 (jimeng.jianying.com) 并登录。"
                  : "1. Open jimeng.jianying.com in browser and sign in."}
              </p>
              <p style={{ margin: "2px 0 0 0" }}>
                {language === "zh"
                  ? "2. 打开开发者工具 → Application → Cookies，复制完整的 cookie 字符串。"
                  : "2. Open DevTools → Application → Cookies, copy the full cookie string."}
              </p>
              <p style={{ margin: "2px 0 0 0" }}>
                {language === "zh"
                  ? "3. 粘贴到上方输入框。Agent 会在需要时使用此凭证调用即梦 API。"
                  : "3. Paste above. The Agent will use this credential when calling Jimeng APIs."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
