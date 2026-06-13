import type { Language } from "../../i18n";

type SkillEditorProps = {
  editingSkill: any;
  setEditingSkill: (skill: any) => void;
  language: Language;
  handleSaveSkill: (skill: any) => void;
};

export function SkillEditor({
  editingSkill,
  setEditingSkill,
  language,
  handleSaveSkill
}: SkillEditorProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
      <div className="settings-field">
        <label>{language === "zh" ? "技能标题" : "Title"}</label>
        <input
          type="text"
          placeholder={language === "zh" ? "例如: ETH 价格追踪" : "e.g. ETH Price Tracker"}
          value={editingSkill.title || ""}
          onChange={(e) => setEditingSkill({ ...editingSkill, title: e.target.value })}
        />
      </div>

      <div className="settings-field">
        <label>{language === "zh" ? "描述信息" : "Description"}</label>
        <input
          type="text"
          placeholder={language === "zh" ? "简单描述下此技能的用途" : "Brief description of the skill"}
          value={editingSkill.description || ""}
          onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
        />
      </div>

      <div className="settings-field">
        <label>{language === "zh" ? "定时触发间隔 (分钟)" : "Interval (Minutes)"}</label>
        <input
          type="number"
          min="1"
          placeholder="60"
          value={editingSkill.intervalMinutes || ""}
          onChange={(e) => setEditingSkill({ ...editingSkill, intervalMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
        />
      </div>

      <div className="settings-field">
        <label>{language === "zh" ? "技能类型" : "Type"}</label>
        <div className="select-wrapper">
          <select
            value={editingSkill.type || "prompt"}
            onChange={(e) => setEditingSkill({ ...editingSkill, type: e.target.value as any })}
          >
            <option value="prompt">{language === "zh" ? "对话 Prompt (调用 Agent 运行)" : "Agent Prompt"}</option>
            <option value="code">{language === "zh" ? "Node.js 代码" : "Node.js Code"}</option>
          </select>
        </div>
      </div>

      {editingSkill.type === "prompt" ? (
        <div className="settings-field">
          <label>{language === "zh" ? "对话 Prompt 指令" : "Prompt Instruction"}</label>
          <textarea
            style={{
              width: "100%",
              height: "100px",
              backgroundColor: "var(--input-bg)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              padding: "8px",
              fontSize: "12px",
              resize: "vertical",
              fontFamily: "inherit"
            }}
            placeholder={language === "zh" ? "在此输入要求 Agent 定时执行的任务提示词..." : "Enter prompt instruction for the Agent..."}
            value={editingSkill.prompt || ""}
            onChange={(e) => setEditingSkill({ ...editingSkill, prompt: e.target.value })}
          />
        </div>
      ) : (
        <div className="settings-field">
          <label>{language === "zh" ? "JS 源代码" : "JavaScript Code"}</label>
          <textarea
            style={{
              width: "100%",
              height: "140px",
              backgroundColor: "var(--input-bg)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              padding: "8px",
              fontSize: "11px",
              fontFamily: "monospace",
              resize: "vertical"
            }}
            placeholder="// Node.js Code here..."
            value={editingSkill.code || ""}
            onChange={(e) => setEditingSkill({ ...editingSkill, code: e.target.value })}
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
        <button
          className="test-btn"
          style={{ backgroundColor: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)" }}
          onClick={() => setEditingSkill(null)}
        >
          {language === "zh" ? "取消" : "Cancel"}
        </button>
        <button
          className="test-btn"
          disabled={!editingSkill.title || (editingSkill.type === "prompt" ? !editingSkill.prompt : !editingSkill.code)}
          onClick={() => handleSaveSkill(editingSkill)}
        >
          {language === "zh" ? "保存" : "Save"}
        </button>
      </div>
    </div>
  );
}
