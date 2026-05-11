import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import {
  ArrowDown,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Clock3,
  Copy,
  FileDiff,
  FileText,
  Files,
  ListTodo,
  LoaderCircle,
  MessageSquareMore,
  Paperclip,
  PenLine,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Terminal,
  TriangleAlert,
  Workflow,
  X
} from "lucide-react";
import type { Language, translations } from "../i18n";
import type { AttachedFile, ChatMessage, ContextCompressionState, ReasoningView, StreamRecoveryStatus, TaskStatus, ToolDraft, ToolRun } from "../types";
import { CodeBlock, MarkdownContent, formatToolDraftText } from "../utils";
import { ApprovalPanel } from "./ApprovalPanel";
import type { CommandItem, PatchItem, UserQuestionItem } from "../types";

type Translation = typeof translations[keyof typeof translations];

type ConversationProps = {
  activeCommands: CommandItem[];
  activePatches: PatchItem[];
  activeQuestions: UserQuestionItem[];
  activeToolRuns: ToolRun[];
  answerQuestion: (questionId: string, option: string) => void;
  approveCommand: (commandId: string, allowFuture?: boolean) => void;
  applyPatch: (patchId: string) => void;
  attachFile: (path: string) => void;
  attachDroppedFiles: (files: File[]) => Promise<void>;
  attachedFiles: AttachedFile[];
  busy: boolean;
  cancelActiveRequest: () => void;
  chooseWorkspace: () => void;
  commandAutoApproval: boolean;
  commandAutoApprovalExpiresAt?: number | null;
  composerHeight: number;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  configContextTokens: number;
  contextCompression: ContextCompressionState;
  contextCompressionStatus: string;
  contextPercent: number;
  contextUsageLabel: string;
  detachFile: (path: string) => void;
  discardCommand: (commandId: string) => void;
  discardPatch: (patchId: string) => void;
  dismissQuestion: (questionId: string) => void;
  input: string;
  isOnline: boolean;
  language: Language;
  messageListRef: RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  patchAutoApproval: boolean;
  patchAutoApprovalExpiresAt?: number | null;
  previewFile: AttachedFile | null;
  reasoningViews: Record<string, ReasoningView>;
  regenerateMessage: (index: number) => void;
  resetCommandAutoApproval: () => void;
  retryLastRequest: () => void;
  retryRequestPending: boolean;
  send: () => void;
  sessionContextTokenCount: number;
  setInput: (value: string) => void;
  setLanguage: (language: Language) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  startComposerResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  streamRecoveryStatus: StreamRecoveryStatus | null;
  streamingResponse: boolean;
  t: Translation;
  theme: "light" | "dark" | "system";
  toolDraft: ToolDraft | null;
  showScrollToBottom: boolean;
  scrollToBottom: () => void;
  taskStatus: TaskStatus;
  updatePermissionMode: (mode: "default" | "full") => void;
  updateReasoningView: (key: string, view: ReasoningView) => void;
  uploadAttachmentFiles: () => void;
  workspace: string;
  copyMessage: (message: ChatMessage) => void;
};

export function Conversation({
  activeCommands,
  activePatches,
  activeQuestions,
  activeToolRuns,
  answerQuestion,
  approveCommand,
  applyPatch,
  attachFile,
  attachDroppedFiles,
  attachedFiles,
  busy,
  cancelActiveRequest,
  chooseWorkspace,
  commandAutoApproval,
  commandAutoApprovalExpiresAt,
  composerHeight,
  composerInputRef,
  configContextTokens,
  contextCompression,
  contextCompressionStatus,
  contextPercent,
  contextUsageLabel,
  copyMessage,
  detachFile,
  discardCommand,
  discardPatch,
  dismissQuestion,
  input,
  isOnline,
  language,
  messageListRef,
  messages,
  patchAutoApproval,
  patchAutoApprovalExpiresAt,
  previewFile,
  reasoningViews,
  regenerateMessage,
  resetCommandAutoApproval,
  retryLastRequest,
  retryRequestPending,
  send,
  sessionContextTokenCount,
  setInput,
  setLanguage,
  setTheme,
  startComposerResize,
  streamRecoveryStatus,
  streamingResponse,
  t,
  theme,
  toolDraft,
  showScrollToBottom,
  scrollToBottom,
  taskStatus,
  updatePermissionMode,
  updateReasoningView,
  uploadAttachmentFiles,
  workspace
}: ConversationProps) {
  const hasAutoPermissions = commandAutoApproval || patchAutoApproval;
  const fullAccessEnabled = commandAutoApproval && patchAutoApproval;
  const autoPermissionTitle = [
    language === "zh" ? "完全访问权限仅限当前会话和 workspace，直到你切回默认权限。" : "Full access is scoped to this chat and workspace until you switch back to default permissions.",
    commandAutoApproval ? (language === "zh" ? "命令无需审批。" : "Commands do not require approval.") : "",
    patchAutoApproval ? (language === "zh" ? "文件变更无需审批。" : "File changes do not require approval.") : ""
  ].filter(Boolean).join(" ");
  const streamingMessageIndex = streamingResponse ? getStreamingAssistantIndex(messages) : -1;
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (activeToolRuns.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [activeToolRuns.length]);

  const messageListContent = useMemo(() => (
    <>
      {messages.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-copy">
            <h2>{t.emptyTitle}</h2>
            <p>{t.emptyBody}</p>
          </div>
          <div className="empty-guide-actions">
            <button type="button" className="primary" disabled={busy} onClick={chooseWorkspace}>{t.chooseFolder}</button>
          </div>
        </div>
      )}
      {messages.map((message, index) => {
        if (message.role === "system") return null;
        if (message.role === "tool") {
          return (
            <ToolCallCard
              key={`${message.tool_call_id || message.name || "tool"}-${index}`}
              args={message.toolArgs || ""}
              copyLabel={t.copy}
              copiedLabel={t.copied}
              durationMs={message.durationMs}
              endedAt={message.endedAt}
              language={language}
              name={message.name || ""}
              result={message.content}
              startedAt={message.startedAt}
              status={message.toolStatus === "error" || isToolResultError(message.content) ? "error" : "completed"}
              title={formatMessageTimestamp(message.createdAt, language)}
            />
          );
        }
        if (message.role === "assistant" && !message.content && !message.reasoning && message.tool_calls?.length) return null;
        const reasoningKey = `${message.role}-${index}`;
        const reasoningView = reasoningViews[reasoningKey] || "collapsed";
        return (
          <article className={`message ${message.role}${index === streamingMessageIndex ? " streaming" : ""}`} key={`${message.role}-${index}`} title={formatMessageTimestamp(message.createdAt, language)}>
            <div className="message-meta">
              <div className="role">{message.role === "user" ? t.you : t.agent}</div>
              <div className="message-actions">
                <button type="button" onClick={() => copyMessage(message)} title={t.copy} aria-label={t.copy}>
                  <Copy size={14} strokeWidth={2.4} aria-hidden="true" />
                </button>
                {message.role === "assistant" && (
                  <button type="button" onClick={() => regenerateMessage(index)} disabled={busy} title={t.regenerate} aria-label={t.regenerate}>
                    <RefreshCcw size={14} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <div className="message-body">
              {message.reasoning && (
                <section className={`reasoning-block ${reasoningView}`}>
                  <div className="reasoning-header">
                    <button
                      type="button"
                      className="reasoning-title"
                      onClick={() => updateReasoningView(reasoningKey, reasoningView === "collapsed" ? "preview" : "collapsed")}
                      title={t.reasoning}
                      aria-label={t.reasoning}
                    >
                      <Workflow size={15} strokeWidth={2.3} aria-hidden="true" />
                      <span>{t.reasoning}</span>
                    </button>
                    <div className="reasoning-actions">
                      {reasoningView === "full" ? (
                        <button type="button" onClick={() => updateReasoningView(reasoningKey, "preview")} title={t.previewReasoning} aria-label={t.previewReasoning}>
                          <ChevronUp size={14} strokeWidth={2.4} aria-hidden="true" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => updateReasoningView(reasoningKey, "full")} title={t.expandReasoning} aria-label={t.expandReasoning}>
                          <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => updateReasoningView(reasoningKey, reasoningView === "collapsed" ? "preview" : "collapsed")}
                        title={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                        aria-label={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                      >
                        {reasoningView === "collapsed" ? <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" /> : <X size={14} strokeWidth={2.4} aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                  {reasoningView !== "collapsed" && <pre>{message.reasoning}</pre>}
                </section>
              )}
              {message.content ? <MarkdownContent content={message.content} copyLabel={t.copy} copiedLabel={t.copied} /> : null}
            </div>
          </article>
        );
      })}
      {activeToolRuns.map((tool) => (
        <ToolCallCard
          key={tool.id}
          args={tool.args}
          copyLabel={t.copy}
          copiedLabel={t.copied}
          durationMs={Math.max(0, now - tool.startedAt)}
          language={language}
          name={tool.name}
          startedAt={tool.startedAt}
          status="running"
          title={formatMessageTimestamp(tool.startedAt, language)}
        />
      ))}
      {toolDraft && busy && (
        <article className="message assistant tool-draft-message">
          <div className="message-meta">
            <div className="role">{t.writingCode}{toolDraft.name ? ` · ${toolDraft.name}` : ""}</div>
          </div>
          <div className="message-body">
            <div className="markdown-content">
              <CodeBlock code={formatToolDraftText(toolDraft.text)} language="json" copyLabel={t.copy} copiedLabel={t.copied} />
            </div>
          </div>
        </article>
      )}
      <ApprovalPanel
        activeCommands={activeCommands}
        activePatches={activePatches}
        activeQuestions={activeQuestions}
        answerQuestion={answerQuestion}
        approveCommand={approveCommand}
        applyPatch={applyPatch}
        busy={busy}
        commandAutoApproval={commandAutoApproval}
        discardCommand={discardCommand}
        discardPatch={discardPatch}
        dismissQuestion={dismissQuestion}
        language={language}
        resetCommandAutoApproval={resetCommandAutoApproval}
        t={t}
      />
      {contextCompressionStatus && (
        <div className="context-compression-status" role="status">
          <span className="compression-dot" />
          <span>{contextCompressionStatus}</span>
        </div>
      )}
      {taskStatus.phase !== "idle" && (
        <div className={`task-status-bar ${taskStatus.phase}`} role="status" aria-live="polite">
          <span className="task-status-icon" aria-hidden="true">
            <TaskStatusIcon phase={taskStatus.phase} />
          </span>
          <span className="task-status-copy">
            <strong>{taskStatus.label}</strong>
            {taskStatus.detail && <span>{taskStatus.detail}</span>}
          </span>
        </div>
      )}
      {streamRecoveryStatus && (
        <div className={`stream-recovery-status ${streamRecoveryStatus.recovering ? "recovering" : "failed"}`} role="status">
          <LoaderCircle className="status-icon spin" size={15} strokeWidth={2.4} aria-hidden="true" />
          <span>{streamRecoveryStatus.message}</span>
        </div>
      )}
      {retryRequestPending && (
        <div className="network-retry-banner" role="status">
          <span>{t.networkRestoredBody}</span>
          <button type="button" className="secondary tiny icon-text-button" disabled={busy} onClick={retryLastRequest}>
            <RefreshCcw size={13} strokeWidth={2.4} aria-hidden="true" />
            <span>{t.retryLastRequest}</span>
          </button>
        </div>
      )}
      {showScrollToBottom && (
        <button
          type="button"
          className="scroll-to-bottom"
          onClick={scrollToBottom}
          title={language === "zh" ? "滚动到底部" : "Scroll to bottom"}
          aria-label={language === "zh" ? "滚动到底部" : "Scroll to bottom"}
        >
          <ArrowDown size={17} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
      {busy && <div className="thinking">{t.thinking}</div>}
    </>
  ), [
    activeCommands,
    activePatches,
    activeQuestions,
    activeToolRuns,
    answerQuestion,
    approveCommand,
    applyPatch,
    busy,
    chooseWorkspace,
    commandAutoApproval,
    contextCompressionStatus,
    copyMessage,
    discardCommand,
    discardPatch,
    dismissQuestion,
    language,
    messages,
    now,
    reasoningViews,
    regenerateMessage,
    resetCommandAutoApproval,
    retryLastRequest,
    retryRequestPending,
    scrollToBottom,
    showScrollToBottom,
    streamRecoveryStatus,
    streamingMessageIndex,
    t,
    taskStatus,
    toolDraft,
    updateReasoningView,
    workspace
  ]);

  // ---- Drag-and-drop handlers ----
  // NOTE: must call preventDefault() BEFORE checking file types,
  // because on Windows the DataTransfer.types may not include "Files"
  // on dragenter, which would prevent the element from becoming a
  // valid drop target.  stopPropagation() ensures the document-level
  // dragover/drop handlers (which exist for Windows compat) don't
  // override our dropEffect or double-process the drop.
  function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    const dt = event.dataTransfer;
    if (!dt) return false;
    const items = Array.from(dt.items || []);
    if (items.some((item) => item.kind === "file")) return true;
    const types = Array.from(dt.types || []);
    if (types.includes("Files")) return true;
    // fallback: on Windows the "Files" type may be missing from types
    // even though files are actually being dragged
    if (dt.files && dt.files.length > 0) return true;
    return false;
  }

  function handleConversationDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!hasDraggedFiles(event)) return;
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function handleConversationDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!hasDraggedFiles(event)) return;
    if (!draggingFiles) setDraggingFiles(true);
    event.dataTransfer.dropEffect = "copy";
  }

  function handleConversationDragLeave(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }

  async function handleConversationDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    if (draggingFiles) setDraggingFiles(false);
    if (!hasDraggedFiles(event)) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) await attachDroppedFiles(files);
  }

  return (
    <main
      className="conversation"
      onDragEnter={handleConversationDragEnter}
      onDragOver={handleConversationDragOver}
      onDragLeave={handleConversationDragLeave}
      onDrop={handleConversationDrop}
    >
      <header className="topbar">
        <div>
          <strong>{t.agentSession}</strong>
          <span>{busy ? t.running : t.ready}</span>
        </div>
        <div className="topbar-actions">
          <label className="topbar-control">
            <span>{t.theme}</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value as "light" | "dark" | "system")}>
              <option value="light">{t.light}</option>
              <option value="dark">{t.dark}</option>
              <option value="system">{t.system}</option>
            </select>
          </label>
          <label className="topbar-control">
            <span>{t.language}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          {busy && (
            <button className="secondary danger icon-text-button" onClick={cancelActiveRequest}>
              <Square size={13} strokeWidth={2.5} aria-hidden="true" />
              <span>{t.stop}</span>
            </button>
          )}
        </div>
      </header>

      {previewFile && (
        <section className="context-strip">
          <details className="file-preview">
            <summary>
              <span>{previewFile.path}</span>
              <button className="icon-text-button" onClick={(event) => { event.preventDefault(); attachFile(previewFile.path); }}>
                <Paperclip size={13} strokeWidth={2.4} aria-hidden="true" />
                <span>{t.addContext}</span>
              </button>
            </summary>
            <pre>{previewFile.content}</pre>
          </details>
        </section>
      )}

      <div
        className={`message-list${draggingFiles ? " dragging-files" : ""}${messages.length === 0 ? " is-empty" : ""}`}
        ref={messageListRef}
      >
        {draggingFiles && (
          <div className="message-drop-zone" aria-hidden="true">
            <strong>{language === "zh" ? "松开以加入上下文" : "Drop to attach context"}</strong>
            <span>{language === "zh" ? "支持文本文件；过大或二进制文件会以说明占位。" : "Text files are read; large or binary files get a note."}</span>
          </div>
        )}
        {messageListContent}
      </div>

      <footer className="composer" style={{ height: `${composerHeight + 30}px` }}>
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
              {attachedFiles.map((file) => (
                <button key={file.path} type="button" onClick={() => detachFile(file.path)} title={formatAttachmentTitle(file, language, t.removeContextTitle)}>
                  <span className="attachment-name">{file.path}</span>
                  <span className={`attachment-badge ${file.status || "ready"}`}>{formatAttachmentStatus(file, language)}</span>
                  {file.duplicateCount && file.duplicateCount > 1 && <span className="attachment-badge duplicate">×{file.duplicateCount}</span>}
                  <X size={13} strokeWidth={2.4} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={composerInputRef}
            value={input}
            placeholder={t.composerPlaceholder}
            onChange={(event) => setInput(event.target.value)}
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
    </main>
  );
}

type ToolCardStatus = "running" | "completed" | "error";

type ToolCallCardProps = {
  args?: string;
  copiedLabel: string;
  copyLabel: string;
  durationMs?: number;
  endedAt?: number;
  language: Language;
  name: string;
  result?: string;
  startedAt?: number;
  status: ToolCardStatus;
  title?: string;
};

const ToolCallCard = memo(function ToolCallCard({ args, copiedLabel, copyLabel, durationMs, endedAt, language, name, result, startedAt, status, title }: ToolCallCardProps) {
  const parsedResult = parseToolPayload(result);
  const displayName = name || stringValue(parsedResult?.tool) || "tool";
  const effectiveStatus = status === "completed" && parsedResult?.ok === false ? "error" : status;
  const summary = summarizeToolCall(displayName, args, result, effectiveStatus, language);
  const argsCode = formatToolCardPayload(args);
  const resultCode = formatToolCardPayload(result);
  const statusLabel = toolStatusLabel(effectiveStatus, language);
  const actionLabel = toolActionLabel(displayName, language);
  const measuredDuration = durationMs ?? (startedAt && endedAt ? Math.max(0, endedAt - startedAt) : undefined);
  const durationLabel = formatDuration(measuredDuration, language);

  return (
    <details className={`tool-call-card ${effectiveStatus}`} open={effectiveStatus === "running" || effectiveStatus === "error"} title={title}>
      <summary>
        <span className={`tool-call-icon ${effectiveStatus}`} aria-hidden="true">
          <ToolIcon name={displayName} />
        </span>
        <span className="tool-call-copy">
          <span className="tool-call-name">{actionLabel}</span>
          <span className="tool-call-summary">{summary}</span>
        </span>
        <span className="tool-call-meta">
          {durationLabel && (
            <span className="tool-call-duration">
              <Clock3 size={12} strokeWidth={2.4} aria-hidden="true" />
              {durationLabel}
            </span>
          )}
          <span className={`tool-call-status ${effectiveStatus}`}>{statusLabel}</span>
        </span>
      </summary>
      <div className="tool-call-details">
        {argsCode && (
          <div className="tool-call-section">
            <div className="tool-call-section-title">{language === "zh" ? "参数" : "Args"}</div>
            <CodeBlock code={argsCode} language="json" copyLabel={copyLabel} copiedLabel={copiedLabel} />
          </div>
        )}
        {resultCode && (
          <div className="tool-call-section">
            <div className="tool-call-section-title">{effectiveStatus === "error" ? (language === "zh" ? "错误" : "Error") : (language === "zh" ? "结果" : "Result")}</div>
            <CodeBlock code={resultCode} language="json" copyLabel={copyLabel} copiedLabel={copiedLabel} />
          </div>
        )}
      </div>
    </details>
  );
});

function TaskStatusIcon({ phase }: { phase: TaskStatus["phase"] }) {
  if (phase === "searching") return <Files size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "editing") return <PenLine size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "waiting") return <ShieldCheck size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "running") return <Terminal size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "completed") return <CheckCircle2 size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "error") return <TriangleAlert size={16} strokeWidth={2.4} aria-hidden="true" />;
  return <LoaderCircle className="status-icon spin" size={16} strokeWidth={2.4} aria-hidden="true" />;
}

function ToolIcon({ name }: { name: string }) {
  const normalized = String(name || "").toLowerCase();
  const props = { size: 15, strokeWidth: 2.35, "aria-hidden": true as const };
  if (normalized === "list_files") return <Files {...props} />;
  if (normalized === "read_file") return <FileText {...props} />;
  if (normalized === "search_files" || normalized === "web_search") return <Search {...props} />;
  if (normalized === "run_command") return <Terminal {...props} />;
  if (normalized === "apply_patch") return <FileDiff {...props} />;
  if (normalized === "write_file" || normalized === "delete_file") return <PenLine {...props} />;
  if (normalized === "ask_user") return <MessageSquareMore {...props} />;
  if (normalized === "update_plan") return <ListTodo {...props} />;
  if (normalized === "system_clipboard") return <ClipboardPaste {...props} />;
  if (normalized === "system_notify") return <Bell {...props} />;
  if (normalized === "background_task") return <Clock3 {...props} />;
  if (normalized === "system_window_info") return <Workflow {...props} />;
  return <Workflow {...props} />;
}

function formatMessageTimestamp(timestamp: number | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "未记录时间" : "Timestamp not recorded";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(timestamp);
}

function formatDuration(durationMs: number | undefined, language: Language) {
  if (!Number.isFinite(durationMs) || Number(durationMs) < 0) return "";
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const value = Number(durationMs);
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`;
  if (value < 60000) {
    return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: value < 10000 ? 1 : 0 })}s`;
  }
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function toolStatusLabel(status: ToolCardStatus, language: Language) {
  if (status === "running") return language === "zh" ? "执行中" : "Running";
  if (status === "error") return language === "zh" ? "失败" : "Failed";
  return language === "zh" ? "完成" : "Done";
}

function toolActionLabel(name: string, language: Language) {
  const zh = language === "zh";
  const normalized = String(name || "").toLowerCase();
  const labels: Record<string, [string, string]> = {
    list_files: ["List files", "列出文件"],
    read_file: ["Read file", "读取文件"],
    search_files: ["Search files", "搜索文件"],
    web_search: ["Web search", "联网搜索"],
    write_file: ["Write file", "写入文件"],
    delete_file: ["Delete file", "删除文件"],
    apply_patch: ["Apply patch", "应用 Patch"],
    ask_user: ["Ask user", "询问用户"],
    update_plan: ["Update plan", "更新计划"],
    run_command: ["Run command", "运行命令"],
    system_clipboard: ["Clipboard", "剪贴板"],
    system_window_info: ["Window info", "窗口信息"],
    system_notify: ["Notify", "系统通知"],
    background_task: ["Background task", "后台任务"]
  };
  return labels[normalized]?.[zh ? 1 : 0] || name || (zh ? "工具调用" : "Tool call");
}

function summarizeToolCall(name: string, rawArgs: string | undefined, rawResult: string | undefined, status: ToolCardStatus, language: Language) {
  const zh = language === "zh";
  const args = parseToolPayload(rawArgs);
  const result = parseToolPayload(rawResult);
  if (status === "running") return summarizeRunningTool(name, args, language);

  if (status === "error" || result?.ok === false) {
    const message = stringValue(result?.error) || stringValue(result?.message) || (zh ? "工具调用失败" : "Tool call failed");
    return zh ? `失败：${truncateInline(message, 80)}` : `Failed: ${truncateInline(message, 80)}`;
  }

  if (name === "list_files") {
    const count = Array.isArray(result?.files) ? result.files.length : 0;
    const truncated = result?.truncated ? (zh ? "，结果已截断" : ", truncated") : "";
    return zh ? `已列出 ${count} 个文件${truncated}` : `Listed ${count} files${truncated}`;
  }

  if (name === "read_file") {
    const path = stringValue(args?.path);
    const chars = stringValue(result?.result).length;
    return zh
      ? `已读取${path ? ` ${path}` : ""}${chars ? `，${chars.toLocaleString("zh-CN")} 字符` : ""}`
      : `Read${path ? ` ${path}` : ""}${chars ? `, ${chars.toLocaleString("en-US")} chars` : ""}`;
  }

  if (name === "search_files" || name === "web_search") {
    const count = Array.isArray(result?.results) ? result.results.length : 0;
    const query = stringValue(result?.query) || stringValue(args?.query);
    return zh ? `找到 ${count} 条结果${query ? `：${truncateInline(query, 48)}` : ""}` : `Found ${count} results${query ? ` for ${truncateInline(query, 48)}` : ""}`;
  }

  if (name === "run_command") {
    if (result?.pending) return zh ? "命令等待确认" : "Command is waiting for approval";
    const stdout = stringValue(result?.stdout);
    const stderr = stringValue(result?.stderr);
    if (stderr) return zh ? `命令完成，有 stderr：${truncateInline(stderr, 70)}` : `Command completed with stderr: ${truncateInline(stderr, 70)}`;
    return stdout ? (zh ? `命令完成：${truncateInline(stdout, 70)}` : `Command completed: ${truncateInline(stdout, 70)}`) : (zh ? "命令已完成" : "Command completed");
  }

  if (name === "apply_patch" || name === "write_file" || name === "delete_file") {
    if (result?.pending) return zh ? "变更等待确认" : "Change is waiting for approval";
    if (result?.applied || result?.written || result?.deleted) return zh ? "文件变更已应用" : "File change applied";
    return stringValue(result?.summary) || (zh ? "文件变更已生成" : "File change prepared");
  }

  if (name === "ask_user") return zh ? "已向用户请求输入" : "Asked the user for input";
  if (name === "update_plan") {
    const count = Array.isArray(result?.items) ? result.items.length : 0;
    return zh ? `计划已更新，${count} 项` : `Plan updated, ${count} items`;
  }

  const message = stringValue(result?.message) || stringValue(result?.result);
  return message ? truncateInline(message, 90) : (zh ? "工具调用完成" : "Tool call completed");
}

function summarizeRunningTool(name: string, args: Record<string, unknown> | null, language: Language) {
  const zh = language === "zh";
  const normalized = String(name || "").toLowerCase();
  if (normalized === "read_file") {
    const path = stringValue(args?.path);
    return path ? (zh ? `正在读取 ${truncateInline(path, 62)}` : `Reading ${truncateInline(path, 62)}`) : (zh ? "正在读取文件" : "Reading file");
  }
  if (normalized === "list_files") {
    const directory = stringValue(args?.directory);
    return directory ? (zh ? `正在列出 ${truncateInline(directory, 62)}` : `Listing ${truncateInline(directory, 62)}`) : (zh ? "正在列出工作区文件" : "Listing workspace files");
  }
  if (normalized === "search_files" || normalized === "web_search") {
    const query = stringValue(args?.query);
    return query ? (zh ? `正在搜索：${truncateInline(query, 62)}` : `Searching for ${truncateInline(query, 62)}`) : (zh ? "正在搜索" : "Searching");
  }
  if (normalized === "run_command") {
    const command = stringValue(args?.command);
    return command ? (zh ? `正在运行：${truncateInline(command, 62)}` : `Running ${truncateInline(command, 62)}`) : (zh ? "正在运行命令" : "Running command");
  }
  if (normalized === "apply_patch") {
    const summary = stringValue(args?.summary);
    return summary ? truncateInline(summary, 80) : (zh ? "正在准备文件变更" : "Preparing file changes");
  }
  if (normalized === "write_file" || normalized === "delete_file") {
    const path = stringValue(args?.path);
    return path ? (zh ? `正在处理 ${truncateInline(path, 62)}` : `Working on ${truncateInline(path, 62)}`) : (zh ? "正在处理文件" : "Working on files");
  }
  if (normalized === "ask_user") return zh ? "正在准备一个确认问题" : "Preparing a question";
  if (normalized === "update_plan") return zh ? "正在更新执行计划" : "Updating the plan";
  return zh ? "正在调用工具" : "Calling tool";
}

function isToolResultError(rawResult: string | undefined) {
  return parseToolPayload(rawResult)?.ok === false;
}

function parseToolPayload(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncateInline(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function formatToolCardPayload(raw: string | undefined) {
  if (!raw?.trim()) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function getStreamingAssistantIndex(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (message.content.trim() || message.reasoning?.trim()) return index;
    if (!message.tool_calls?.length) return index;
  }
  return -1;
}

function formatAttachmentStatus(file: AttachedFile, language: Language) {
  const zh = language === "zh";
  if (file.status === "large") return zh ? "过大" : "large";
  if (file.status === "binary") return zh ? "二进制" : "binary";
  if (file.status === "truncated" || file.truncated) return zh ? "已截断" : "truncated";
  return zh ? "就绪" : "ready";
}

function formatAttachmentTitle(file: AttachedFile, language: Language, removeTitle: string) {
  const parts = [
    removeTitle,
    file.path,
    formatAttachmentStatus(file, language),
    file.size ? `${file.size.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} bytes` : "",
    file.chars ? `${file.chars.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} chars` : "",
    file.duplicateCount && file.duplicateCount > 1 ? `${language === "zh" ? "重复添加" : "duplicate adds"}: ${file.duplicateCount}` : ""
  ].filter(Boolean);
  return parts.join("\n");
}
