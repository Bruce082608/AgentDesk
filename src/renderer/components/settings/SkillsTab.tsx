import { useState } from "react";
import { LoaderCircle, AlertCircle, Sparkles } from "lucide-react";
import type { Language } from "../../i18n";
import type { ProviderConfig } from "../../types";
import { SkillEditor } from "./SkillEditor";

type SkillsTabProps = {
  language: Language;
  skills: any[];
  loadingSkills: boolean;
  editingSkill: any;
  setEditingSkill: (skill: any) => void;
  handleToggleSkill: (skillId: string, enabled: boolean) => void;
  handleDeleteSkill: (skillId: string) => void;
  handleSaveSkill: (skill: any) => void;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  showApiKeys: boolean;
  setShowApiKeys: (show: boolean) => void;
};

export function SkillsTab({
  language,
  skills,
  loadingSkills,
  editingSkill,
  setEditingSkill,
  handleToggleSkill,
  handleDeleteSkill,
  handleSaveSkill,
  config,
  setConfig,
  showApiKeys,
  setShowApiKeys
}: SkillsTabProps) {
  const [showJimengConfig, setShowJimengConfig] = useState(false);

  return (
    <section className="settings-section">
      <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h4>{language === "zh" ? "技能管理 (Skills)" : "Skills Management"}</h4>
          <p>{language === "zh" ? "配置定时自动触发的开发或查询任务（支持自然语言或 JS 代码）" : "Configure scheduled developer or query tasks using prompts or code"}</p>
        </div>
        {!editingSkill && (
          <button
            className="test-btn"
            onClick={() => setEditingSkill({ title: "", description: "", enabled: true, type: "prompt", prompt: "", code: "", intervalMinutes: 60 })}
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            {language === "zh" ? "+ 新建技能" : "+ New Skill"}
          </button>
        )}
      </div>

      <div className="settings-group scrollable-group" style={{ maxHeight: "460px", overflowY: "auto" }}>
        {editingSkill ? (
          <SkillEditor
            editingSkill={editingSkill}
            setEditingSkill={setEditingSkill}
            language={language}
            handleSaveSkill={handleSaveSkill}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
            {/* Built-in Jimeng CLI Binding Skill */}
            {!loadingSkills && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "12px",
                  backgroundColor: "var(--card-bg)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, marginRight: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", fontWeight: 600, fontSize: "13px", color: "var(--text-primary)" }}>
                        <Sparkles size={14} style={{ color: "#8b5cf6" }} />
                        <span>{language === "zh" ? "即梦 AIGC 技能 (Jimeng CLI)" : "Jimeng AIGC Skill (Jimeng CLI)"}</span>
                      </div>
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: "rgba(139, 92, 246, 0.15)",
                          color: "#8b5cf6",
                          fontWeight: 600
                        }}
                      >
                        {language === "zh" ? "系统内置" : "Built-in"}
                      </span>
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      {language === "zh" ? "绑定即梦 CLI，为 Agent 赋予生成图片、视频及图像放大等高级 AIGC 技能。" : "Bind Jimeng CLI to empower the Agent with text-to-image, video, and image upscale AIGC skills."}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <button
                      onClick={() => setShowJimengConfig(!showJimengConfig)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        fontSize: "11px",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontWeight: 600
                      }}
                    >
                      {showJimengConfig ? (language === "zh" ? "收起" : "配置") : (language === "zh" ? "配置" : "Configure")}
                    </button>
                  </div>
                </div>

                {showJimengConfig && (
                  <div style={{
                    marginTop: "8px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--border-color)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px"
                  }}>
                    <div className="settings-field" style={{ margin: 0 }}>
                      <label htmlFor="setting-jimeng-token-skills">{language === "zh" ? "即梦 Cookie / API Token" : "Jimeng Cookie / API Token"}</label>
                      <input
                        id="setting-jimeng-token-skills"
                        type={showApiKeys ? "text" : "password"}
                        placeholder={language === "zh" ? "输入您的即梦 API Key 或 Cookie 值 (例如 sessionid，可选)" : "Enter your Jimeng API Key or Cookie (e.g. sessionid, optional)"}
                        value={config.jimengToken || ""}
                        onChange={(e) => setConfig({ ...config, jimengToken: e.target.value })}
                      />
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "-4px" }}>
                      <input
                        id="setting-show-keys-jm-skills"
                        type="checkbox"
                        style={{ width: "14px", height: "14px", cursor: "pointer" }}
                        checked={showApiKeys}
                        onChange={(e) => setShowApiKeys(e.target.checked)}
                      />
                      <label htmlFor="setting-show-keys-jm-skills" style={{ cursor: "pointer", fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
                        {language === "zh" ? "显示明文" : "Show plain text"}
                      </label>
                    </div>

                    <div style={{
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      lineHeight: "1.5",
                      padding: "10px",
                      backgroundColor: "rgba(139, 92, 246, 0.05)",
                      border: "1px solid rgba(139, 92, 246, 0.15)",
                      borderRadius: "6px"
                    }}>
                      {language === "zh" ? (
                        <>
                          <strong>💡 长久登录说明</strong>：最新版即梦 CLI 已全面支持 OAuth 扫码登录。若要使绑定长期有效，建议您在终端中执行以下命令完成一次性扫码：
                          <pre style={{ margin: "6px 0 0 0", padding: "6px", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "4px", fontSize: "10px", overflowX: "auto" }}>
                            /Users/bruce/.local/bin/dreamina login
                          </pre>
                          扫码成功后，本应用即可长期检测并共享该登录态。此处 Cookie / Token 输入框仅供旧版脚本或自定义场景使用。
                        </>
                      ) : (
                        <>
                          <strong>💡 Long-term Login Info</strong>: The latest Jimeng CLI supports OAuth Scan login. Run the following command in terminal to authorize once for persistent access:
                          <pre style={{ margin: "6px 0 0 0", padding: "6px", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "4px", fontSize: "10px", overflowX: "auto" }}>
                            /Users/bruce/.local/bin/dreamina login
                          </pre>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {loadingSkills && (
              <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
                <LoaderCircle className="animate-spin" size={20} />
              </div>
            )}
            {!loadingSkills && skills.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", color: "var(--text-muted)", fontSize: "12px" }}>
                <AlertCircle size={24} style={{ marginBottom: "8px" }} />
                <p>{language === "zh" ? "目前还没有添加任何定时技能" : "No scheduled skills added yet"}</p>
              </div>
            )}
            {!loadingSkills && skills.map((skill) => (
              <div
                key={skill.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px",
                  backgroundColor: "var(--card-bg)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px"
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, marginRight: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)" }}>{skill.title}</span>
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        backgroundColor: skill.type === "prompt" ? "rgba(38, 99, 235, 0.15)" : "rgba(16, 185, 129, 0.15)",
                        color: skill.type === "prompt" ? "#3b82f6" : "#10b981"
                      }}
                    >
                      {skill.type === "prompt" ? "Prompt" : "Code"}
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{skill.description || "无描述"}</span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    {language === "zh" ? `执行周期: 每 ${skill.intervalMinutes} 分钟` : `Interval: Every ${skill.intervalMinutes}m`}
                    {skill.lastRunAt > 0 && ` | ${language === "zh" ? "上次运行: " : "Last Run: "}${new Date(skill.lastRunAt).toLocaleTimeString()}`}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={(e) => handleToggleSkill(skill.id, e.target.checked)}
                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <button
                    onClick={() => setEditingSkill(skill)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "4px 8px",
                      borderRadius: "4px"
                    }}
                  >
                    {language === "zh" ? "编辑" : "Edit"}
                  </button>
                  <button
                    onClick={() => handleDeleteSkill(skill.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#ef4444",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "4px 8px",
                      borderRadius: "4px"
                    }}
                  >
                    {language === "zh" ? "删除" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
