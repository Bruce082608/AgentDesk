import { useMemo } from "react";
import {
  Copy,
  RefreshCcw,
  ChevronDown,
  X,
  LoaderCircle,
  ArrowDown,
  Lightbulb
} from "lucide-react";
import type { Language, translations } from "../../i18n";
import type {
  ChatMessage,
  ReasoningView,
  ToolRun,
  ToolDraft,
  CommandItem,
  PatchItem,
  UserQuestionItem,
  TaskStatus,
  StreamRecoveryStatus
} from "../../types";
import { MarkdownContent, CodeBlock, formatToolDraftText } from "../../utils";
import { ToolCallCard } from "./ToolCallCard";
import { ToolCallGroupCard } from "./ToolCallGroupCard";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { ApprovalPanel } from "../ApprovalPanel";
import {
  isToolResultError,
  formatMessageTimestamp,
  truncateInline
} from "./conversation-utils";

type Translation = typeof translations[keyof typeof translations];

type RenderItem =
  | { type: "message"; message: ChatMessage; index: number }
  | { type: "tool_group"; name: string; tools: { message: ChatMessage; index: number }[] };

type MessageListProps = {
  messages: ChatMessage[];
  t: Translation;
  busy: boolean;
  chooseWorkspace: () => void;
  language: Language;
  toolDetailsMode: "default" | "expanded" | "collapsed";
  copyMessage: (message: ChatMessage) => void;
  regenerateMessage: (index: number) => void;
  reasoningViews: Record<string, ReasoningView>;
  streamingMessageIndex: number;
  updateReasoningView: (key: string, view: ReasoningView) => void;
  activeToolRuns: ToolRun[];
  now: number;
  toolDraft: ToolDraft | null;
  activeCommands: CommandItem[];
  activePatches: PatchItem[];
  activeQuestions: UserQuestionItem[];
  answerQuestion: (questionId: string, option: string) => void;
  approveCommand: (commandId: string, allowFuture?: boolean) => void;
  applyPatch: (patchId: string) => void;
  commandAutoApproval: boolean;
  discardCommand: (commandId: string) => void;
  discardPatch: (patchId: string) => void;
  dismissQuestion: (questionId: string) => void;
  resetCommandAutoApproval: () => void;
  contextCompressionStatus: string;
  taskStatus: TaskStatus;
  streamRecoveryStatus: StreamRecoveryStatus | null;
  retryRequestPending: boolean;
  retryLastRequest: () => void;
  showScrollToBottom: boolean;
  scrollToBottom: () => void;
};

export function MessageList({
  messages,
  t,
  busy,
  chooseWorkspace,
  language,
  toolDetailsMode,
  copyMessage,
  regenerateMessage,
  reasoningViews,
  streamingMessageIndex,
  updateReasoningView,
  activeToolRuns,
  now,
  toolDraft,
  activeCommands,
  activePatches,
  activeQuestions,
  answerQuestion,
  approveCommand,
  applyPatch,
  commandAutoApproval,
  discardCommand,
  discardPatch,
  dismissQuestion,
  resetCommandAutoApproval,
  contextCompressionStatus,
  taskStatus,
  streamRecoveryStatus,
  retryRequestPending,
  retryLastRequest,
  showScrollToBottom,
  scrollToBottom
}: MessageListProps) {
  const renderItems = useMemo(() => {
    const items: RenderItem[] = [];
    let currentGroup: { name: string; tools: { message: ChatMessage; index: number }[] } | null = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role === "system") continue;
      if (message.role === "assistant" && !message.content && !message.reasoning && message.tool_calls?.length) continue;

      if (message.role === "tool") {
        const toolName = message.name || "";
        if (currentGroup && currentGroup.name === toolName) {
          currentGroup.tools.push({ message, index: i });
        } else {
          if (currentGroup) {
            if (currentGroup.tools.length === 1) {
              items.push({ type: "message", message: currentGroup.tools[0].message, index: currentGroup.tools[0].index });
            } else {
              items.push({ type: "tool_group", name: currentGroup.name, tools: currentGroup.tools });
            }
          }
          currentGroup = { name: toolName, tools: [{ message, index: i }] };
        }
      } else {
        if (currentGroup) {
          if (currentGroup.tools.length === 1) {
            items.push({ type: "message", message: currentGroup.tools[0].message, index: currentGroup.tools[0].index });
          } else {
            items.push({ type: "tool_group", name: currentGroup.name, tools: currentGroup.tools });
          }
          currentGroup = null;
        }
        items.push({ type: "message", message, index: i });
      }
    }

    if (currentGroup) {
      if (currentGroup.tools.length === 1) {
        items.push({ type: "message", message: currentGroup.tools[0].message, index: currentGroup.tools[0].index });
      } else {
        items.push({ type: "tool_group", name: currentGroup.name, tools: currentGroup.tools });
      }
    }

    return items;
  }, [messages]);

  return (
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
      {renderItems.map((item) => {
        if (item.type === "tool_group") {
          return (
            <ToolCallGroupCard
              key={`tool-group-${item.name}-${item.tools[0].index}`}
              name={item.name}
              tools={item.tools}
              language={language}
              t={t}
              toolDetailsMode={toolDetailsMode}
              copyMessage={copyMessage}
              busy={busy}
              regenerateMessage={regenerateMessage}
            />
          );
        }

        const { message, index } = item;
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
              toolDetailsMode={toolDetailsMode}
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
                  <Copy size={13} strokeWidth={2.4} aria-hidden="true" />
                </button>
                {message.role === "assistant" && !busy && index === messages.length - 1 && (
                  <button type="button" onClick={() => regenerateMessage(index)} title={t.regenerate} aria-label={t.regenerate}>
                    <RefreshCcw size={13} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <div className="message-body">
              {message.reasoning && (
                <section className="reasoning-block">
                  <div className="reasoning-header">
                    <span className="reasoning-title" title={t.reasoning}>
                      <span>
                        <Lightbulb size={13} strokeWidth={2.6} aria-hidden="true" />
                      </span>
                    </span>
                    <div className="reasoning-actions">
                      {reasoningView === "collapsed" && (
                        <span className="reasoning-preview-text">{truncateInline(message.reasoning, 50)}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => updateReasoningView(reasoningKey, reasoningView === "collapsed" ? "preview" : "collapsed")}
                        title={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                        aria-label={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                      >
                        {reasoningView === "collapsed" ? <ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" /> : <X size={13} strokeWidth={2.4} aria-hidden="true" />}
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
          toolDetailsMode={toolDetailsMode}
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
  );
}
