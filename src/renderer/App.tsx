import "./fallback-bridge";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Conversation } from "./components/Conversation";
import { Sidebar } from "./components/Sidebar";
import { SettingsModal } from "./components/SettingsModal";
import { GitUpdateModal } from "./components/conversation/GitUpdateModal";
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
  ChatMessage,
  ReasoningView,
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
  copyText
} from "./utils";
import { getInputBudgetTokens } from "../shared/contextBudget";
import "./styles.css";

function App() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [activeMobileTab, setActiveMobileTab] = useState<"chats" | "chat">("chat");

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

  // Listen for agent completion to update balance in real-time
  const lastBusyRef = useRef(false);
  useEffect(() => {
    if (lastBusyRef.current && !agentState.busy) {
      if (providerState.config.provider === "deepseek" && providerState.config.apiKey) {
        providerState.queryBalance(true);
      }
    }
    lastBusyRef.current = agentState.busy;
  }, [agentState.busy, providerState.config.provider, providerState.config.apiKey, providerState.queryBalance]);

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

  // Git update state
  const [gitUpdateState, setGitUpdateState] = useState<{
    available: boolean;
    status: "idle" | "checking" | "updating" | "completed" | "error";
    detail: string;
  }>({
    available: false,
    status: "idle",
    detail: ""
  });

  const [updateError, setUpdateError] = useState<{
    show: boolean;
    message: string;
  }>({
    show: false,
    message: ""
  });

  useEffect(() => {
    let timer: any;
    const check = async () => {
      if (!isOnline) return;
      try {
        const result = await window.agentWindow.checkGitUpdate();
        if (result.updateAvailable) {
          setGitUpdateState(prev => ({
            ...prev,
            available: true
          }));
        } else {
          setGitUpdateState(prev => {
            if (prev.status === "idle" || prev.status === "checking") {
              return { available: false, status: "idle", detail: "" };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error("Git update check failed:", err);
      }
    };

    void check();
    timer = setInterval(check, 15 * 60 * 1000);

    return () => {
      clearInterval(timer);
    };
  }, [isOnline]);

  const handleApplyUpdate = useCallback(async (options?: { forceReset?: boolean }) => {
    if (gitUpdateState.status === "updating") return;
    setGitUpdateState(prev => ({
      ...prev,
      status: "updating",
      detail: language === "zh" ? "正在检查并更新代码..." : "Checking and updating code..."
    }));

    const unsubscribe = window.agentWindow.onGitUpdateProgress((data) => {
      setGitUpdateState(prev => ({
        ...prev,
        detail: data.detail
      }));
    });

    const startTime = Date.now();

    try {
      const result = await window.agentWindow.applyGitUpdate(options);
      
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < 800) {
        await new Promise(resolve => setTimeout(resolve, 800 - elapsedTime));
      }

      if (result.success) {
        setGitUpdateState(prev => ({
          ...prev,
          status: "completed",
          detail: language === "zh" ? "更新成功！请重新启动本软件。" : "Update completed! Please restart the app."
        }));
        setUpdateError({ show: false, message: "" });
      } else {
        const errorDetail = result.error || "";
        setGitUpdateState(prev => ({
          ...prev,
          status: "error",
          detail: (language === "zh" ? "更新失败: " : "Update failed: ") + errorDetail
        }));
        setUpdateError({
          show: true,
          message: errorDetail
        });
      }
    } catch (err: any) {
      const errorDetail = err.message || String(err);
      
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < 800) {
        await new Promise(resolve => setTimeout(resolve, 800 - elapsedTime));
      }

      setGitUpdateState(prev => ({
        ...prev,
        status: "error",
        detail: (language === "zh" ? "更新出错: " : "Update error: ") + errorDetail
      }));
      setUpdateError({
        show: true,
        message: errorDetail
      });
    } finally {
      unsubscribe();
    }
  }, [gitUpdateState.status, language]);


  // Hook 8: Theme Switcher
  const { theme, setTheme } = useTheme();

  // Hook 9: Keyboard Shortcuts Listener
  useKeyboardShortcuts({ toggleLeftSidebar, toggleRightSidebar });

  // Hook 10: Global Drag & Drop Handler
  useDragAndDrop();

  // Hook 11: Token calculation
  const {
    contextTokenCount,
    inputTokenCount
  } = useTokenCounter({
    messages,
    attachedFiles: workspaceState.attachedFiles,
    input
  });

  // Hook 12: Scroll following
  const {
    showScrollToBottom,
    messageListRef,
    scrollToBottom,
    followOutputRef
  } = useScrollFollow({
    messages,
    events,
    patches: agentState.patches,
    commands: agentState.commands,
    questions: agentState.questions,
    activeToolRuns: agentState.activeToolRuns,
    busy: agentState.busy,
    activityFilter: "all",
    activitySearch: "",
    rightSidebarSection: "plan"
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

  const inputBudgetTokens = getInputBudgetTokens(providerState.config.contextTokens, providerState.config.maxTokens);
  const compressedContextTokenCount = agentState.contextCompression.phase === "done" &&
    Number.isFinite(agentState.contextCompression.effectiveTokenCount)
    ? Math.max(0, Number(agentState.contextCompression.effectiveTokenCount)) + inputTokenCount
    : null;
  const displayedContextTokenCount = compressedContextTokenCount ?? contextTokenCount;
  const displayedInputBudgetTokens = agentState.contextCompression.phase === "done" &&
    Number.isFinite(agentState.contextCompression.inputBudgetTokens)
    ? Math.max(1, Number(agentState.contextCompression.inputBudgetTokens))
    : inputBudgetTokens;
  const contextPercent = Math.min(100, Math.round((displayedContextTokenCount / Math.max(displayedInputBudgetTokens, 1)) * 100));
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
    setInput("");
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
          : `${leftSidebarCollapsed ? 0 : 292}px minmax(${MIN_CONVERSATION_WIDTH}px, 1fr)`
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
          balanceResult={providerState.balanceResult}
          checkingBalance={providerState.checkingBalance}
          providerConfig={providerState.config}
          queryBalance={providerState.queryBalance}
          gitUpdateState={gitUpdateState}
          handleApplyUpdate={handleApplyUpdate}
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
          configContextTokens={displayedInputBudgetTokens}
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
          sessionContextTokenCount={displayedContextTokenCount}
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
          planItems={agentState.planItems}
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
        apiTestResult={providerState.apiTestResult}
        testingApi={providerState.testingApi}
        testApi={providerState.testApi}
        importCodexConfig={providerState.importCodexConfig}
        checkingBalance={providerState.checkingBalance}
        queryBalance={providerState.queryBalance}
        balanceResult={providerState.balanceResult}
        tokenUsage={tokenUsage}
        updateProvider={providerState.updateProvider}
        busy={agentState.busy}
        t={t}
      />

      <GitUpdateModal
        language={language}
        show={updateError.show}
        message={updateError.message}
        onClose={() => setUpdateError({ show: false, message: "" })}
        onRetry={() => {
          setUpdateError({ show: false, message: "" });
          void handleApplyUpdate();
        }}
        onForceUpdate={() => {
          setUpdateError({ show: false, message: "" });
          void handleApplyUpdate({ forceReset: true });
        }}
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
