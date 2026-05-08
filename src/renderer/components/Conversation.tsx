import { useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import type { Language, translations } from "../i18n";
import type { AttachedFile, ChatMessage, ReasoningView, StreamRecoveryStatus, ToolDraft, ToolRun } from "../types";
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
  commandAutoApproval: boolean;
  commandAutoApprovalExpiresAt?: number | null;
  composerHeight: number;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  configContextTokens: number;
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
  updateCommandAutoApproval: (enabled: boolean) => void;
  updatePatchAutoApproval: (enabled: boolean) => void;
  updateReasoningView: (key: string, view: ReasoningView) => void;
  uploadAttachmentFiles: () => void;
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
  commandAutoApproval,
  commandAutoApprovalExpiresAt,
  composerHeight,
  composerInputRef,
  configContextTokens,
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
  updateCommandAutoApproval,
  updatePatchAutoApproval,
  updateReasoningView,
  uploadAttachmentFiles
}: ConversationProps) {
  const hasAutoPermissions = commandAutoApproval || patchAutoApproval;
  const autoPermissionTitle = [
    language === "zh" ? "自动权限仅限当前会话和 workspace，最长 30 分钟。" : "Auto permissions are scoped to this chat and workspace for up to 30 minutes.",
    commandAutoApproval && commandAutoApprovalExpiresAt
      ? `${language === "zh" ? "命令到期" : "Commands expire"} ${new Date(commandAutoApprovalExpiresAt).toLocaleTimeString()}.`
      : "",
    patchAutoApproval && patchAutoApprovalExpiresAt
      ? `${language === "zh" ? "Patch 到期" : "Patches expire"} ${new Date(patchAutoApprovalExpiresAt).toLocaleTimeString()}.`
      : ""
  ].filter(Boolean).join(" ");
  const streamingMessageIndex = streamingResponse ? getStreamingAssistantIndex(messages) : -1;
  const activeToolName = toolDraft ? (toolDraft.name || "tool") : activeToolRuns[activeToolRuns.length - 1]?.name || "";
  const activeToolStatus = busy && activeToolName ? formatActiveToolStatus(activeToolName, language) : "";
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const messageListContent = useMemo(() => (
    <>
      {messages.length === 0 && (
        <div className="empty-state">
          <h2>{t.emptyTitle}</h2>
          <p>{t.emptyBody}</p>
        </div>
      )}
      {messages.map((message, index) => {
        if (message.role === "system") return null;
        if (message.role === "tool") {
          return (
            <ToolCallCard
              key={`${message.tool_call_id || message.name || "tool"}-${index}`}
              args=""
              copyLabel={t.copy}
              copiedLabel={t.copied}
              language={language}
              name={message.name || ""}
              result={message.content}
              status={isToolResultError(message.content) ? "error" : "completed"}
              title={formatMessageTimestamp(message.createdAt, language)}
            />
          );
        }
        if (message.role === "assistant" && !message.content && !message.reasoning && message.tool_calls?.length) return null;
        const reasoningKey = `${message.role}-${index}`;
        const reasoningView = reasoningViews[reasoningKey] || "preview";
        return (
          <article className={`message ${message.role}${index === streamingMessageIndex ? " streaming" : ""}`} key={`${message.role}-${index}`} title={formatMessageTimestamp(message.createdAt, language)}>
            <div className="message-meta">
              <div className="role">{message.role === "user" ? t.you : t.agent}</div>
              <div className="message-actions">
                <button type="button" onClick={() => copyMessage(message)} title={t.copy} aria-label={t.copy}>⧉</button>
                {message.role === "assistant" && (
                  <button type="button" onClick={() => regenerateMessage(index)} disabled={busy} title={t.regenerate} aria-label={t.regenerate}>↻</button>
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
                      💡
                    </button>
                    <div className="reasoning-actions">
                      {reasoningView === "full" ? (
                        <button type="button" onClick={() => updateReasoningView(reasoningKey, "preview")} title={t.previewReasoning} aria-label={t.previewReasoning}>≡</button>
                      ) : (
                        <button type="button" onClick={() => updateReasoningView(reasoningKey, "full")} title={t.expandReasoning} aria-label={t.expandReasoning}>↕</button>
                      )}
                      <button
                        type="button"
                        onClick={() => updateReasoningView(reasoningKey, reasoningView === "collapsed" ? "preview" : "collapsed")}
                        title={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                        aria-label={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                      >
                        {reasoningView === "collapsed" ? "≡" : "×"}
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
          language={language}
          name={tool.name}
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
      {streamRecoveryStatus && (
        <div className={`stream-recovery-status ${streamRecoveryStatus.recovering ? "recovering" : "failed"}`} role="status">
          <span className="tool-status-indicator running" aria-hidden="true" />
          <span>{streamRecoveryStatus.message}</span>
        </div>
      )}
      {retryRequestPending && (
        <div className="network-retry-banner" role="status">
          <span>{t.networkRestoredBody}</span>
          <button type="button" className="secondary tiny" disabled={busy} onClick={retryLastRequest}>{t.retryLastRequest}</button>
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
          ↓
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
    commandAutoApproval,
    contextCompressionStatus,
    copyMessage,
    discardCommand,
    discardPatch,
    dismissQuestion,
    language,
    messages,
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
    toolDraft,
    updateReasoningView
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
          {busy && <button className="secondary danger" onClick={cancelActiveRequest}>{t.stop}</button>}
        </div>
      </header>

      {previewFile && (
        <section className="context-strip">
          <details className="file-preview">
            <summary>
              <span>{previewFile.path}</span>
              <button onClick={(event) => { event.preventDefault(); attachFile(previewFile.path); }}>{t.addContext}</button>
            </summary>
            <pre>{previewFile.content}</pre>
          </details>
        </section>
      )}

      <div
        className={`message-list${draggingFiles ? " dragging-files" : ""}`}
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
        <div className={`composer-surface${activeToolStatus ? " has-tool-status" : ""}`}>
          {activeToolStatus && (
            <div className="composer-tool-status" role="status" aria-live="polite">
              <span className="tool-status-indicator running" aria-hidden="true" />
              <span>{activeToolStatus}</span>
            </div>
          )}
          {attachedFiles.length > 0 && (
            <div className="composer-attachments">
              {attachedFiles.map((file) => (
                <button key={file.path} type="button" onClick={() => detachFile(file.path)} title={t.removeContextTitle}>{file.path} ×</button>
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
            <div className="permission-inline" title={t.defaultPermissionHint} aria-label={t.permissionMode}>
              <span>{language === "zh" ? "权限" : "Perms"}</span>
              <label
                className={`permission-toggle ${commandAutoApproval ? "active" : ""}`}
                title={language === "zh" ? "命令自动执行" : "Auto-run commands"}
                aria-label={language === "zh" ? "命令自动执行" : "Auto-run commands"}
              >
                <input
                  type="checkbox"
                  checked={commandAutoApproval}
                  onChange={(event) => updateCommandAutoApproval(event.target.checked)}
                />
                <span aria-hidden="true">{language === "zh" ? "命令" : "Cmd"}</span>
              </label>
              <label
                className={`permission-toggle ${patchAutoApproval ? "active" : ""}`}
                title={language === "zh" ? "Patch 自动应用" : "Auto-apply patches"}
                aria-label={language === "zh" ? "Patch 自动应用" : "Auto-apply patches"}
              >
                <input
                  type="checkbox"
                  checked={patchAutoApproval}
                  onChange={(event) => updatePatchAutoApproval(event.target.checked)}
                />
                <span aria-hidden="true">Patch</span>
              </label>
            </div>
            {hasAutoPermissions && (
              <span className="permission-status" title={autoPermissionTitle}>
                {language === "zh" ? "自动权限 30 分钟" : "Auto permissions 30m"}
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
              <button className="composer-icon" type="button" disabled={busy} onClick={uploadAttachmentFiles} title={t.uploadFiles} aria-label={t.uploadFiles}>+</button>
              {busy && <button className="composer-icon danger" type="button" onClick={cancelActiveRequest} title={t.stop} aria-label={t.stop}>■</button>}
              <button className="send composer-send" type="button" disabled={busy || !input.trim()} onClick={send} title={t.send} aria-label={t.send}>↑</button>
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
  language: Language;
  name: string;
  result?: string;
  status: ToolCardStatus;
  title?: string;
};

function ToolCallCard({ args, copiedLabel, copyLabel, language, name, result, status, title }: ToolCallCardProps) {
  const parsedResult = parseToolPayload(result);
  const displayName = name || stringValue(parsedResult?.tool) || "tool";
  const effectiveStatus = status === "completed" && parsedResult?.ok === false ? "error" : status;
  const summary = summarizeToolCall(displayName, args, result, effectiveStatus, language);
  const argsCode = formatToolCardPayload(args);
  const resultCode = formatToolCardPayload(result);
  const statusLabel = toolStatusLabel(effectiveStatus, language);

  return (
    <details className={`tool-call-card ${effectiveStatus}`} open={effectiveStatus === "running"} title={title}>
      <summary>
        <span className={`tool-status-indicator ${effectiveStatus}`} aria-hidden="true" />
        <span className="tool-call-name">{displayName}</span>
        <span className="tool-call-status">{statusLabel}</span>
        <span className="tool-call-summary">{summary}</span>
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
}

function formatMessageTimestamp(timestamp: number | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "未记录时间" : "Timestamp not recorded";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(timestamp);
}

function toolStatusLabel(status: ToolCardStatus, language: Language) {
  if (status === "running") return language === "zh" ? "执行中" : "Running";
  if (status === "error") return language === "zh" ? "失败" : "Failed";
  return language === "zh" ? "完成" : "Done";
}

function summarizeToolCall(name: string, rawArgs: string | undefined, rawResult: string | undefined, status: ToolCardStatus, language: Language) {
  const zh = language === "zh";
  if (status === "running") return zh ? "正在调用工具..." : "Calling tool...";

  const args = parseToolPayload(rawArgs);
  const result = parseToolPayload(rawResult);
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

function formatActiveToolStatus(name: string, language: Language) {
  const displayName = name === "tool_call" ? "tool" : name;
  return language === "zh"
    ? `Agent 正在调用 ${displayName}...`
    : `Agent is calling ${displayName}...`;
}
