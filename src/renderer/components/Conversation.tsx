import type { RefObject } from "react";
import type { Language, translations } from "../i18n";
import type { AttachedFile, ChatMessage, ReasoningView, ToolDraft } from "../types";
import { CodeBlock, MarkdownContent, formatToolDraftText } from "../utils";
import { ApprovalPanel } from "./ApprovalPanel";
import type { CommandItem, PatchItem, UserQuestionItem } from "../types";

type Translation = typeof translations[keyof typeof translations];

type ConversationProps = {
  activeCommands: CommandItem[];
  activePatches: PatchItem[];
  activeQuestions: UserQuestionItem[];
  answerQuestion: (questionId: string, option: string) => void;
  approveCommand: (commandId: string, allowFuture?: boolean) => void;
  applyPatch: (patchId: string) => void;
  attachFile: (path: string) => void;
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
  send: () => void;
  sessionContextTokenCount: number;
  setInput: (value: string) => void;
  setLanguage: (language: Language) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  startComposerResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  t: Translation;
  theme: "light" | "dark" | "system";
  toolDraft: ToolDraft | null;
  updateOutputFollowState: () => void;
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
  answerQuestion,
  approveCommand,
  applyPatch,
  attachFile,
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
  send,
  sessionContextTokenCount,
  setInput,
  setLanguage,
  setTheme,
  startComposerResize,
  t,
  theme,
  toolDraft,
  updateOutputFollowState,
  updateCommandAutoApproval,
  updatePatchAutoApproval,
  updateReasoningView,
  uploadAttachmentFiles
}: ConversationProps) {
  return (
    <main className="conversation">
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

      <div className="message-list" ref={messageListRef} onScroll={updateOutputFollowState}>
        {messages.length === 0 && (
          <div className="empty-state">
            <h2>{t.emptyTitle}</h2>
            <p>{t.emptyBody}</p>
          </div>
        )}
        {messages.map((message, index) => {
          if (message.role === "tool" || message.role === "system") return null;
          const reasoningKey = `${message.role}-${index}`;
          const reasoningView = reasoningViews[reasoningKey] || "preview";
          return (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
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
        {busy && <div className="thinking">{t.thinking}</div>}
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
            <div className="permission-inline" title={t.defaultPermissionHint}>
              <span>{t.permissionMode}</span>
              <label>
                <input
                  type="checkbox"
                  checked={commandAutoApproval}
                  onChange={(event) => updateCommandAutoApproval(event.target.checked)}
                />
                {language === "zh" ? "命令自动执行" : "Auto-run commands"}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={patchAutoApproval}
                  onChange={(event) => updatePatchAutoApproval(event.target.checked)}
                />
                {language === "zh" ? "Patch 自动应用" : "Auto-apply patches"}
              </label>
            </div>
            <div className="composer-actions">
              {!isOnline && <span className="offline-pill">{t.offlineTitle}</span>}
              <span className={`context-meter ${contextPercent >= 90 ? "danger" : contextPercent >= 70 ? "warn" : ""}`} title={`${t.contextUsage}: ${sessionContextTokenCount.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} / ${configContextTokens.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} tokens`}>
                {contextUsageLabel}
              </span>
              <button className="composer-icon" type="button" disabled={busy} onClick={uploadAttachmentFiles} title={t.uploadFiles} aria-label={t.uploadFiles}>+</button>
              {busy && <button className="composer-icon danger" type="button" onClick={cancelActiveRequest} title={t.stop} aria-label={t.stop}>■</button>}
              <button className="send composer-send" type="button" disabled={busy || !input.trim()} onClick={send} title={t.send} aria-label={t.send}>↑</button>
            </div>
          </div>
          {(commandAutoApproval || patchAutoApproval) && (
            <div className="approval-banner">
              {language === "zh" ? "自动权限仅限当前会话和 workspace，最长 30 分钟。" : "Auto permissions are scoped to this chat and workspace for up to 30 minutes."}
              {commandAutoApproval && commandAutoApprovalExpiresAt ? ` ${language === "zh" ? "命令到期" : "Commands expire"} ${new Date(commandAutoApprovalExpiresAt).toLocaleTimeString()}.` : ""}
              {patchAutoApproval && patchAutoApprovalExpiresAt ? ` ${language === "zh" ? "Patch 到期" : "Patches expire"} ${new Date(patchAutoApprovalExpiresAt).toLocaleTimeString()}.` : ""}
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}
