const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("agentWindow", {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  getWorkspaceTree: (workspace) => ipcRenderer.invoke("workspace:tree", workspace),
  readFile: (payload) => ipcRenderer.invoke("file:read", payload),
  searchFiles: (payload) => ipcRenderer.invoke("file:search", payload),
  chooseAttachmentFiles: () => ipcRenderer.invoke("file:choose-attachments"),
  readAttachmentFiles: (payload) => ipcRenderer.invoke("file:read-attachments", payload),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getGitSummary: (workspace) => ipcRenderer.invoke("git:summary", workspace),
  getGitDiff: (workspace) => ipcRenderer.invoke("git:diff", workspace),
  loadSessions: () => ipcRenderer.invoke("sessions:load"),
  saveSessions: (sessions) => ipcRenderer.invoke("sessions:save", sessions),
  loadActivityEvents: () => ipcRenderer.invoke("activity:load"),
  saveActivityEvents: (events) => ipcRenderer.invoke("activity:save", events),
  loadSkills: () => ipcRenderer.invoke("skills:load"),
  saveSkills: (skills) => ipcRenderer.invoke("skills:save", skills),
  listPendingApprovals: (payload) => ipcRenderer.invoke("approvals:list", payload || {}),
  getAutoApprovalState: (payload) => ipcRenderer.invoke("permissions:state", payload),
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  getSystemState: () => ipcRenderer.invoke("system:state"),
  showNotification: (payload) => ipcRenderer.invoke("system:notify", payload),
  openSystemPaths: (payload) => ipcRenderer.invoke("system:open-paths", payload),
  setOpenPathsReady: () => ipcRenderer.invoke("system:open-paths-ready"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  checkGitUpdate: () => ipcRenderer.invoke("git:check-update"),
  applyGitUpdate: (options) => ipcRenderer.invoke("git:apply-update", options),
  onGitUpdateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("git:update-progress", listener);
    return () => ipcRenderer.removeListener("git:update-progress", listener);
  },
  listBackgroundTasks: (payload) => ipcRenderer.invoke("background:list", payload || {}),
  scheduleBackgroundTask: (payload) => ipcRenderer.invoke("background:schedule", payload),
  cancelBackgroundTask: (id) => ipcRenderer.invoke("background:cancel", id),
  sendMessage: (payload) => ipcRenderer.invoke("agent:send", payload),
  resumeApproval: (payload) => ipcRenderer.invoke("agent:resume", payload),
  cancelMessage: (requestId) => ipcRenderer.invoke("agent:cancel", requestId),
  testProvider: (config) => ipcRenderer.invoke("provider:test", config),
  getBalance: (config) => ipcRenderer.invoke("provider:balance", config),
  countTokens: (payload) => ipcRenderer.invoke("tokens:count", payload),
  applyPatch: (payload) => ipcRenderer.invoke("patch:apply", payload),
  discardPatch: (patchId) => ipcRenderer.invoke("patch:discard", patchId),
  approveCommand: (payload) => ipcRenderer.invoke("command:approve", payload),
  discardCommand: (commandId) => ipcRenderer.invoke("command:discard", commandId),
  setCommandAutoApproval: (payload) => ipcRenderer.invoke("command:auto-approval", payload),
  setPatchAutoApproval: (payload) => ipcRenderer.invoke("patch:auto-approval", payload),
  setFullAccessAutoApproval: (payload) => ipcRenderer.invoke("permissions:full-access", payload),
  onAgentEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onOpenPaths: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("system:open-paths", listener);
    return () => ipcRenderer.removeListener("system:open-paths", listener);
  },
  onSessionsUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("sessions:updated", listener);
    return () => ipcRenderer.removeListener("sessions:updated", listener);
  }
});
