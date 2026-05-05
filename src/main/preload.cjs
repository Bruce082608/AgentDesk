const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentWindow", {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  getWorkspaceTree: (workspace) => ipcRenderer.invoke("workspace:tree", workspace),
  readFile: (payload) => ipcRenderer.invoke("file:read", payload),
  searchFiles: (payload) => ipcRenderer.invoke("file:search", payload),
  chooseAttachmentFiles: () => ipcRenderer.invoke("file:choose-attachments"),
  getGitSummary: (workspace) => ipcRenderer.invoke("git:summary", workspace),
  getGitDiff: (workspace) => ipcRenderer.invoke("git:diff", workspace),
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  sendMessage: (payload) => ipcRenderer.invoke("agent:send", payload),
  cancelMessage: (requestId) => ipcRenderer.invoke("agent:cancel", requestId),
  testProvider: (config) => ipcRenderer.invoke("provider:test", config),
  getBalance: (config) => ipcRenderer.invoke("provider:balance", config),
  countTokens: (payload) => ipcRenderer.invoke("tokens:count", payload),
  applyPatch: (patchId) => ipcRenderer.invoke("patch:apply", patchId),
  discardPatch: (patchId) => ipcRenderer.invoke("patch:discard", patchId),
  approveCommand: (payload) => ipcRenderer.invoke("command:approve", payload),
  discardCommand: (commandId) => ipcRenderer.invoke("command:discard", commandId),
  setCommandAutoApproval: (enabled) => ipcRenderer.invoke("command:auto-approval", enabled),
  onAgentEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  }
});
