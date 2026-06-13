import type { Language } from "../../i18n";
import type { ProviderConfig } from "../../types";

type TelegramTabProps = {
  language: Language;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  showApiKeys: boolean;
  setShowApiKeys: (show: boolean) => void;
};

export function TelegramTab({
  language,
  config,
  setConfig,
  showApiKeys,
  setShowApiKeys
}: TelegramTabProps) {
  return (
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
  );
}
