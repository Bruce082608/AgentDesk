const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentWindow", {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  getWorkspaceTree: (workspace) => ipcRenderer.invoke("workspace:tree", workspace),
  readFile: (payload) => ipcRenderer.invoke("file:read", payload),
  getGitSummary: (workspace) => ipcRenderer.invoke("git:summary", workspace),
  getGitDiff: (workspace) => ipcRenderer.invoke("git:diff", workspace),
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  sendMessage: (payload) => ipcRenderer.invoke("agent:send", payload),
  testProvider: (config) => ipcRenderer.invoke("provider:test", config),
  applyPatch: (patchId) => ipcRenderer.invoke("patch:apply", patchId),
  discardPatch: (patchId) => ipcRenderer.invoke("patch:discard", patchId),
  approveCommand: (commandId) => ipcRenderer.invoke("command:approve", commandId),
  discardCommand: (commandId) => ipcRenderer.invoke("command:discard", commandId),
  onAgentEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  }
});
