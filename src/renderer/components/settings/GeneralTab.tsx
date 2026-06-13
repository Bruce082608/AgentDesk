import type { Language, translations } from "../../i18n";
import type { ThemeMode } from "../../types";

type Translation = typeof translations[keyof typeof translations];

type GeneralTabProps = {
  language: Language;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (lang: Language) => void;
  t: Translation;
};

export function GeneralTab({
  language,
  theme,
  setTheme,
  setLanguage,
  t
}: GeneralTabProps) {
  return (
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
  );
}
