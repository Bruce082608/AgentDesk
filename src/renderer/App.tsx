import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActivityPanel } from "./components/ActivityPanel";
import { Conversation } from "./components/Conversation";
import { Sidebar } from "./components/Sidebar";
import type { Language } from "./i18n";
import { translations } from "./i18n";
import { useActivityLog } from "./hooks/useActivityLog";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useProviderConfig } from "./hooks/useProviderConfig";
import { useSessions } from "./hooks/useSessions";
import { useWorkspace } from "./hooks/useWorkspace";
import type {
  ActivityFilter,
  ChatMessage,
  ReasoningView,
  RightSidebarSection,
  SidebarSection,
  ThemeMode,
  TokenUsageStats
} from "./types";
import {
  COMPOSER_HEIGHT_KEY,
  LEFT_SIDEBAR_WIDTH_KEY,
  MAX_COMPOSER_HEIGHT,
  MAX_LEFT_SIDEBAR_WIDTH,
  MAX_RIGHT_SIDEBAR_WIDTH,
  MIN_COMPOSER_HEIGHT,
  MIN_CONVERSATION_WIDTH,
  MIN_LEFT_SIDEBAR_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  RESIZE_HANDLE_WIDTH,
  RIGHT_SIDEBAR_WIDTH_KEY,
  THEME_KEY,
  LANGUAGE_KEY,
  emptyTokenUsage
} from "./types";
import {
  copyText,
  filterActivityEvents,
  formatQuestionAnswer,
  readStoredNumber
} from "./utils";
import { getInputBudgetTokens } from "../shared/contextBudget";
import "./styles.css";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reasoningViews, setReasoningViews] = useState<Record<string, ReasoningView>>({});
  const [rightSidebarSection, setRightSidebarSection] = useState<RightSidebarSection>("plan");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("chats");
  const [tokenUsage, setTokenUsage] = useState<TokenUsageStats>(() => emptyTokenUsage());
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [retryRequest, setRetryRequest] = useState<null | {
    inputText: string;
    priorMessages: ChatMessage[];
    nextMessages: ChatMessage[];
  }>(null);
  const [baseContextTokenCount, setBaseContextTokenCount] = useState(0);
  const [inputTokenCount, setInputTokenCount] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showActivityScrollToBottom, setShowActivityScrollToBottom] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light" || saved === "system") return saved;
    return "light";
  });
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return saved === "en" ? "en" : "zh";
  });
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredNumber(LEFT_SIDEBAR_WIDTH_KEY, 292, MIN_LEFT_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH)
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readStoredNumber(RIGHT_SIDEBAR_WIDTH_KEY, 340, MIN_RIGHT_SIDEBAR_WIDTH, MAX_RIGHT_SIDEBAR_WIDTH)
  );
  const [composerHeight, setComposerHeight] = useState(() =>
    readStoredNumber(COMPOSER_HEIGHT_KEY, 78, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT)
  );

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const activityListRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const followOutputRef = useRef(true);
  const followActivityRef = useRef(true);
  const t = translations[language];

  const { appendEvent, events, resetEvents } = useActivityLog();
  const workspaceState = useWorkspace({ appendEvent, t });
  const agentState = useAgentEvents({
    appendEvent,
    language,
    refreshGit: workspaceState.refreshGit,
    refreshWorkspace: workspaceState.refreshWorkspace,
    setMessages,
    setTokenUsage
  });
  const providerState = useProviderConfig({
    appendEvent,
    busy: agentState.busy,
    setIsOnline,
    t
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

  // ---- Document-level drag-and-drop ----
  // On Windows Electron, the window must call preventDefault() on dragover
  // at the document level to accept native file drops.  Without this the
  // cursor shows "not allowed" as soon as it enters the window, and the
  // per-element handlers on the conversation never get a chance to fire.
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);

    if (theme !== "system") {
      document.body.dataset.theme = theme;
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = () => {
      document.body.dataset.theme = mediaQuery.matches ? "dark" : "light";
    };
    applySystemTheme();

    mediaQuery.addEventListener("change", applySystemTheme);
    return () => mediaQuery.removeEventListener("change", applySystemTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(leftSidebarWidth));
  }, [leftSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(composerHeight));
  }, [composerHeight]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (retryRequest) appendEvent("status", t.networkRestoredTitle, t.networkRestoredBody);
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [appendEvent, retryRequest, t.networkRestoredBody, t.networkRestoredTitle]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.agentWindow.countTokens({ messages, input: "", attachments: workspaceState.attachedFiles })
        .then((result) => {
          if (!cancelled) setBaseContextTokenCount(result.tokens);
        })
        .catch(() => {
          if (!cancelled) setBaseContextTokenCount(0);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [messages, workspaceState.attachedFiles]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.agentWindow.countTokens({ messages: [], input, attachments: [] })
        .then((result) => {
          if (!cancelled) setInputTokenCount(result.tokens);
        })
        .catch(() => {
          if (!cancelled) setInputTokenCount(0);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input]);

  useEffect(() => {
    if (!followOutputRef.current) return;
    const list = messageListRef.current;
    if (!list) return;
    requestAnimationFrame(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "instant" });
    });
  }, [messages, events, agentState.patches, agentState.commands, agentState.questions, agentState.activeToolRuns, agentState.busy]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;

    const onUserScroll = () => {
      const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      followOutputRef.current = distanceToBottom < 32;
      const shouldShow = !followOutputRef.current;
      setShowScrollToBottom(prev => prev !== shouldShow ? shouldShow : prev);
    };

    list.addEventListener("scroll", onUserScroll, { passive: true });
    return () => list.removeEventListener("scroll", onUserScroll);
  }, [agentState.busy]);

  useEffect(() => {
    if (rightSidebarSection !== "activity") return;
    followActivityRef.current = true;
    setShowActivityScrollToBottom(false);
  }, [rightSidebarSection]);

  useEffect(() => {
    if (rightSidebarSection !== "activity") return;
    if (!followActivityRef.current) return;
    const list = activityListRef.current;
    if (!list) return;
    requestAnimationFrame(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "instant" });
    });
  }, [events, activityFilter, activitySearch, rightSidebarSection]);

  useEffect(() => {
    const list = activityListRef.current;
    if (!list) return;

    const onActivityScroll = () => {
      const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      followActivityRef.current = distanceToBottom < 32;
      const shouldShow = rightSidebarSection === "activity" && !followActivityRef.current;
      setShowActivityScrollToBottom(prev => prev !== shouldShow ? shouldShow : prev);
    };

    list.addEventListener("scroll", onActivityScroll, { passive: true });
    return () => list.removeEventListener("scroll", onActivityScroll);
  }, [rightSidebarSection]);

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
  const contextTokenCount = baseContextTokenCount + inputTokenCount;
  const contextPercent = Math.min(100, Math.round((contextTokenCount / Math.max(inputBudgetTokens, 1)) * 100));
  const contextUsageLabel = `${contextPercent}%`;

  const scrollToBottom = useCallback(() => {
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    followOutputRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  const scrollActivityToBottom = useCallback(() => {
    const list = activityListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    followActivityRef.current = true;
    setShowActivityScrollToBottom(false);
  }, []);

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
    setShowScrollToBottom(false);
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
      attachments: workspaceState.attachedFiles
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
    workspaceState.attachedFiles,
    workspaceState.workspace
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
    if (agentState.busy) return;
    const question = agentState.questions.find((item) => item.id === questionId);
    if (!question) return;
    agentState.setQuestions((current) => current.map((item) => item.id === questionId ? { ...item, status: "dismissed" } : item));
    const answer = formatQuestionAnswer(question.question, option);
    await startAgentRequest({
      inputText: answer,
      priorMessages: messages,
      nextMessages: [...messages, { role: "user", content: answer, createdAt: Date.now() }]
    });
  }, [agentState.busy, agentState.questions, agentState.setQuestions, messages, startAgentRequest]);

  const dismissQuestion = useCallback((questionId: string) => {
    agentState.setQuestions((current) => current.map((item) => item.id === questionId ? { ...item, status: "dismissed" } : item));
  }, [agentState.setQuestions]);

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

  function startColumnResize(side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startLeftWidth = leftSidebarWidth;
    const startRightWidth = rightSidebarWidth;

    const move = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const availableWidth = window.innerWidth - MIN_CONVERSATION_WIDTH - RESIZE_HANDLE_WIDTH * 2;
      if (side === "left") {
        const maxWidth = Math.min(MAX_LEFT_SIDEBAR_WIDTH, Math.max(MIN_LEFT_SIDEBAR_WIDTH, availableWidth - startRightWidth));
        setLeftSidebarWidth(Math.min(Math.max(startLeftWidth + deltaX, MIN_LEFT_SIDEBAR_WIDTH), maxWidth));
      } else {
        const maxWidth = Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, availableWidth - startLeftWidth));
        setRightSidebarWidth(Math.min(Math.max(startRightWidth - deltaX, MIN_RIGHT_SIDEBAR_WIDTH), maxWidth));
      }
    };

    const stop = () => {
      document.body.classList.remove("resizing-columns");
      window.removeEventListener("pointermove", move);
    };

    document.body.classList.add("resizing-columns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function startComposerResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = composerHeight;

    const move = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxHeight = Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, window.innerHeight - 220));
      setComposerHeight(Math.min(Math.max(startHeight + deltaY, MIN_COMPOSER_HEIGHT), maxHeight));
    };

    const stop = () => {
      document.body.classList.remove("resizing-rows");
      window.removeEventListener("pointermove", move);
    };

    document.body.classList.add("resizing-rows");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <div
      className="app-shell"
      style={{ gridTemplateColumns: `${leftSidebarWidth}px ${RESIZE_HANDLE_WIDTH}px minmax(${MIN_CONVERSATION_WIDTH}px, 1fr) ${RESIZE_HANDLE_WIDTH}px ${rightSidebarWidth}px` }}
    >
      <Sidebar
        activeSessionId={sessionState.activeSessionId}
        balanceResult={providerState.balanceResult}
        busy={agentState.busy}
        cancelRenameSession={sessionState.cancelRenameSession}
        cancelSearchWorkspace={workspaceState.cancelSearchWorkspace}
        checkingBalance={providerState.checkingBalance}
        chooseWorkspace={chooseWorkspace}
        commitRenameSession={sessionState.commitRenameSession}
        config={providerState.config}
        configPath={providerState.configPath}
        deleteSession={sessionState.deleteSession}
        expandedDirs={workspaceState.expandedDirs}
        fileSearch={workspaceState.fileSearch}
        language={language}
        loadingDirs={workspaceState.loadingDirs}
        openFile={workspaceState.openFile}
        providerHint={providerState.providerHint}
        queryBalance={providerState.queryBalance}
        renamingSessionId={sessionState.renamingSessionId}
        renamingTitle={sessionState.renamingTitle}
        searchResults={workspaceState.searchResults}
        searchingFiles={workspaceState.searchingFiles}
        searchWorkspace={workspaceState.searchWorkspace}
        selectSession={sessionState.selectSession}
        sessions={sessionState.sessions}
        setConfig={providerState.setConfig}
        setFileSearch={workspaceState.setFileSearch}
        setRenamingTitle={sessionState.setRenamingTitle}
        setSidebarSection={setSidebarSection}
        sidebarSection={sidebarSection}
        startNewSession={sessionState.startNewSession}
        startRenameSession={sessionState.startRenameSession}
        t={t}
        testingApi={providerState.testingApi}
        testApi={providerState.testApi}
        tokenUsage={tokenUsage}
        toggleDirectory={workspaceState.toggleDirectory}
        tree={workspaceState.tree}
        updateProvider={providerState.updateProvider}
        visibleTree={workspaceState.visibleTree}
        workspace={workspaceState.workspace}
      />

      <div
        className="column-resize-handle left"
        role="separator"
        aria-orientation="vertical"
        aria-label={language === "zh" ? "调整左侧边栏宽度" : "Resize left sidebar"}
        onPointerDown={(event) => startColumnResize("left", event)}
      />

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
        composerHeight={composerHeight}
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
        sessionContextTokenCount={contextTokenCount}
        setInput={setInput}
        setLanguage={setLanguage}
        setTheme={setTheme}
        startComposerResize={startComposerResize}
        streamingResponse={agentState.streamingResponse}
        t={t}
        theme={theme}
        toolDraft={agentState.toolDraft}
        showScrollToBottom={showScrollToBottom}
        scrollToBottom={scrollToBottom}
        updatePermissionMode={updatePermissionMode}
        updateReasoningView={updateReasoningView}
        uploadAttachmentFiles={workspaceState.uploadAttachmentFiles}
        workspace={workspaceState.workspace}
      />

      <div
        className="column-resize-handle right"
        role="separator"
        aria-orientation="vertical"
        aria-label={language === "zh" ? "调整右侧边栏宽度" : "Resize right sidebar"}
        onPointerDown={(event) => startColumnResize("right", event)}
      />

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
      />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
