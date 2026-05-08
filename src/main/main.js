import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentTurn } from "./agent.js";
import { readAttachmentFiles, readUploadedFiles } from "./attachments.js";
import { getProviderBalance, testProviderConnection } from "./providers.js";
import { getConfigPath, loadAppConfig, saveAppConfig } from "./config.js";
import { applyPendingPatch, approvePendingCommand, discardPendingCommand, discardPendingPatch, setCommandAutoApproval, setPatchAutoApproval } from "./tools.js";
import { getGitDiff, getGitSummary, getWorkspaceTree, readWorkspaceFile, searchWorkspaceFiles } from "./workspace.js";
import { normalizeLanguage, t } from "./i18n.js";
import {
  validateAgentSendPayload,
  validateAttachmentPathsPayload,
  validateAutoApprovalPayload,
  validateCommandApprovalPayload,
  validateCommandId,
  validateConfigPayload,
  validateFileReadPayload,
  validateFileSearchPayload,
  validatePatchPayload,
  validateRequestId,
  validateTokenCountPayload,
  validateWorkspace,
  validateWorkspaceTreePayload
} from "./ipc-validation.js";
import { countAgentRequestTokens } from "../shared/tokenCounter.js";

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
    title: "Bruce的秘密基地",
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
  return await saveAppConfig(validateConfigPayload(config));
});

ipcMain.handle("workspace:tree", async (_event, workspace) => {
  const validated = validateWorkspaceTreePayload(workspace);
  return await getWorkspaceTree(validated.workspace, validated.directory);
});

ipcMain.handle("file:read", async (_event, payload) => {
  const validated = validateFileReadPayload(payload);
  return await readWorkspaceFile(validated.workspace, validated.path);
});

ipcMain.handle("file:search", async (_event, payload) => {
  const validated = validateFileSearchPayload(payload);
  return await searchWorkspaceFiles(validated.workspace, validated.query, validated.maxResults);
});

ipcMain.handle("file:choose-attachments", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    title: "选择要上传分析的文件"
  });

  if (result.canceled || result.filePaths.length === 0) return [];
  return await readUploadedFiles(result.filePaths);
});

ipcMain.handle("file:read-attachments", async (_event, payload) => {
  const validated = validateAttachmentPathsPayload(payload);
  return await readAttachmentFiles(validated.paths);
});

ipcMain.handle("git:summary", async (_event, workspace) => {
  return await getGitSummary(validateWorkspace(workspace));
});

ipcMain.handle("git:diff", async (_event, workspace) => {
  return await getGitDiff(validateWorkspace(workspace));
});

ipcMain.handle("agent:send", async (event, payload) => {
  try {
    payload = validateAgentSendPayload(payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const requestId = payload.requestId;
  const language = normalizeLanguage(payload.language);
  if (activeRequests.has(requestId)) {
    return { ok: false, error: "Duplicate requestId." };
  }
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
      emit({ type: "cancelled", message: t(language, "agent.cancelled") });
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
  const controller = activeRequests.get(validateRequestId(requestId));
  if (!controller) return { ok: false };
  controller.abort();
  return { ok: true };
});

ipcMain.handle("provider:test", async (_event, config) => {
  try {
    const result = await testProviderConnection(validateConfigPayload(config));
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("provider:balance", async (_event, config) => {
  try {
    const result = await getProviderBalance(validateConfigPayload(config));
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("tokens:count", async (_event, payload) => {
  const validated = validateTokenCountPayload(payload);
  return {
    tokens: countAgentRequestTokens({
      messages: validated.messages,
      input: validated.input,
      attachments: validated.attachments
    })
  };
});

ipcMain.handle("patch:apply", async (_event, payload) => {
  const validated = validatePatchPayload(payload);
  const patchId = validated.patchId;
  const language = normalizeLanguage(validated.language);
  try {
    const result = await applyPendingPatch(patchId, { language });
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle("patch:discard", async (_event, patchId) => {
  return discardPendingPatch(validatePatchPayload({ patchId }).patchId);
});

ipcMain.handle("command:approve", async (_event, payload) => {
  try {
    const validated = validateCommandApprovalPayload(payload);
    const result = await approvePendingCommand(validated.commandId, { allowFuture: validated.allowFuture, language: normalizeLanguage(validated.language) });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("command:discard", async (_event, commandId) => {
  return discardPendingCommand(validateCommandId(commandId));
});

ipcMain.handle("command:auto-approval", async (_event, payload) => {
  return setCommandAutoApproval(validateAutoApprovalPayload(payload));
});

ipcMain.handle("patch:auto-approval", async (_event, payload) => {
  return setPatchAutoApproval(validateAutoApprovalPayload(payload));
});
