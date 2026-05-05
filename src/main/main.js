import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentTurn } from "./agent.js";
import { testProviderConnection } from "./providers.js";
import { getConfigPath, loadAppConfig, saveAppConfig } from "./config.js";
import { applyPendingPatch, approvePendingCommand, discardPendingCommand, discardPendingPatch, setCommandAutoApproval } from "./tools.js";
import { getGitDiff, getGitSummary, getWorkspaceTree, readWorkspaceFile, searchWorkspaceFiles } from "./workspace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow;
const activeRequests = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111318",
    title: "Agent Window Demo",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("workspace:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择 Agent 工作区"
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("config:load", async () => {
  const config = await loadAppConfig();
  return { config, path: getConfigPath() };
});

ipcMain.handle("config:save", async (_event, config) => {
  return await saveAppConfig(config);
});

ipcMain.handle("workspace:tree", async (_event, workspace) => {
  return await getWorkspaceTree(workspace);
});

ipcMain.handle("file:read", async (_event, payload) => {
  return await readWorkspaceFile(payload.workspace, payload.path);
});

ipcMain.handle("file:search", async (_event, payload) => {
  return await searchWorkspaceFiles(payload.workspace, payload.query, payload.maxResults);
});

ipcMain.handle("git:summary", async (_event, workspace) => {
  return await getGitSummary(workspace);
});

ipcMain.handle("git:diff", async (_event, workspace) => {
  return await getGitDiff(workspace);
});

ipcMain.handle("agent:send", async (event, payload) => {
  const requestId = payload.requestId;
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const emit = (message) => {
    event.sender.send("agent:event", { requestId, ...message });
  };

  try {
    await runAgentTurn({ ...payload, signal: controller.signal }, emit);
    emit({ type: "done" });
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) {
      emit({ type: "cancelled", message: "请求已取消。" });
      return { ok: false, cancelled: true };
    }
    emit({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
    return { ok: false };
  } finally {
    activeRequests.delete(requestId);
  }
});

ipcMain.handle("agent:cancel", async (_event, requestId) => {
  const controller = activeRequests.get(requestId);
  if (!controller) return { ok: false };
  controller.abort();
  return { ok: true };
});

ipcMain.handle("provider:test", async (_event, config) => {
  try {
    const result = await testProviderConnection(config);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("patch:apply", async (_event, patchId) => {
  try {
    const result = await applyPendingPatch(patchId);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("patch:discard", async (_event, patchId) => {
  return discardPendingPatch(patchId);
});

ipcMain.handle("command:approve", async (_event, payload) => {
  try {
    const commandId = typeof payload === "string" ? payload : payload?.commandId;
    const result = await approvePendingCommand(commandId, { allowFuture: Boolean(payload?.allowFuture) });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("command:discard", async (_event, commandId) => {
  return discardPendingCommand(commandId);
});

ipcMain.handle("command:auto-approval", async (_event, enabled) => {
  return setCommandAutoApproval(enabled);
});
