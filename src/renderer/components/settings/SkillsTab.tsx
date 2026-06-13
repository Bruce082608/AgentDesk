import { LoaderCircle, AlertCircle } from "lucide-react";
import type { Language } from "../../i18n";
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
};

export function SkillsTab({
  language,
  skills,
  loadingSkills,
  editingSkill,
  setEditingSkill,
  handleToggleSkill,
  handleDeleteSkill,
  handleSaveSkill
}: SkillsTabProps) {
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
