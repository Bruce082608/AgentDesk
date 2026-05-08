import type { AttachedFile, ChatMessage, GitSummary, PermissionMode, PlanItem, ProviderBalanceResult, ProviderConfig, WorkspaceTreeItem } from "./global";

/* ---- UI-only types ---- */

export type EventLogItem = {
  id: string;
  title: string;
  body: string;
  kind: "status" | "tool" | "error" | "model" | "patch";
  createdAt: number;
};

export type PatchItem = {
  id: string;
  summary: string;
  patch: string;
  status: "pending" | "applied" | "discarded" | "failed";
  error?: string;
};

export type CommandItem = {
  id: string;
  command: string;
  reason: string;
  cwd?: string;
  timeoutMs?: number | null;
  shell?: string;
  inheritedEnv?: boolean;
  highRisk: boolean;
  status: "pending" | "approved" | "discarded" | "failed";
  result?: string;
  error?: string;
};

export type AutoApprovalState = {
  commandAutoApproval: boolean;
  patchAutoApproval: boolean;
  commandAutoApprovalExpiresAt?: number | null;
  patchAutoApprovalExpiresAt?: number | null;
};

export type UserQuestionItem = {
  id: string;
  question: string;
  context?: string;
  options: string[];
  status: "pending" | "dismissed";
};

export type ToolDraft = {
  name: string;
  text: string;
};

export type ToolRun = {
  id: string;
  name: string;
  args: string;
  startedAt: number;
};

export type StreamRecoveryStatus = {
  message: string;
  attempt: number;
  maxAttempts: number;
  recovering: boolean;
};

export type ContextCompressionState = {
  phase: "idle" | "start" | "done" | "failed";
  message: string;
  summary?: string;
  updatedAt?: number;
};

export type SearchMatch = {
  file: string;
  line: number;
  text: string;
};

export type TokenUsageStats = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
};

export type ChatSession = {
  id: string;
  title: string;
  titleEdited: boolean;
  workspace: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsageStats;
  createdAt: number;
  updatedAt: number;
};

export type SidebarSection = "files" | "advanced";
export type RightSidebarSection = "plan" | "activity";
export type ActivityFilter = "all" | "tool" | "error" | "approval" | "system";
export type ThemeMode = "light" | "dark" | "system";
export type ReasoningView = "preview" | "full" | "collapsed";

/* ---- Re-export from shared types ---- */
export type { AttachedFile, ChatMessage, GitSummary, PermissionMode, PlanItem, ProviderBalanceResult, ProviderConfig, WorkspaceTreeItem };

/* ---- Constants ---- */

export const CHAT_SESSIONS_KEY = "agent-chat-sessions";
export const THEME_KEY = "agent-ui-theme";
export const LANGUAGE_KEY = "agent-ui-language";
export const LEFT_SIDEBAR_WIDTH_KEY = "agent-left-sidebar-width";
export const RIGHT_SIDEBAR_WIDTH_KEY = "agent-right-sidebar-width";
export const COMPOSER_HEIGHT_KEY = "agent-composer-height";
export const MAX_SAVED_SESSIONS = 30;
export const MAX_ACTIVITY_EVENTS = 5000;
export const MIN_LEFT_SIDEBAR_WIDTH = 220;
export const MAX_LEFT_SIDEBAR_WIDTH = 480;
export const MIN_RIGHT_SIDEBAR_WIDTH = 260;
export const MAX_RIGHT_SIDEBAR_WIDTH = 560;
export const MIN_CONVERSATION_WIDTH = 440;
export const RESIZE_HANDLE_WIDTH = 7;
export const MIN_COMPOSER_HEIGHT = 72;
export const MAX_COMPOSER_HEIGHT = 260;

export const emptyTokenUsage = (): TokenUsageStats => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requests: 0
});

export const defaultConfig: ProviderConfig = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  summaryModel: "deepseek-v4-flash",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 32768,
  contextTokens: 1000000,
  maxAgentSteps: 64,
  thinkingMode: "enabled",
  reasoningEffort: "max"
};
