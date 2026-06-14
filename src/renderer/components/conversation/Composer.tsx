import { useState, useRef, type RefObject } from "react";
import { X, Plus, Mic, Square, Send, ChevronDown } from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { AttachedFile, ContextCompressionState } from "../../types";
import { formatAttachmentTitle, formatAttachmentStatus } from "./conversation-utils";

type Translation = typeof translations[keyof typeof translations];

type ComposerProps = {
  input: string;
  setInput: (value: string) => void;
  send: () => void;
  busy: boolean;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  textareaHeight: number;
  language: Language;
  t: Translation;
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
  composerInputRef,
  textareaHeight,
  language,
  t,
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
  const toggleRecording = async () => {
    composerInputRef.current?.focus();

    try {
      const result = await window.agentWindow.startDictation();
      if (result && !result.ok) {
        alert(language === "zh"
          ? `语音输入启动失败: ${result.error || "未知错误"}`
          : `Voice input failed: ${result.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Failed to trigger dictation:", err);
    }
  };

  return (
    <footer className="composer">
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
          placeholder=""
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
          <div className="composer-controls-left">
            <button
              className="composer-icon attach-btn"
              type="button"
              disabled={busy}
              onClick={uploadAttachmentFiles}
              title={t.uploadFiles}
              aria-label={t.uploadFiles}
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>

            <div className="permission-dropdown-container" title={hasAutoPermissions ? t.fullAccessPermissionHint : t.defaultPermissionHint}>
              <select
                value={fullAccessEnabled ? "full" : "default"}
                onChange={(e) => updatePermissionMode(e.target.value as "default" | "full")}
                title={t.permissionMode}
                aria-label={t.permissionMode}
              >
                <option value="default">{t.defaultPermission}</option>
                <option value="full">{t.fullAccessPermission}</option>
              </select>
              <ChevronDown size={11} strokeWidth={2.5} className="dropdown-chevron" />
            </div>

            <span
              className="composer-context-badge"
              title={`${t.contextUsage}: ${Math.round(sessionContextTokenCount).toLocaleString(language === "zh" ? "zh-CN" : "en-US")} / ${Math.round(configContextTokens).toLocaleString(language === "zh" ? "zh-CN" : "en-US")} tokens`}
            >
              {contextUsageLabel}
            </span>
          </div>

          <div className="composer-controls-right">
            {!isOnline && <span className="offline-pill">{t.offlineTitle}</span>}

            <button
              className="composer-icon mic-btn"
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleRecording}
              title={language === "zh" ? "语音输入" : "Voice Input"}
              aria-label="Voice Input"
            >
              <Mic size={15} strokeWidth={2.4} />
            </button>

            {busy && (
              <button className="composer-icon stop-btn danger" type="button" onClick={cancelActiveRequest} title={t.stop} aria-label={t.stop}>
                <Square size={13} strokeWidth={2.6} aria-hidden="true" />
              </button>
            )}

            {input.trim().length > 0 && (
              <button className="send composer-send" type="button" disabled={busy} onClick={send} title={t.send} aria-label={t.send}>
                <Send size={14} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
