import type { Language } from "../../i18n";
import type { ProviderConfig } from "../../types";

type JimengTabProps = {
  language: Language;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  showApiKeys: boolean;
  setShowApiKeys: (show: boolean) => void;
};

export function JimengTab({
  language,
  config,
  setConfig,
  showApiKeys,
  setShowApiKeys
}: JimengTabProps) {
  return (
    <section className="settings-section">
      <div className="section-header">
        <h4>{language === "zh" ? "即梦 CLI 绑定" : "Jimeng CLI Binding"}</h4>
        <p>{language === "zh" ? "绑定即梦 CLI 的 Token 或 Cookie，使其成为 Agent 的长期记忆" : "Bind Jimeng CLI Token or Cookie as a permanent memory for the Agent"}</p>
      </div>

      <div className="settings-group scrollable-group">
        <div className="settings-field">
          <label htmlFor="setting-jimeng-token">{language === "zh" ? "即梦 Cookie / API Token" : "Jimeng Cookie / API Token"}</label>
          <input
            id="setting-jimeng-token"
            type={showApiKeys ? "text" : "password"}
            placeholder={language === "zh" ? "输入您的即梦 API Key 或 Cookie 值 (例如 sessionid)" : "Enter your Jimeng API Key or Cookie (e.g. sessionid)"}
            value={config.jimengToken || ""}
            onChange={(e) => setConfig({ ...config, jimengToken: e.target.value })}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "-6px", marginBottom: "2px" }}>
          <input
            id="setting-show-keys-jm"
            type="checkbox"
            style={{ width: "14px", height: "14px", cursor: "pointer" }}
            checked={showApiKeys}
            onChange={(e) => setShowApiKeys(e.target.checked)}
          />
          <label htmlFor="setting-show-keys-jm" style={{ cursor: "pointer", fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
            {language === "zh" ? "显示明文" : "Show plain text"}
          </label>
        </div>

        <div className="model-capability-card" style={{ marginTop: "12px" }}>
          <span className="card-title">{language === "zh" ? "即梦绑定及长期记忆说明" : "Jimeng CLI Memory Instructions"}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, padding: "4px" }}>
            <p>
              {language === "zh" ? (
                <>1. 此处绑定的 Token / Cookie 将安全地进行本地强加密，不会上传至第三方服务器。</>
              ) : (
                <>1. The Token / Cookie configured here will be safely encrypted locally and never uploaded to third-party servers.</>
              )}
            </p>
            <p>
              {language === "zh" ? (
                <>2. 绑定后，该凭证将作为<strong>系统长期记忆</strong>自动注入到所有新对话中。即使切换对话或重启应用，Agent 也会永久记住此绑定。</>
              ) : (
                <>2. Once bound, this credential is automatically injected into all conversations as a <strong>system permanent memory</strong>. The Agent will remember this binding even after switching chats or restarting.</>
              )}
            </p>
            <p>
              {language === "zh" ? (
                <>3. 当在对话中请求生成或操作图片时，Agent 将能直接调用本地绑定的即梦 CLI 命令进行无缝图像渲染与输出。</>
              ) : (
                <>3. When image generation or manipulation is requested, the Agent can directly invoke the local Jimeng CLI commands using this credential for seamless image rendering and output.</>
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
