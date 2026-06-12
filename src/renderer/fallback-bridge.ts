import type {
  AttachedFile,
  WorkspaceTreeItem,
  WorkspaceSearchResult,
  GitSummary,
  PersistedChatSession,
  PersistedEventLogItem,
  ApprovalRecord,
  AutoApprovalState,
  ProviderConfig,
  SystemState,
  UpdateState,
  BackgroundTask,
  AgentRequest,
  ApprovalResumeRequest,
  AgentEvent,
  OpenPathsPayload,
  ProviderTestResult,
  ProviderBalanceResult,
  ChatMessage
} from "./global";

// Initialize fallback bridge when running in a browser/mobile environment
if (typeof window.agentWindow === "undefined") {
  console.log("[Fallback Bridge] Initializing Web Client Bridge...");

  // 1. Resolve Auth Token
  let token = sessionStorage.getItem("api_token");
  if (!token) {
    const params = new URLSearchParams(window.location.search);
    token = params.get("token");
  }

  if (token) {
    sessionStorage.setItem("api_token", token);
    // Remove token from query parameters to keep address bar clean
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
    }
  } else {
    // If no token, prompt user
    token = window.prompt("请输入 API 鉴权 Token (Please enter API Token):") || "";
    if (token) {
      sessionStorage.setItem("api_token", token);
    }
  }

  // 2. Fetch API Helper
  const fetchApi = async (path: string, method: string, body?: any) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Token": token || ""
    };
    const response = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 401) {
      sessionStorage.removeItem("api_token");
      alert("Token 验证失败，请重新输入正确的 Token。");
      window.location.reload();
      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`API Error: ${errText}`);
    }

    return response.json();
  };

  // 3. Callback lists for SSE events
  const agentEventCallbacks = new Set<(event: AgentEvent) => void>();
  const sessionsUpdatedCallbacks = new Set<() => void>();
  const gitUpdateProgressCallbacks = new Set<(data: { status: "pulling" | "checking_deps" | "installing_deps" | "completed" | "error"; detail: string }) => void>();

  // Establish SSE connection if token is available
  if (token) {
    const sseUrl = `/api/events?token=${encodeURIComponent(token)}`;
    const sseSource = new EventSource(sseUrl);

    sseSource.addEventListener("agent:event", (e) => {
      try {
        const data = JSON.parse(e.data) as AgentEvent;
        agentEventCallbacks.forEach(cb => cb(data));
      } catch (err) {
        console.error("Failed to parse SSE agent event:", err);
      }
    });

    sseSource.addEventListener("sessions:updated", () => {
      sessionsUpdatedCallbacks.forEach(cb => cb());
    });

    sseSource.addEventListener("git:update-progress", (e) => {
      try {
        const data = JSON.parse(e.data) as { status: "pulling" | "checking_deps" | "installing_deps" | "completed" | "error"; detail: string };
        gitUpdateProgressCallbacks.forEach(cb => cb(data));
      } catch (err) {
        console.error("Failed to parse SSE git update progress:", err);
      }
    });

    sseSource.onerror = (err) => {
      console.error("SSE Connection Error:", err);
    };
  }

  // 4. Implement window.agentWindow fallback object
  window.agentWindow = {
    chooseWorkspace: async () => {
      const val = window.prompt("请输入本地项目工作区绝对路径 (Please enter local workspace absolute path):");
      return val || null;
    },
    getWorkspaceTree: async (payload) => {
      const body = typeof payload === "string" ? { workspace: payload } : payload;
      return fetchApi("/api/workspace/tree", "POST", body);
    },
    readFile: async (payload) => {
      return fetchApi("/api/file/read", "POST", payload);
    },
    searchFiles: async (payload) => {
      return fetchApi("/api/file/search", "POST", payload);
    },
    chooseAttachmentFiles: async () => {
      // Browsers cannot open native attachment dialogs, return empty
      return [];
    },
    readAttachmentFiles: async () => {
      return [];
    },
    getPathForFile: (file) => {
      return file.name;
    },
    getGitSummary: async (workspace) => {
      return fetchApi("/api/git/summary", "POST", { workspace });
    },
    getGitDiff: async (workspace) => {
      return fetchApi("/api/git/diff", "POST", { workspace });
    },
    loadSessions: async () => {
      return fetchApi("/api/sessions", "GET");
    },
    saveSessions: async (sessions) => {
      return fetchApi("/api/sessions", "POST", sessions);
    },
    loadActivityEvents: async () => {
      return fetchApi("/api/activity", "GET");
    },
    saveActivityEvents: async (events) => {
      return fetchApi("/api/activity", "POST", events);
    },
    listPendingApprovals: async (payload) => {
      return fetchApi("/api/approvals/list", "POST", payload || {});
    },
    getAutoApprovalState: async (payload) => {
      return fetchApi("/api/permissions/state", "POST", payload);
    },
    loadConfig: async () => {
      return fetchApi("/api/config", "GET");
    },
    saveConfig: async (config) => {
      return fetchApi("/api/config", "POST", config);
    },
    getSystemState: async () => {
      return {
        desktop: {
          appVersion: "0.1.0",
          platform: navigator.userAgent.includes("Mac") ? "darwin" : "win32",
          trayEnabled: false,
          globalShortcutRegistered: false,
          globalShortcutAccelerator: "",
          notificationsSupported: false,
          activeRequests: 0,
          backgroundMode: false
        },
        updates: { ok: true, configured: false, status: "up-to-date" }
      };
    },
    showNotification: async (payload) => {
      console.log("[Mock Notification]", payload);
      return { ok: true };
    },
    openSystemPaths: async () => {
      // Mock, not applicable in browser
    },
    setOpenPathsReady: async () => {
      return { ok: true };
    },
    checkForUpdates: async () => {
      return { ok: true, configured: false, status: "up-to-date" };
    },
    checkGitUpdate: async () => {
      return fetchApi("/api/git/check-update", "POST");
    },
    applyGitUpdate: async (options) => {
      return fetchApi("/api/git/apply-update", "POST", options);
    },
    onGitUpdateProgress: (callback) => {
      gitUpdateProgressCallbacks.add(callback);
      return () => {
        gitUpdateProgressCallbacks.delete(callback);
      };
    },
    listBackgroundTasks: async () => {
      return [];
    },
    scheduleBackgroundTask: async () => {
      throw new Error("Background tasks scheduling is not supported in the web panel.");
    },
    cancelBackgroundTask: async () => {
      return { ok: false, task: null };
    },
    sendMessage: async (payload) => {
      return fetchApi("/api/agent/send", "POST", payload);
    },
    resumeApproval: async (payload) => {
      return fetchApi("/api/agent/resume", "POST", payload);
    },
    cancelMessage: async (requestId) => {
      return fetchApi("/api/agent/cancel", "POST", { requestId });
    },
    testProvider: async (config) => {
      return fetchApi("/api/provider/test", "POST", config);
    },
    getBalance: async (config) => {
      return fetchApi("/api/provider/balance", "POST", config);
    },
    countTokens: async (payload) => {
      return fetchApi("/api/tokens/count", "POST", payload);
    },
    applyPatch: async () => {
      throw new Error("applyPatch is not supported from the web panel.");
    },
    discardPatch: async (patchId) => {
      return { ok: true, patchId };
    },
    approveCommand: async () => {
      throw new Error("approveCommand is not supported from the web panel.");
    },
    discardCommand: async (commandId) => {
      return { ok: true, commandId };
    },
    setCommandAutoApproval: async (payload) => {
      return fetchApi("/api/permissions/command", "POST", payload);
    },
    setPatchAutoApproval: async (payload) => {
      return fetchApi("/api/permissions/patch", "POST", payload);
    },
    setFullAccessAutoApproval: async (payload) => {
      return fetchApi("/api/permissions/full-access", "POST", payload);
    },
    onAgentEvent: (callback) => {
      agentEventCallbacks.add(callback);
      return () => {
        agentEventCallbacks.delete(callback);
      };
    },
    onOpenPaths: () => {
      return () => {};
    },
    onSessionsUpdated: (callback) => {
      sessionsUpdatedCallbacks.add(callback);
      return () => {
        sessionsUpdatedCallbacks.delete(callback);
      };
    }
  };
}
