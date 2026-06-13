export {};

declare global {
  interface Window {
    agentWindow: {
      chooseWorkspace: () => Promise<string | null>;
      getWorkspaceTree: (payload: string | { workspace: string; directory?: string }) => Promise<{ directory?: string; items: WorkspaceTreeItem[]; truncated: boolean }>;
      readFile: (payload: { workspace: string; path: string }) => Promise<{ path: string; content: string }>;
      searchFiles: (payload: { workspace: string; query: string; maxResults?: number }) => Promise<WorkspaceSearchResult>;
      chooseAttachmentFiles: () => Promise<AttachedFile[]>;
      readAttachmentFiles: (payload: { paths: string[] }) => Promise<AttachedFile[]>;
      getPathForFile: (file: File) => string;
      getGitSummary: (workspace: string) => Promise<GitSummary>;
      getGitDiff: (workspace: string) => Promise<{ diff: string }>;
      loadSessions: () => Promise<PersistedChatSession[]>;
      saveSessions: (sessions: PersistedChatSession[]) => Promise<{ ok: boolean; count: number; path: string }>;
      loadActivityEvents: () => Promise<PersistedEventLogItem[]>;
      saveActivityEvents: (events: PersistedEventLogItem[]) => Promise<{ ok: boolean; count: number; path: string }>;
      loadSkills: () => Promise<Skill[]>;
      saveSkills: (skills: Skill[]) => Promise<{ ok: boolean; count: number; path: string }>;
      listPendingApprovals: (payload?: { sessionId?: string }) => Promise<Array<ApprovalRecord>>;
      getAutoApprovalState: (payload: AutoApprovalRequest) => Promise<AutoApprovalState>;
      loadConfig: () => Promise<{ config: ProviderConfig & { recoveredFromError?: string }; path: string }>;
      saveConfig: (config: ProviderConfig) => Promise<{ ok: boolean; path: string }>;
      getSystemState: () => Promise<SystemState>;
      showNotification: (payload: { title: string; body?: string; silent?: boolean }) => Promise<{ ok: boolean; reason?: string }>;
      startDictation: () => Promise<{ ok: boolean; error?: string }>;
      openSystemPaths: (payload: { paths: string[] }) => Promise<{ ok: boolean } | void>;
      setOpenPathsReady: () => Promise<{ ok: boolean }>;
      checkForUpdates: () => Promise<UpdateState>;
      checkGitUpdate: () => Promise<{ updateAvailable: boolean; localHash?: string; remoteHash?: string; branch?: string; error?: string }>;
      applyGitUpdate: (options?: { forceReset?: boolean }) => Promise<{ success: boolean; npmInstalled?: boolean; error?: string }>;
      onGitUpdateProgress: (callback: (data: { status: "pulling" | "checking_deps" | "installing_deps" | "completed" | "error"; detail: string }) => void) => () => void;
      listBackgroundTasks: (payload?: { includeCompleted?: boolean }) => Promise<BackgroundTask[]>;
      scheduleBackgroundTask: (payload: {
        title?: string;
        body?: string;
        runAt?: string;
        delayMinutes?: number;
        intervalMinutes?: number;
        workspace?: string;
        sessionId?: string;
        requestId?: string;
      }) => Promise<BackgroundTask>;
      cancelBackgroundTask: (id: string) => Promise<{ ok: boolean; task: BackgroundTask | null }>;
      sendMessage: (payload: AgentRequest) => Promise<{ ok: boolean; cancelled?: boolean }>;
      resumeApproval: (payload: ApprovalResumeRequest) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
      cancelMessage: (requestId: string) => Promise<{ ok: boolean }>;
      shellOpen: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      testProvider: (config: ProviderConfig) => Promise<{ ok: true; result: ProviderTestResult } | { ok: false; error: string }>;
      getBalance: (config: ProviderConfig) => Promise<{ ok: true; result: ProviderBalanceResult } | { ok: false; error: string }>;
      countTokens: (payload: { messages: ChatMessage[]; input: string; attachments: AttachedFile[] }) => Promise<{ tokens: number }>;
      applyPatch: (payload: string | { patchId: string; language?: "zh" | "en" }) => Promise<{ ok: true; result: { ok: boolean; patchId: string; summary: string; strategy?: string; warning?: string } } | { ok: false; error: string }>;
      discardPatch: (patchId: string) => Promise<{ ok: boolean; patchId: string }>;
      approveCommand: (payload: { commandId: string; allowFuture?: boolean; language?: "zh" | "en" }) => Promise<{ ok: true; result: { ok: boolean; commandId: string; command: string; result: string; cwd?: string; timeoutMs?: number; shell?: string; inheritedEnv?: boolean; highRisk: boolean; autoApproveFutureCommands: boolean; commandAutoApproval: boolean; patchAutoApproval: boolean; fullAccessAutoApproval?: boolean; commandAutoApprovalExpiresAt?: number | null; patchAutoApprovalExpiresAt?: number | null } } | { ok: false; error: string }>;
      discardCommand: (commandId: string) => Promise<{ ok: boolean; commandId: string }>;
      setCommandAutoApproval: (payload: AutoApprovalRequest) => Promise<AutoApprovalState>;
      setPatchAutoApproval: (payload: AutoApprovalRequest) => Promise<AutoApprovalState>;
      setFullAccessAutoApproval: (payload: AutoApprovalRequest) => Promise<AutoApprovalState>;
      onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
      onOpenPaths: (callback: (payload: OpenPathsPayload) => void) => () => void;
      onSessionsUpdated: (callback: () => void) => () => void;
    };
  }
}

export type ChatToolCall = {
  id: string;
  type?: "function" | string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type ChatMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  createdAt?: number;
  reasoning?: string;
  reasoningDurationMs?: number;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
  toolArgs?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  toolStatus?: "running" | "completed" | "error";
  toolError?: string;
};

export type ProviderConfig = {
  provider: "deepseek" | "openai-compatible";
  baseUrl: string;
  model: string;
  summaryModel: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  contextTokens: number;
  maxAgentSteps: number;
  thinkingMode: "enabled" | "disabled";
  reasoningEffort: "low" | "medium" | "high" | "max";
  capability?: ProviderModelCapability;
  telegramEnabled?: boolean;
  telegramAllowedUserId?: string;
  telegramBotToken?: string;
};

export type Skill = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  type: "prompt" | "code";
  prompt: string;
  code: string;
  intervalMinutes: number;
  runAt: number;
  createdAt: number;
  updatedAt: number;
};

export type ProviderModelCapability = {
  label: string;
  contextTokens: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsToolCalls: boolean;
  supportsTemperature: boolean;
  balancePath?: string;
};

export type ProviderTestResult = {
  ok: boolean;
  latencyMs: number;
  model: string;
  content: string;
  usage: unknown;
};

export type ProviderBalanceResult = {
  is_available: boolean;
  balance_infos: Array<{
    currency: "CNY" | "USD" | string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }>;
};

export type AgentRequest = {
  requestId: string;
  sessionId?: string;
  language?: "zh" | "en";
  workspace: string;
  input: string;
  providerConfig: ProviderConfig;
  messages: ChatMessage[];
  attachments: AttachedFile[];
  permissionMode?: PermissionMode;
};

export type PersistedEventLogItem = {
  id: string;
  title: string;
  body: string;
  kind: "status" | "tool" | "error" | "model" | "patch";
  createdAt: number;
};

export type PersistedChatSession = {
  id: string;
  title: string;
  titleEdited: boolean;
  workspace: string;
  messages: ChatMessage[];
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
  };
  createdAt: number;
  updatedAt: number;
};

export type ApprovalRecord =
  | {
      kind: "command";
      id: string;
      continuationId: string;
      sessionId: string;
      workspace: string;
      requestId: string;
      createdAt: number;
      command: string;
      reason: string;
      cwd?: string;
      timeoutMs?: number | null;
      shell?: string;
      inheritedEnv?: boolean;
      highRisk?: boolean;
    }
  | {
      kind: "patch";
      id: string;
      continuationId: string;
      sessionId: string;
      workspace: string;
      requestId: string;
      createdAt: number;
      summary: string;
      patch: string;
      toolName?: string;
    }
  | {
      kind: "question";
      id: string;
      continuationId: string;
      sessionId: string;
      workspace: string;
      requestId: string;
      createdAt: number;
      question: string;
      context?: string;
      options: string[];
    };

export type ApprovalResumeRequest = {
  requestId: string;
  continuationId: string;
  kind: "command" | "patch" | "question";
  decision?: "approved" | "discarded" | "dismissed";
  answer?: string;
  option?: string;
  allowFuture?: boolean;
  language?: "zh" | "en";
};

export type WorkspaceTreeItem = {
  path: string;
  name: string;
  type: "file" | "directory";
  depth: number;
  loaded?: boolean;
  hasChildren?: boolean;
};

export type WorkspaceSearchResult = {
  results: Array<{ file: string; line: number; text: string }>;
  truncated: boolean;
  engine: string;
};

export type AttachedFile = {
  path: string;
  content: string;
  status?: "ready" | "large" | "binary" | "truncated";
  size?: number;
  chars?: number;
  truncated?: boolean;
  duplicateCount?: number;
};

export type GitSummary = {
  branch: string;
  changedFiles: Array<{ status: string; path: string }>;
  commitDraft: string;
};

export type PlanItem = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

export type PermissionMode = "default" | "full";

export type OpenPathsPayload = {
  paths: string[];
  directories: string[];
  files: string[];
  missing: string[];
  workspaceHint: string;
};

export type SystemState = {
  desktop: {
    appVersion: string;
    platform: string;
    trayEnabled: boolean;
    globalShortcutRegistered: boolean;
    globalShortcutAccelerator: string;
    notificationsSupported: boolean;
    activeRequests: number;
    backgroundMode: boolean;
  };
  updates: UpdateState;
};

export type UpdateState = {
  ok: boolean;
  configured: boolean;
  status: string;
  reason?: string;
  updateUrl?: string;
  version?: string;
  updateInfo?: unknown;
  progress?: unknown;
};

export type BackgroundTask = {
  id: string;
  title: string;
  body: string;
  runAt: number;
  intervalMs: number;
  status: "scheduled" | "completed" | "cancelled";
  workspace: string;
  sessionId: string;
  requestId: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number;
  runs: number;
};

export type AutoApprovalRequest = {
  enabled: boolean;
  workspace: string;
  sessionId?: string;
  requestId?: string;
};

export type AutoApprovalState = {
  ok: boolean;
  commandAutoApproval: boolean;
  patchAutoApproval: boolean;
  fullAccessAutoApproval?: boolean;
  autoApproveFutureCommands?: boolean;
  commandAutoApprovalExpiresAt?: number | null;
  patchAutoApprovalExpiresAt?: number | null;
  ttlMs?: number | null;
};

export type AgentEvent =
  | { requestId: string; type: "status"; message: string }
  | { requestId: string; type: "context_compression"; phase: "start" | "done" | "failed"; message: string; summary?: string }
  | { requestId: string; type: "stream_delta"; text: string }
  | { requestId: string; type: "reasoning_delta"; text: string }
  | { requestId: string; type: "tool_call_delta"; name?: string; text: string }
  | { requestId: string; type: "stream_recovery"; message: string; attempt: number; maxAttempts: number; recovering: boolean }
  | { requestId: string; type: "plan_update"; items: PlanItem[] }
  | { requestId: string; type: "model"; message: string; provider: string; model: string; finishReason?: string | null; reasoning?: string; usage?: unknown; tool_calls?: ChatToolCall[] }
  | { requestId: string; type: "tool_start"; name: string; args: string; toolCallId?: string }
  | { requestId: string; type: "tool_result"; name: string; result: string; toolCallId?: string }
  | { requestId: string; type: "tool_error"; name: string; message: string; toolCallId?: string; result?: string }
  | { requestId: string; type: "patch_proposed"; patchId: string; summary: string; patch: string }
  | { requestId: string; type: "patch_applied"; patchId: string; summary: string; strategy?: string }
  | { requestId: string; type: "command_pending"; commandId: string; command: string; reason: string; cwd?: string; timeoutMs?: number | null; shell?: string; inheritedEnv?: boolean; highRisk?: boolean }
  | { requestId: string; type: "ask_user_pending"; questionId: string; question: string; context?: string; options?: string[] }
  | { requestId: string; type: "error"; message: string }
  | { requestId: string; type: "cancelled"; message: string }
  | { requestId: string; type: "done" };
