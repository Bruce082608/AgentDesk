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
      applyPatch: (patchId: string) => Promise<{ ok: true; result: { ok: boolean; patchId: string; summary: string } } | { ok: false; error: string }>;
      discardPatch: (patchId: string) => Promise<{ ok: boolean; patchId: string }>;
      approveCommand: (payload: { commandId: string; allowFuture?: boolean }) => Promise<{ ok: true; result: { ok: boolean; commandId: string; command: string; result: string; highRisk: boolean; autoApproveFutureCommands: boolean } } | { ok: false; error: string }>;
      discardCommand: (commandId: string) => Promise<{ ok: boolean; commandId: string }>;
      setCommandAutoApproval: (enabled: boolean) => Promise<{ ok: boolean; autoApproveFutureCommands: boolean }>;
      onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
    };
  }
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ProviderConfig = {
  provider: "deepseek" | "openai-compatible";
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  contextTokens: number;
  maxAgentSteps: number;
  thinkingMode: "enabled" | "disabled";
  reasoningEffort: "low" | "medium" | "high" | "max";
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
  workspace: string;
  input: string;
  providerConfig: ProviderConfig;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
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

export type AgentEvent =
  | { requestId: string; type: "status"; message: string }
  | { requestId: string; type: "stream_delta"; text: string }
  | { requestId: string; type: "reasoning_delta"; text: string }
  | { requestId: string; type: "plan_update"; items: PlanItem[] }
  | { requestId: string; type: "model"; message: string; provider: string; model: string; finishReason?: string | null; reasoning?: string; usage?: unknown }
  | { requestId: string; type: "tool_start"; name: string; args: string }
  | { requestId: string; type: "tool_result"; name: string; result: string }
  | { requestId: string; type: "tool_error"; name: string; message: string }
  | { requestId: string; type: "patch_proposed"; patchId: string; summary: string; patch: string }
  | { requestId: string; type: "command_pending"; commandId: string; command: string; reason: string; highRisk?: boolean }
  | { requestId: string; type: "error"; message: string }
  | { requestId: string; type: "cancelled"; message: string }
  | { requestId: string; type: "done" };
