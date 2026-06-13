import type { RefObject } from "react";
import { X, Paperclip, Square, Send } from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { AttachedFile, ContextCompressionState } from "../../types";
import { formatAttachmentTitle, formatAttachmentStatus } from "./conversation-utils";

type Translation = typeof translations[keyof typeof translations];

type ComposerProps = {
  input: string;
  setInput: (value: string) => void;
  send: () => void;
  busy: boolean;
  composerHeight: number;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  textareaHeight: number;
  language: Language;
  t: Translation;
  startComposerResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  contextCompression: ContextCompressionState;
  contextCompressionStatus: string;
  attachedFiles: AttachedFile[];
  detachFile: (path: string) => void;
  hasAutoPermissions: boolean;
  fullAccessEnabled: boolean;
  updatePermissionMode: (mode: "default" | "full") => void;
  autoPermissionTitle: string;
  isOnline: boolean;
  contextPercent: number;
  sessionContextTokenCount: number;
  configContextTokens: number;
  contextUsageLabel: string;
  uploadAttachmentFiles: () => void;
  cancelActiveRequest: () => void;
};

export function Composer({
  input,
  setInput,
  send,
  busy,
  composerHeight,
  composerInputRef,
  textareaHeight,
  language,
  t,
  startComposerResize,
  contextCompression,
  contextCompressionStatus,
  attachedFiles,
  detachFile,
  hasAutoPermissions,
  fullAccessEnabled,
  updatePermissionMode,
  autoPermissionTitle,
  isOnline,
  contextPercent,
  sessionContextTokenCount,
  configContextTokens,
  contextUsageLabel,
  uploadAttachmentFiles,
  cancelActiveRequest
}: ComposerProps) {
  return (
    <footer className="composer" style={input.length > 0 ? { height: "auto" } : { height: `${composerHeight + 30}px` }}>
      <div
        className="composer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={language === "zh" ? "调整底部对话框高度" : "Resize composer height"}
        onPointerDown={startComposerResize}
      />
      <div className="composer-surface">
        {contextCompression.phase !== "idle" && (
          <details className={`composer-compression ${contextCompression.phase}`} open={contextCompression.phase === "start" || contextCompression.phase === "failed"}>
            <summary>
              <span className="compression-dot" />
              <span>{contextCompressionStatus || contextCompression.message}</span>
            </summary>
            {contextCompression.summary ? (
              <pre>{contextCompression.summary}</pre>
            ) : (
              <p>{contextCompression.message}</p>
            )}
          </details>
        )}
        {attachedFiles.length > 0 && (
          <div className="composer-attachments">
            {attachedFiles.map((file) => {
              const isImage = file.content?.startsWith("data:image/");
              return (
                <button key={file.path} type="button" onClick={() => detachFile(file.path)} title={formatAttachmentTitle(file, language, t.removeContextTitle)}>
                  {isImage && (
                    <img
                      src={file.content}
                      alt="preview"
                      style={{
                        width: "16px",
                        height: "16px",
                        objectFit: "cover",
                        borderRadius: "3px",
                        marginRight: "4px"
                      }}
                    />
                  )}
                  <span className="attachment-name">{file.path}</span>
                  <span className={`attachment-badge ${file.status || "ready"}`}>{formatAttachmentStatus(file, language)}</span>
                  {file.duplicateCount && file.duplicateCount > 1 && <span className="attachment-badge duplicate">×{file.duplicateCount}</span>}
                  <X size={13} strokeWidth={2.4} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
        <textarea
          ref={composerInputRef}
          value={input}
          placeholder={t.composerPlaceholder}
          onChange={(event) => setInput(event.target.value)}
          style={input.length > 0 ? { height: `${textareaHeight}px` } : undefined}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-controls">
          <div className="permission-segment" title={hasAutoPermissions ? t.fullAccessPermissionHint : t.defaultPermissionHint} aria-label={t.permissionMode}>
            <button
              type="button"
              className={!fullAccessEnabled ? "active" : ""}
              onClick={() => updatePermissionMode("default")}
            >
              {t.defaultPermission}
            </button>
            <button
              type="button"
              className={fullAccessEnabled ? "active" : ""}
              onClick={() => updatePermissionMode("full")}
            >
              {t.fullAccessPermission}
            </button>
          </div>
          {hasAutoPermissions && (
            <span className="permission-status" title={autoPermissionTitle}>
              {language === "zh" ? "当前会话完全访问" : "Full access for session"}
            </span>
          )}
          <div className="composer-actions">
            {!isOnline && <span className="offline-pill">{t.offlineTitle}</span>}
            <span
              className={`context-meter ${contextPercent >= 90 ? "danger" : contextPercent >= 70 ? "warn" : ""}`}
              title={`${t.contextUsage}: ${Math.round(sessionContextTokenCount).toLocaleString(language === "zh" ? "zh-CN" : "en-US")} / ${Math.round(configContextTokens).toLocaleString(language === "zh" ? "zh-CN" : "en-US")} tokens`}
            >
              {contextUsageLabel}
            </span>
            <button className="composer-icon" type="button" disabled={busy} onClick={uploadAttachmentFiles} title={t.uploadFiles} aria-label={t.uploadFiles}>
              <Paperclip size={17} strokeWidth={2.4} aria-hidden="true" />
            </button>
            {busy && (
              <button className="composer-icon danger" type="button" onClick={cancelActiveRequest} title={t.stop} aria-label={t.stop}>
                <Square size={15} strokeWidth={2.6} aria-hidden="true" />
              </button>
            )}
            <button className="send composer-send" type="button" disabled={busy || !input.trim()} onClick={send} title={t.send} aria-label={t.send}>
              <Send size={18} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
