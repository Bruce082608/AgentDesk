import { TriangleAlert } from "lucide-react";
import type { Language } from "../../i18n";

type GitUpdateModalProps = {
  language: Language;
  show: boolean;
  message: string;
  onClose: () => void;
  onRetry: () => void;
  onForceUpdate: () => void;
};

export function GitUpdateModal({
  language,
  show,
  message,
  onClose,
  onRetry,
  onForceUpdate
}: GitUpdateModalProps) {
  if (!show) return null;

  return (
    <div className="git-update-modal-overlay">
      <div className="git-update-modal-container">
        <div className="git-update-modal-header">
          <TriangleAlert className="error-icon" size={18} strokeWidth={2.5} />
          <h3>{language === "zh" ? "更新失败" : "Update Failed"}</h3>
        </div>
        <div className="git-update-modal-body">
          <p style={{ margin: "0 0 12px 0" }}>
            {language === "zh"
              ? "在从 GitHub 拉取代码时遇到了一个错误。如果本地存在未提交的修改，可能会导致更新冲突。"
              : "An error occurred while pulling updates from GitHub. Local uncommitted modifications might cause conflicts."}
          </p>
          <div className="git-update-modal-error-box">
            {message}
          </div>
        </div>
        <div className="git-update-modal-actions">
          <button
            type="button"
            className="cancel-btn"
            onClick={onClose}
          >
            {language === "zh" ? "取消" : "Cancel"}
          </button>
          <button
            type="button"
            className="retry-btn"
            onClick={onRetry}
          >
            {language === "zh" ? "重试" : "Retry"}
          </button>
          <button
            type="button"
            className="force-btn"
            onClick={onForceUpdate}
          >
            {language === "zh" ? "强制更新 (丢弃本地修改)" : "Force Update (Discard Local)"}
          </button>
        </div>
      </div>
    </div>
  );
}
