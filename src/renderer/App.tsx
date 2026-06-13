import "./fallback-bridge";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActivityPanel } from "./components/ActivityPanel";
import { Conversation } from "./components/Conversation";
import { Sidebar } from "./components/Sidebar";
import { SettingsModal } from "./components/SettingsModal";
import type { AttachedFile, OpenPathsPayload } from "./global";
import type { Language } from "./i18n";
import { translations } from "./i18n";
import { useActivityLog } from "./hooks/useActivityLog";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useProviderConfig } from "./hooks/useProviderConfig";
import { useSessions } from "./hooks/useSessions";
import { useWorkspace } from "./hooks/useWorkspace";

// Custom infrastructure hooks
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useColumnResize } from "./hooks/useColumnResize";

import { useTheme } from "./hooks/useTheme";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { useTokenCounter } from "./hooks/useTokenCounter";
import { useScrollFollow } from "./hooks/useScrollFollow";

import type {
  ActivityFilter,
  ChatMessage,
  ReasoningView,
  RightSidebarSection,
  SidebarSection,
  TokenUsageStats
} from "./types";
import {
  LANGUAGE_KEY,
  RESIZE_HANDLE_WIDTH,
  MIN_CONVERSATION_WIDTH,
  emptyTokenUsage
} from "./types";
import {
  copyText,
  filterActivityEvents
} from "./utils";
import { getInputBudgetTokens } from "../shared/contextBudget";
import "./styles.css";

function App() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [activeMobileTab, setActiveMobileTab] = useState<"chats" | "chat" | "activity">("chat");

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reasoningViews, setReasoningViews] = useState<Record<string, ReasoningView>>({});
  const [rightSidebarSection, setRightSidebarSection] = useState<RightSidebarSection>("plan");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("chats");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageStats>(() => emptyTokenUsage());

  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return saved === "en" ? "en" : "zh";
  });

  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const t = translations[language];

  // Hook 1: Activity Log Logger
  const { appendEvent, events, resetEvents } = useActivityLog();

  // Hook 2: Workspace Manager
  const workspaceState = useWorkspace({ appendEvent, t });

  // Hook 3: Agent Events Coordinator
  const agentState = useAgentEvents({
    appendEvent,
    language,
    refreshGit: workspaceState.refreshGit,
    refreshWorkspace: workspaceState.refreshWorkspace,
    setMessages,
    setTokenUsage
  });

  // Hook 5: Online Status & Retry
  const {
    isOnline,
    setIsOnline,
    retryRequest,
    setRetryRequest
  } = useOnlineStatus({ appendEvent, t });

  // Hook 4: Provider Configuration
  const providerState = useProviderConfig({
    appendEvent,
    busy: agentState.busy,
    setIsOnline,
    t
  });

  // Hook 6: Columns Resizer
  const {
    leftSidebarWidth,
    rightSidebarWidth,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar,
    startColumnResize
  } = useColumnResize();


  // Hook 8: Theme Switcher
  const { theme, setTheme } = useTheme();

  // Hook 9: Keyboard Shortcuts Listener
  useKeyboardShortcuts({ toggleLeftSidebar, toggleRightSidebar });

  // Hook 10: Global Drag & Drop Handler
  useDragAndDrop();

  // Hook 11: Token calculation
  const {
    contextTokenCount
  } = useTokenCounter({
    messages,
    attachedFiles: workspaceState.attachedFiles,
    input
  });

  // Hook 12: Scroll following
  const {
    showScrollToBottom,
    showActivityScrollToBottom,
    messageListRef,
    activityListRef,
    followOutputRef,
    scrollToBottom,
    scrollActivityToBottom
  } = useScrollFollow({
    messages,
    events,
    patches: agentState.patches,
    commands: agentState.commands,
    questions: agentState.questions,
    activeToolRuns: agentState.activeToolRuns,
    busy: agentState.busy,
    activityFilter,
    activitySearch,
    rightSidebarSection
  });

  const resetSessionTokenUsage = useCallback(() => {
    setTokenUsage(emptyTokenUsage());
  }, []);

  const resetTransientState = useCallback(() => {
    resetEvents();
    agentState.resetAgentTransientState();
    workspaceState.resetWorkspaceTransientState();
    setReasoningViews({});
  }, [agentState, resetEvents, workspaceState]);

  // Hook 13: Sessions Handler
  const sessionState = useSessions({
    appendEvent,
    busy: agentState.busy,
    clearWorkspaceData: workspaceState.clearWorkspaceData,
    messages,
    refreshGit: workspaceState.refreshGit,
    refreshWorkspace: workspaceState.refreshWorkspace,
    resetSessionTokenUsage,
    resetTransientState,
    setMessages,
    setTokenUsage,
    setWorkspace: workspaceState.setWorkspace,
    t,
    tokenUsage,
    workspace: workspaceState.workspace
  });

  useEffect(() => {
    const unsubscribe = window.agentWindow.onOpenPaths(async (payload: OpenPathsPayload) => {
      const workspaceHint = payload.workspaceHint || payload.directories[0] || "";
      try {
        if (workspaceHint) {
          workspaceState.setWorkspace(workspaceHint);
          workspaceState.setSearchResults([]);
          workspaceState.setFileSearch("");
          await workspaceState.refreshWorkspace(workspaceHint);
          await workspaceState.refreshGit(workspaceHint);
        }
        if (payload.files.length > 0) {
          const files = await window.agentWindow.readAttachmentFiles({ paths: payload.files });
          workspaceState.setAttachedFiles((current) => mergeOpenPathAttachments(current, files));
        }
        appendEvent("tool", "System open paths", JSON.stringify({
          workspace: workspaceHint,
          files: payload.files.length,
          directories: payload.directories.length,
          missing: payload.missing.length
        }, null, 2));
      } catch (error) {
        appendEvent("error", "System open paths failed", error instanceof Error ? error.message : String(error));
      }
    });
    void window.agentWindow.setOpenPathsReady();
    return unsubscribe;
  }, [
    appendEvent,
    workspaceState.refreshGit,
    workspaceState.refreshWorkspace,
    workspaceState.setAttachedFiles,
    workspaceState.setFileSearch,
    workspaceState.setSearchResults,
    workspaceState.setWorkspace
  ]);

  useEffect(() => {
    if (!sessionState.sessionsLoaded) return;
    void agentState.loadPendingApprovals(sessionState.activeSessionId);
    void agentState.loadAutoApprovalState({
      workspace: workspaceState.workspace || ".",
      sessionId: sessionState.activeSessionId
    });
  }, [agentState.loadAutoApprovalState, agentState.loadPendingApprovals, sessionState.activeSessionId, sessionState.sessionsLoaded, workspaceState.workspace]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

  const activePatches = useMemo(
    () => agentState.patches.filter((patch) => patch.status === "pending" || patch.status === "failed"),
    [agentState.patches]
  );
  const activeCommands = useMemo(
    () => agentState.commands.filter((command) => command.status === "pending" || command.status === "failed"),
    [agentState.commands]
  );
  const activeQuestions = useMemo(
    () => agentState.questions.filter((question) => question.status === "pending"),
    [agentState.questions]
  );
  const filteredEvents = useMemo(
    () => filterActivityEvents(events, activityFilter, activitySearch),
    [activityFilter, activitySearch, events]
  );
  const inputBudgetTokens = getInputBudgetTokens(providerState.config.contextTokens, providerState.config.maxTokens);
  const contextPercent = Math.min(100, Math.round((contextTokenCount / Math.max(inputBudgetTokens, 1)) * 100));
  const contextUsageLabel = `${contextPercent}%`;

  const startAgentRequest = useCallback(async ({
    inputText,
    priorMessages,
    nextMessages,
    clearInput
  }: {
    inputText: string;
    priorMessages: ChatMessage[];
    nextMessages: ChatMessage[];
    clearInput?: boolean;
  }) => {
    if (!workspaceState.workspace && workspaceState.attachedFiles.length === 0) {
      appendEvent("error", "缺少 workspace", "请先选择一个工作区目录。");
      return;
    }
    if (!navigator.onLine) {
      setIsOnline(false);
      setRetryRequest({ inputText, priorMessages, nextMessages });
      appendEvent("error", t.offlineTitle, t.offlineBody);
      return;
    }

    const requestId = crypto.randomUUID();
    agentState.beginRequest(requestId, t.waitingPlan);
    followOutputRef.current = true;
    if (clearInput) setInput("");
    setMessages(nextMessages);

    const result = await window.agentWindow.sendMessage({
      requestId,
      sessionId: sessionState.activeSessionId,
      language,
      workspace: workspaceState.workspace || ".",
      input: inputText,
      providerConfig: providerState.config,
      messages: priorMessages,
      attachments: workspaceState.attachedFiles,
      permissionMode: agentState.commandAutoApproval && agentState.patchAutoApproval ? "full" : "default"
    });
    if (result.ok) {
      setRetryRequest(null);
    } else if (!result.cancelled && !navigator.onLine) {
      setRetryRequest({ inputText, priorMessages, nextMessages });
    }
  }, [
    agentState.beginRequest,
    appendEvent,
    language,
    providerState.config,
    sessionState.activeSessionId,
    t.offlineBody,
    t.offlineTitle,
    t.waitingPlan,
    agentState.commandAutoApproval,
    agentState.patchAutoApproval,
    workspaceState.attachedFiles,
    workspaceState.workspace,
    setIsOnline,
    setRetryRequest,
    followOutputRef
  ]);

  const retryLastRequest = useCallback(async () => {
    if (!retryRequest || agentState.busy || !navigator.onLine) return;
    const request = retryRequest;
    setRetryRequest(null);
    await startAgentRequest({ ...request, clearInput: false });
  }, [agentState.busy, retryRequest, startAgentRequest]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || agentState.busy) return;

    await startAgentRequest({
      inputText: trimmed,
      priorMessages: messages,
      nextMessages: [...messages, { role: "user", content: trimmed, createdAt: Date.now() }],
      clearInput: true
    });
  }, [agentState.busy, input, messages, startAgentRequest]);

  const copyMessage = useCallback(async (message: ChatMessage) => {
    await copyText(message.content || message.reasoning || "");
    appendEvent("status", t.copied, message.role === "user" ? t.you : t.agent);
  }, [appendEvent, t.agent, t.copied, t.you]);

  const regenerateMessage = useCallback(async (index: number) => {
    if (agentState.busy) return;
    const userIndex = messages.slice(0, index + 1).map((message) => message.role).lastIndexOf("user");
    if (userIndex < 0) return;
    const prompt = messages[userIndex].content.trim();
    if (!prompt) return;
    await startAgentRequest({
      inputText: prompt,
      priorMessages: messages.slice(0, userIndex),
      nextMessages: messages.slice(0, userIndex + 1)
    });
  }, [agentState.busy, messages, startAgentRequest]);

  const answerQuestion = useCallback(async (questionId: string, option: string) => {
    await agentState.answerQuestion(questionId, option);
  }, [agentState.answerQuestion]);

  const dismissQuestion = useCallback((questionId: string) => {
    void agentState.dismissQuestion(questionId);
  }, [agentState.dismissQuestion]);

  const updateReasoningView = useCallback((key: string, view: ReasoningView) => {
    setReasoningViews((current) => ({ ...current, [key]: view }));
  }, []);

  const chooseWorkspace = useCallback(() => {
    workspaceState.chooseWorkspace((selected) => {
      sessionState.persistActiveSession({ workspace: selected, messages, tokenUsage });
    });
  }, [messages, sessionState.persistActiveSession, tokenUsage, workspaceState.chooseWorkspace]);

  const permissionContext = useCallback(() => {
    return {
      workspace: workspaceState.workspace || ".",
      sessionId: sessionState.activeSessionId
    };
  }, [sessionState.activeSessionId, workspaceState.workspace]);

  const updatePermissionMode = useCallback((mode: "default" | "full") => {
    const enabled = mode === "full";
    agentState.updateFullAccessAutoApproval(enabled, permissionContext());
  }, [agentState.updateFullAccessAutoApproval, permissionContext]);

  const resetCommandAutoApproval = useCallback(() => {
    agentState.resetCommandAutoApproval(permissionContext());
  }, [agentState.resetCommandAutoApproval, permissionContext]);

  return (
    <div
      className="app-shell"
      style={{
        gridTemplateColumns: isMobile
          ? "1fr"
          : `${leftSidebarCollapsed ? 0 : leftSidebarWidth}px ${leftSidebarCollapsed ? 0 : RESIZE_HANDLE_WIDTH}px minmax(${MIN_CONVERSATION_WIDTH}px, 1fr) ${rightSidebarCollapsed ? 0 : RESIZE_HANDLE_WIDTH}px ${rightSidebarCollapsed ? 0 : rightSidebarWidth}px`
      }}
    >
      {(!isMobile ? !leftSidebarCollapsed : activeMobileTab === "chats") && (
        <Sidebar
          activeSessionId={sessionState.activeSessionId}
          busy={agentState.busy}
          cancelRenameSession={sessionState.cancelRenameSession}
          cancelSearchWorkspace={workspaceState.cancelSearchWorkspace}
          chooseWorkspace={chooseWorkspace}
          commitRenameSession={sessionState.commitRenameSession}
          deleteSession={sessionState.deleteSession}
          expandedDirs={workspaceState.expandedDirs}
          fileSearch={workspaceState.fileSearch}
          language={language}
          loadingDirs={workspaceState.loadingDirs}
          openFile={workspaceState.openFile}
          renamingSessionId={sessionState.renamingSessionId}
          renamingTitle={sessionState.renamingTitle}
          searchResults={workspaceState.searchResults}
          searchingFiles={workspaceState.searchingFiles}
          searchWorkspace={workspaceState.searchWorkspace}
          selectSession={sessionState.selectSession}
          sessions={sessionState.sessions}
          setFileSearch={workspaceState.setFileSearch}
          setRenamingTitle={sessionState.setRenamingTitle}
          setSidebarSection={setSidebarSection}
          sidebarSection={sidebarSection}
          startNewSession={sessionState.startNewSession}
          startRenameSession={sessionState.startRenameSession}
          t={t}
          toggleDirectory={workspaceState.toggleDirectory}
          tree={workspaceState.tree}
          visibleTree={workspaceState.visibleTree}
          workspace={workspaceState.workspace}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}

      {!isMobile && !leftSidebarCollapsed && (
        <div
          className="column-resize-handle left"
          role="separator"
          aria-orientation="vertical"
          aria-label={language === "zh" ? "调整左侧边栏宽度" : "Resize left sidebar"}
          onPointerDown={(event) => startColumnResize("left", event)}
        />
      )}

      {(!isMobile || activeMobileTab === "chat") && (
        <Conversation
          activeCommands={activeCommands}
          activePatches={activePatches}
          activeQuestions={activeQuestions}
          activeToolRuns={agentState.activeToolRuns}
          answerQuestion={answerQuestion}
          approveCommand={agentState.approveCommand}
          applyPatch={agentState.applyPatch}
          attachFile={workspaceState.attachFile}
          attachDroppedFiles={workspaceState.attachDroppedFiles}
          attachedFiles={workspaceState.attachedFiles}
          busy={agentState.busy}
          cancelActiveRequest={agentState.cancelActiveRequest}
          chooseWorkspace={chooseWorkspace}
          commandAutoApproval={agentState.commandAutoApproval}
          commandAutoApprovalExpiresAt={agentState.commandAutoApprovalExpiresAt}

          composerInputRef={composerInputRef}
          configContextTokens={inputBudgetTokens}
          contextCompression={agentState.contextCompression}
          contextCompressionStatus={agentState.contextCompressionStatus}
          contextPercent={contextPercent}
          contextUsageLabel={contextUsageLabel}
          copyMessage={copyMessage}
          detachFile={workspaceState.detachFile}
          discardCommand={agentState.discardCommand}
          discardPatch={agentState.discardPatch}
          dismissQuestion={dismissQuestion}
          input={input}
          isOnline={isOnline}
          language={language}
          messageListRef={messageListRef}
          messages={messages}
          patchAutoApproval={agentState.patchAutoApproval}
          patchAutoApprovalExpiresAt={agentState.patchAutoApprovalExpiresAt}
          previewFile={workspaceState.previewFile}
          reasoningViews={reasoningViews}
          regenerateMessage={regenerateMessage}
          resetCommandAutoApproval={resetCommandAutoApproval}
          retryLastRequest={retryLastRequest}
          retryRequestPending={Boolean(retryRequest) && isOnline}
          send={send}
          streamRecoveryStatus={agentState.streamRecoveryStatus}
          taskStatus={agentState.taskStatus}
          sessionContextTokenCount={contextTokenCount}
          setInput={setInput}

          streamingResponse={agentState.streamingResponse}
          t={t}
          toolDraft={agentState.toolDraft}
          showScrollToBottom={showScrollToBottom}
          scrollToBottom={scrollToBottom}
          updatePermissionMode={updatePermissionMode}
          updateReasoningView={updateReasoningView}
          uploadAttachmentFiles={workspaceState.uploadAttachmentFiles}
          workspace={workspaceState.workspace}
          leftSidebarCollapsed={leftSidebarCollapsed}
          toggleLeftSidebar={toggleLeftSidebar}
          rightSidebarCollapsed={rightSidebarCollapsed}
          toggleRightSidebar={toggleRightSidebar}
        />
      )}

      {!isMobile && !rightSidebarCollapsed && (
        <div
          className="column-resize-handle right"
          role="separator"
          aria-orientation="vertical"
          aria-label={language === "zh" ? "调整右侧边栏宽度" : "Resize right sidebar"}
          onPointerDown={(event) => startColumnResize("right", event)}
        />
      )}

      {(!isMobile ? !rightSidebarCollapsed : activeMobileTab === "activity") && (
        <ActivityPanel
          activityFilter={activityFilter}
          activityListRef={activityListRef}
          activitySearch={activitySearch}
          events={events}
          filteredEvents={filteredEvents}
          language={language}
          planItems={agentState.planItems}
          rightSidebarSection={rightSidebarSection}
          setActivityFilter={setActivityFilter}
          setActivitySearch={setActivitySearch}
          setRightSidebarSection={setRightSidebarSection}
          showActivityScrollToBottom={showActivityScrollToBottom}
          scrollActivityToBottom={scrollActivityToBottom}
          t={t}
          activeToolRuns={agentState.activeToolRuns}
        />
      )}

      {isMobile && (
        <div className="mobile-tab-bar">
          <button
            className={`mobile-tab-btn ${activeMobileTab === "chats" ? "active" : ""}`}
            onClick={() => setActiveMobileTab("chats")}
          >
            <span className="mobile-tab-btn-icon">💬</span>
            <span>会话</span>
          </button>
          <button
            className={`mobile-tab-btn ${activeMobileTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveMobileTab("chat")}
          >
            <span className="mobile-tab-btn-icon">🤖</span>
            <span>对话</span>
          </button>
          <button
            className={`mobile-tab-btn ${activeMobileTab === "activity" ? "active" : ""}`}
            onClick={() => setActiveMobileTab("activity")}
          >
            <span className="mobile-tab-btn-icon">📋</span>
            <span>运行状态</span>
          </button>
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        language={language}
        setLanguage={setLanguage}
        theme={theme}
        setTheme={setTheme}
        config={providerState.config}
        setConfig={providerState.setConfig}
        configPath={providerState.configPath}
        providerHint={providerState.providerHint}
        testingApi={providerState.testingApi}
        testApi={providerState.testApi}
        checkingBalance={providerState.checkingBalance}
        queryBalance={providerState.queryBalance}
        balanceResult={providerState.balanceResult}
        tokenUsage={tokenUsage}
        updateProvider={providerState.updateProvider}
        busy={agentState.busy}
        t={t}
      />
    </div>
  );
}

function mergeOpenPathAttachments(current: AttachedFile[], incoming: AttachedFile[]) {
  const next = [...current];
  const indexByPath = new Map(next.map((file, index) => [file.path, index]));
  for (const file of incoming) {
    const existingIndex = indexByPath.get(file.path);
    if (existingIndex === undefined) {
      indexByPath.set(file.path, next.length);
      next.push(file);
      continue;
    }
    const existing = next[existingIndex];
    next[existingIndex] = {
      ...existing,
      duplicateCount: (existing.duplicateCount || 1) + 1
    };
  }
  return next;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
