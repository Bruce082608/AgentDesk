import { useMemo, memo } from "react";
import {
  Copy,
  RefreshCcw,
  ChevronDown,
  ChevronRight,
  X,
  LoaderCircle,
  ArrowDown
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
import { MarkdownContent, formatToolDraftText } from "../../utils";
import { ToolCallCard } from "./ToolCallCard";
import { WorkProcessCard } from "./WorkProcessCard";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { ApprovalPanel } from "../ApprovalPanel";
import {
  isToolResultError,
  formatMessageTimestamp,
  truncateInline
} from "./conversation-utils";

type Translation = typeof translations[keyof typeof translations];

const getReasoningDurationSec = (msg: ChatMessage) => {
  if (msg.reasoningDurationMs) {
    return Math.max(1, Math.round(msg.reasoningDurationMs / 1000));
  }
  if (msg.reasoning) {
    return Math.max(1, Math.round(msg.reasoning.length / 120));
  }
  return 0;
};

type RenderItem =
  | { type: "message"; message: ChatMessage; index: number; hideReasoning?: boolean }
  | {
      type: "work_process";
      tools: { message: ChatMessage; index: number }[];
      reasoningItems?: { text: string; durationMs?: number; index: number }[];
    };

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
  approveCommand: (commandId: string, allowFuture?: boolean) => void;
  applyPatch: (patchId: string) => void;
  commandAutoApproval: boolean;
  discardCommand: (commandId: string) => void;
  discardPatch: (patchId: string) => void;
  resetCommandAutoApproval: () => void;
  contextCompressionStatus: string;
  taskStatus: TaskStatus;
  streamRecoveryStatus: StreamRecoveryStatus | null;
  retryRequestPending: boolean;
  retryLastRequest: () => void;
  showScrollToBottom: boolean;
  scrollToBottom: () => void;
};

export const MessageList = memo(function MessageList({
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
  approveCommand,
  applyPatch,
  commandAutoApproval,
  discardCommand,
  discardPatch,
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
    let currentTools: { message: ChatMessage; index: number }[] = [];
    let currentReasoningItems: { text: string; durationMs?: number; index: number }[] = [];

    const flushTools = () => {
      if (!currentTools.length && !currentReasoningItems.length) return;
      items.push({
        type: "work_process",
        tools: currentTools,
        reasoningItems: currentReasoningItems
      });
      currentTools = [];
      currentReasoningItems = [];
    };

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role === "system") continue;
      if (message.role === "assistant" && !message.content && !message.reasoning && message.tool_calls?.length) continue;

      if (message.role === "tool") {
        currentTools.push({ message, index: i });
      } else {
        const moveReasoningToProcess = !busy && message.role === "assistant" && Boolean(message.reasoning);
        if (moveReasoningToProcess && message.reasoning) {
          currentReasoningItems.push({
            text: message.reasoning,
            durationMs: message.reasoningDurationMs,
            index: i
          });
        }
        flushTools();
        items.push({ type: "message", message, index: i, hideReasoning: moveReasoningToProcess });
      }
    }

    flushTools();

    return items;
  }, [messages, busy]);

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
        if (item.type === "work_process") {
          const firstProcessIndex = item.tools[0]?.index ?? item.reasoningItems?.[0]?.index ?? 0;
          return (
            <WorkProcessCard
              key={`work-process-${firstProcessIndex}`}
              tools={item.tools}
              language={language}
              t={t}
              toolDetailsMode={toolDetailsMode}
              busy={busy}
              reasoningItems={item.reasoningItems}
            />
          );
        }

        const { message, index, hideReasoning } = item;
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
        const isThinking = index === streamingMessageIndex && busy;
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
              {message.reasoning && !hideReasoning && (
                <div className="reasoning-block">
                  <button
                    type="button"
                    className="reasoning-toggle"
                    onClick={() => updateReasoningView(reasoningKey, reasoningView === "collapsed" ? "full" : "collapsed")}
                    title={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                    aria-label={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                  >
                    <span className="reasoning-arrow">
                      {reasoningView !== "collapsed" ? (
                        <ChevronDown size={14} strokeWidth={2.5} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" />
                      )}
                    </span>
                    <span className="reasoning-summary">
                      {isThinking && !message.reasoningDurationMs
                        ? (language === "zh" ? "正在思考..." : "Thinking...")
                        : (language === "zh"
                          ? `思考了 ${getReasoningDurationSec(message)} 秒`
                          : `Thought for ${getReasoningDurationSec(message)}s`
                        )
                      }
                    </span>
                  </button>
                  {reasoningView !== "collapsed" && (
                    <div className="reasoning-content">
                      <pre>{message.reasoning}</pre>
                    </div>
                  )}
                </div>
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
        <ToolCallCard
          key={`tool-draft-${toolDraft.name || "draft"}`}
          args={formatToolDraftText(toolDraft.text)}
          copyLabel={t.copy}
          copiedLabel={t.copied}
          language={language}
          name={toolDraft.name || t.writingCode}
          status="running"
          title={t.writingCode}
          toolDetailsMode={toolDetailsMode}
        />
      )}
      <ApprovalPanel
        activeCommands={activeCommands}
        activePatches={activePatches}
        approveCommand={approveCommand}
        applyPatch={applyPatch}
        busy={busy}
        commandAutoApproval={commandAutoApproval}
        discardCommand={discardCommand}
        discardPatch={discardPatch}
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
}, (prevProps, nextProps) => {
  return (
    prevProps.messages === nextProps.messages &&
    prevProps.busy === nextProps.busy &&
    prevProps.language === nextProps.language &&
    prevProps.toolDetailsMode === nextProps.toolDetailsMode &&
    prevProps.reasoningViews === nextProps.reasoningViews &&
    prevProps.streamingMessageIndex === nextProps.streamingMessageIndex &&
    prevProps.activeToolRuns === nextProps.activeToolRuns &&
    prevProps.now === nextProps.now &&
    prevProps.toolDraft === nextProps.toolDraft &&
    prevProps.activeCommands === nextProps.activeCommands &&
    prevProps.activePatches === nextProps.activePatches &&
    prevProps.commandAutoApproval === nextProps.commandAutoApproval &&
    prevProps.contextCompressionStatus === nextProps.contextCompressionStatus &&
    prevProps.taskStatus === nextProps.taskStatus &&
    prevProps.streamRecoveryStatus === nextProps.streamRecoveryStatus &&
    prevProps.retryRequestPending === nextProps.retryRequestPending &&
    prevProps.showScrollToBottom === nextProps.showScrollToBottom
  );
});
