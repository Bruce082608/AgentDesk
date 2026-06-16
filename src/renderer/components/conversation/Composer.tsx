import { useEffect, useState, useRef, type KeyboardEvent, type RefObject } from "react";
import { X, Plus, Mic, Square, Send, ChevronDown } from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { AttachedFile, ContextCompressionState, PlanItem, ToolRun } from "../../types";
import { formatAttachmentTitle, formatAttachmentStatus } from "./conversation-utils";
import type { UserQuestionItem } from "../../types";

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
  planItems?: PlanItem[];
  activeToolRuns?: ToolRun[];
  activeQuestion?: UserQuestionItem | null;
  answerQuestion: (questionId: string, option: string) => void;
  dismissQuestion: (questionId: string) => void;
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
  cancelActiveRequest,
  planItems,
  activeToolRuns,
  activeQuestion,
  answerQuestion,
  dismissQuestion
}: ComposerProps) {
  const [questionInput, setQuestionInput] = useState("");
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

  const completedSteps = planItems ? planItems.filter(item => item.status === "completed").length : 0;
  const totalSteps = planItems ? planItems.length : 0;
  const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const currentStep = planItems ? planItems.find(item => item.status === "in_progress") : null;
  const question = activeQuestion || null;
  const questionOptions = question?.options || [];
  const questionMode = Boolean(question);
  const selectedOption = (raw: string) => {
    const currentQuestion = question;
    if (!currentQuestion) return;
    const text = raw.trim();
    if (!text) return;
    const match = text.match(/^(\d+)$/);
    if (match) {
      const index = Number(match[1]) - 1;
      if (index >= 0 && index < questionOptions.length) {
        answerQuestion(currentQuestion.id, questionOptions[index]);
        return;
      }
    }
    answerQuestion(currentQuestion.id, text);
  };

  useEffect(() => {
    if (!question) {
      setQuestionInput("");
      return;
    }
    setQuestionInput("");
    composerInputRef.current?.focus();
  }, [question, composerInputRef]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (questionMode) {
        selectedOption(questionInput);
      } else {
        send();
      }
      return;
    }
    if (questionMode && event.altKey && event.key === "Backspace" && !questionInput) {
      event.preventDefault();
      if (question) dismissQuestion(question.id);
      return;
    }
    if (questionMode && /^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < questionOptions.length) {
        event.preventDefault();
        if (question) answerQuestion(question.id, questionOptions[index]);
      }
    }
  };
  const submitComposer = () => {
    if (questionMode) {
      selectedOption(questionInput);
    } else {
      send();
    }
  };

  return (
    <footer className="composer">
      {planItems && planItems.length > 0 && (
        <div className="composer-plan">
          <div className="composer-plan-header">
            <span className="composer-plan-title">
              {language === "zh" ? "执行计划" : "Execution Plan"}: {completedSteps}/{totalSteps} ({percent}%)
            </span>
            {currentStep && (
              <span className="composer-plan-current">
                {language === "zh" ? "当前步骤: " : "Current: "}{currentStep.step}
                {activeToolRuns && activeToolRuns.length > 0 && (
                  <span className="composer-plan-active-tool">
                    &nbsp;({language === "zh" ? "执行中: " : "Running: "}<code>{activeToolRuns[0].name}</code>)
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="composer-plan-steps">
            {planItems.map((item, index) => (
              <span key={index} className={`composer-plan-step-pill ${item.status}`} title={item.step}>
                <span className="step-pill-dot" />
                <span className="step-pill-text">{item.step}</span>
              </span>
            ))}
          </div>
        </div>
      )}
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
        {question && (
          <div className="composer-question-shell">
            <div className="composer-question-header">
              <span className="composer-question-label">{language === "zh" ? "Agent 正在提问" : "Agent is asking"}</span>
              <button
                type="button"
                className="secondary tiny icon-text-button"
                disabled={busy}
                onClick={() => dismissQuestion(question.id)}
              >
                <X size={12} strokeWidth={2.6} aria-hidden="true" />
                <span>{t.dismiss}</span>
              </button>
            </div>
            <div className="composer-question-text">{question.question}</div>
            {question.context && <div className="composer-question-context">{question.context}</div>}
            <div className="composer-question-options">
              {questionOptions.map((option, index) => (
                <button
                  type="button"
                  className="composer-question-option"
                  key={option}
                  disabled={busy}
                  onClick={() => answerQuestion(question.id, option)}
                >
                  <span className="question-option-index">{index + 1}</span>
                  <span className="question-option-text">{option}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          ref={composerInputRef}
          value={questionMode ? questionInput : input}
          placeholder={questionMode ? (language === "zh" ? "输入回复或按数字键选择选项" : "Type a reply or press a number") : ""}
          onChange={(event) => {
            if (questionMode) {
              setQuestionInput(event.target.value);
            } else {
              setInput(event.target.value);
            }
          }}
          style={!questionMode && input.length > 0 ? { height: `${textareaHeight}px` } : undefined}
          onKeyDown={handleComposerKeyDown}
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

            {((questionMode ? questionInput : input).trim().length > 0) && (
              <button className="send composer-send" type="button" disabled={busy} onClick={submitComposer} title={t.send} aria-label={t.send}>
                <Send size={14} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
