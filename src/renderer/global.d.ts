export {};

declare global {
  interface Window {
    agentWindow: {
      chooseWorkspace: () => Promise<string | null>;
      getWorkspaceTree: (workspace: string) => Promise<{ items: WorkspaceTreeItem[]; truncated: boolean }>;
      readFile: (payload: { workspace: string; path: string }) => Promise<{ path: string; content: string }>;
      searchFiles: (payload: { workspace: string; query: string; maxResults?: number }) => Promise<WorkspaceSearchResult>;
      chooseAttachmentFiles: () => Promise<AttachedFile[]>;
      getGitSummary: (workspace: string) => Promise<GitSummary>;
      getGitDiff: (workspace: string) => Promise<{ diff: string }>;
      loadConfig: () => Promise<{ config: ProviderConfig & { recoveredFromError?: string }; path: string }>;
      saveConfig: (config: ProviderConfig) => Promise<{ ok: boolean; path: string }>;
      sendMessage: (payload: AgentRequest) => Promise<{ ok: boolean; cancelled?: boolean }>;
      cancelMessage: (requestId: string) => Promise<{ ok: boolean }>;
      testProvider: (config: ProviderConfig) => Promise<{ ok: true; result: ProviderTestResult } | { ok: false; error: string }>;
      getBalance: (config: ProviderConfig) => Promise<{ ok: true; result: ProviderBalanceResult } | { ok: false; error: string }>;
      countTokens: (payload: { messages: ChatMessage[]; input: string; attachments: AttachedFile[] }) => Promise<{ tokens: number }>;
      applyPatch: (payload: string | { patchId: string; language?: "zh" | "en" }) => Promise<{ ok: true; result: { ok: boolean; patchId: string; summary: string; strategy?: string; warning?: string } } | { ok: false; error: string }>;
      discardPatch: (patchId: string) => Promise<{ ok: boolean; patchId: string }>;
      approveCommand: (payload: { commandId: string; allowFuture?: boolean; language?: "zh" | "en" }) => Promise<{ ok: true; result: { ok: boolean; commandId: string; command: string; result: string; highRisk: boolean; autoApproveFutureCommands: boolean; commandAutoApproval: boolean; patchAutoApproval: boolean; commandAutoApprovalExpiresAt?: number | null; patchAutoApprovalExpiresAt?: number | null } } | { ok: false; error: string }>;
      discardCommand: (commandId: string) => Promise<{ ok: boolean; commandId: string }>;
      setCommandAutoApproval: (payload: AutoApprovalRequest) => Promise<AutoApprovalState>;
      setPatchAutoApproval: (payload: AutoApprovalRequest) => Promise<AutoApprovalState>;
      onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
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
  reasoning?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
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
};

export type WorkspaceTreeItem = {
  path: string;
  name: string;
  type: "file" | "directory";
  depth: number;
};

export type WorkspaceSearchResult = {
  results: Array<{ file: string; line: number; text: string }>;
  truncated: boolean;
  engine: string;
};

export type AttachedFile = {
  path: string;
  content: string;
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
  autoApproveFutureCommands?: boolean;
  commandAutoApprovalExpiresAt?: number | null;
  patchAutoApprovalExpiresAt?: number | null;
  ttlMs?: number;
};

export type AgentEvent =
  | { requestId: string; type: "status"; message: string }
  | { requestId: string; type: "stream_delta"; text: string }
  | { requestId: string; type: "reasoning_delta"; text: string }
  | { requestId: string; type: "tool_call_delta"; name?: string; text: string }
  | { requestId: string; type: "stream_recovery"; message: string; attempt: number; maxAttempts: number; recovering: boolean }
  | { requestId: string; type: "plan_update"; items: PlanItem[] }
  | { requestId: string; type: "model"; message: string; provider: string; model: string; finishReason?: string | null; reasoning?: string; usage?: unknown; tool_calls?: ChatToolCall[] }
  | { requestId: string; type: "tool_start"; name: string; args: string }
  | { requestId: string; type: "tool_result"; name: string; result: string; toolCallId?: string }
  | { requestId: string; type: "tool_error"; name: string; message: string; toolCallId?: string; result?: string }
  | { requestId: string; type: "patch_proposed"; patchId: string; summary: string; patch: string }
  | { requestId: string; type: "patch_applied"; patchId: string; summary: string; strategy?: string }
  | { requestId: string; type: "command_pending"; commandId: string; command: string; reason: string; highRisk?: boolean }
  | { requestId: string; type: "ask_user_pending"; question: string; context?: string; options?: string[] }
  | { requestId: string; type: "error"; message: string }
  | { requestId: string; type: "cancelled"; message: string }
  | { requestId: string; type: "done" };
