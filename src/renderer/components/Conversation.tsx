import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { Paperclip, UploadCloud, ChevronLeft, ChevronRight } from "lucide-react";
import type { Language, translations } from "../i18n";
import type { AttachedFile, ChatMessage, ContextCompressionState, ReasoningView, StreamRecoveryStatus, TaskStatus, ToolDraft, ToolRun, PlanItem } from "../types";
import type { CommandItem, PatchItem, UserQuestionItem } from "../types";

// Extracted Subcomponents
import { Composer } from "./conversation/Composer";
import { MessageList } from "./conversation/MessageList";

// Helper utilities
import { getStreamingAssistantIndex } from "./conversation/conversation-utils";

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

  streamRecoveryStatus: StreamRecoveryStatus | null;
  streamingResponse: boolean;
  t: Translation;
  toolDraft: ToolDraft | null;
  showScrollToBottom: boolean;
  scrollToBottom: () => void;
  taskStatus: TaskStatus;
  updatePermissionMode: (mode: "default" | "full") => void;
  updateReasoningView: (key: string, view: ReasoningView) => void;
  uploadAttachmentFiles: () => void;
  workspace: string;
  copyMessage: (message: ChatMessage) => void;
  leftSidebarCollapsed: boolean;
  toggleLeftSidebar: () => void;
  planItems: PlanItem[];
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

  streamRecoveryStatus,
  streamingResponse,
  t,
  toolDraft,
  showScrollToBottom,
  scrollToBottom,
  taskStatus,
  updatePermissionMode,
  updateReasoningView,
  uploadAttachmentFiles,
  workspace,
  leftSidebarCollapsed,
  toggleLeftSidebar,
  planItems
}: ConversationProps) {
  const hasAutoPermissions = commandAutoApproval || patchAutoApproval;
  const fullAccessEnabled = commandAutoApproval && patchAutoApproval;
  const autoPermissionTitle = [
    language === "zh" ? "完全访问权限仅限当前会话；文件工具可访问 workspace 外路径，直到你切回默认权限。" : "Full access is scoped to this chat; file tools can access paths outside the workspace until you switch back to default permissions.",
    commandAutoApproval ? (language === "zh" ? "命令无需审批。" : "Commands do not require approval.") : "",
    patchAutoApproval ? (language === "zh" ? "文件变更无需审批。" : "File changes do not require approval.") : ""
  ].filter(Boolean).join(" ");
  const streamingMessageIndex = streamingResponse ? getStreamingAssistantIndex(messages) : -1;
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [toolDetailsMode, setToolDetailsMode] = useState<"default" | "expanded" | "collapsed">("default");
  const [textareaHeight, setTextareaHeight] = useState<number>(36);



  useEffect(() => {
    const textarea = composerInputRef.current;
    if (!textarea) return;

    if (!input) {
      setTextareaHeight(36);
      textarea.style.height = "";
      return;
    }

    const originalHeight = textarea.style.height;
    textarea.style.height = "auto";
    const sh = textarea.scrollHeight;
    textarea.style.height = originalHeight;

    const targetHeight = Math.min(Math.max(sh, 36), 200);
    setTextareaHeight(targetHeight);
  }, [input]);

  useEffect(() => {
    if (activeToolRuns.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [activeToolRuns.length]);

  // ---- Drag-and-drop handlers ----
  function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    const dt = event.dataTransfer;
    if (!dt) return false;
    const items = Array.from(dt.items || []);
    if (items.some((item) => item.kind === "file")) return true;
    const types = Array.from(dt.types || []);
    if (types.includes("Files")) return true;
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
      {draggingFiles && (
        <div className="message-drop-overlay" aria-hidden="true">
          <div className="message-drop-container">
            <UploadCloud size={48} className="message-drop-icon" strokeWidth={2} />
            <strong>{language === "zh" ? "松开以加入上下文" : "Drop to attach context"}</strong>
            <span>{language === "zh" ? "支持文本文件；过大或二进制文件会以说明占位。" : "Text files are read; large or binary files get a note."}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        className="floating-sidebar-toggle-btn"
        onClick={toggleLeftSidebar}
        title={leftSidebarCollapsed ? t.expandLeftSidebar : t.collapseLeftSidebar}
        aria-label="Toggle left sidebar"
      >
        {leftSidebarCollapsed ? (
          <ChevronRight size={14} strokeWidth={2.5} />
        ) : (
          <ChevronLeft size={14} strokeWidth={2.5} />
        )}
      </button>

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
        <MessageList
          messages={messages}
          t={t}
          busy={busy}
          chooseWorkspace={chooseWorkspace}
          language={language}
          toolDetailsMode={toolDetailsMode}
          copyMessage={copyMessage}
          regenerateMessage={regenerateMessage}
          reasoningViews={reasoningViews}
          streamingMessageIndex={streamingMessageIndex}
          updateReasoningView={updateReasoningView}
          activeToolRuns={activeToolRuns}
          now={now}
          toolDraft={toolDraft}
          activeCommands={activeCommands}
          activePatches={activePatches}
          activeQuestions={activeQuestions}
          answerQuestion={answerQuestion}
          approveCommand={approveCommand}
          applyPatch={applyPatch}
          commandAutoApproval={commandAutoApproval}
          discardCommand={discardCommand}
          discardPatch={discardPatch}
          dismissQuestion={dismissQuestion}
          resetCommandAutoApproval={resetCommandAutoApproval}
          contextCompressionStatus={contextCompressionStatus}
          taskStatus={taskStatus}
          streamRecoveryStatus={streamRecoveryStatus}
          retryRequestPending={retryRequestPending}
          retryLastRequest={retryLastRequest}
          showScrollToBottom={showScrollToBottom}
          scrollToBottom={scrollToBottom}
        />
      </div>

      <Composer
        input={input}
        setInput={setInput}
        send={send}
        busy={busy}

        composerInputRef={composerInputRef}
        textareaHeight={textareaHeight}
        language={language}
        t={t}

        contextCompression={contextCompression}
        contextCompressionStatus={contextCompressionStatus}
        attachedFiles={attachedFiles}
        detachFile={detachFile}
        hasAutoPermissions={hasAutoPermissions}
        fullAccessEnabled={fullAccessEnabled}
        updatePermissionMode={updatePermissionMode}
        autoPermissionTitle={autoPermissionTitle}
        isOnline={isOnline}
        contextPercent={contextPercent}
        sessionContextTokenCount={sessionContextTokenCount}
        configContextTokens={configContextTokens}
        contextUsageLabel={contextUsageLabel}
        uploadAttachmentFiles={uploadAttachmentFiles}
        cancelActiveRequest={cancelActiveRequest}
        planItems={planItems}
        activeToolRuns={activeToolRuns}
      />

    </main>
  );
}
