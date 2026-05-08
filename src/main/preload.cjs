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
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  sendMessage: (payload) => ipcRenderer.invoke("agent:send", payload),
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
  onAgentEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  }
});
