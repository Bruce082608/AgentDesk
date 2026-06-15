import { app, BrowserWindow, dialog, ipcMain, shell, protocol, net, Menu, systemPreferences } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { exec } from "node:child_process";

// Prevent application crash on EPIPE error (occurs when parent terminal process closes stdout/stderr pipes)
process.stdout.on("error", (err) => {
  if (err && err.code === "EPIPE") {
    // Ignore EPIPE
  }
});
process.stderr.on("error", (err) => {
  if (err && err.code === "EPIPE") {
    // Ignore EPIPE
  }
});

process.on("uncaughtException", (err) => {
  if (err && err.code === "EPIPE") {
    return;
  }
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

// Register custom media scheme
protocol.registerSchemesAsPrivileged([
  { scheme: "media", privileges: { bypassCSP: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);
import { resumeAgentContinuation, runAgentTurn } from "./agent.js";
import { readAttachmentFiles, readUploadedFiles } from "./attachments.js";
import { configureBackgroundTasks, listBackgroundTasks, scheduleBackgroundTask, cancelBackgroundTask } from "./background-tasks.js";
import { checkForUpdates, getUpdateState, setupAutoUpdates } from "./desktop-updates.js";
import { checkGitUpdate, applyGitUpdate } from "./git-updates.js";
import { startWebServer, stopWebServer } from "./web-server.js";
import {
  getDesktopIntegrationState,
  handleAgentDesktopEvent,
  keepsAppRunningInBackground,
  refreshDesktopIntegrationState,
  setupDesktopIntegration,
  shouldHideToTrayOnClose,
  showDesktopNotification,
  showMainWindow
} from "./desktop-integration.js";
import { getProviderBalance, testProviderConnection } from "./providers.js";
import { getConfigPath, loadAppConfig, saveAppConfig, importCodexConfig } from "./config.js";
import { applyPendingPatch, approvePendingCommand, discardPendingCommand, discardPendingPatch, setCommandAutoApproval, setFullAccessAutoApproval, setPatchAutoApproval } from "./tools.js";
import { getGitDiff, getGitSummary, getWorkspaceTree, readWorkspaceFile, searchWorkspaceFiles } from "./workspace.js";
import { listPendingApprovals, loadPersistedActivityEvents, loadPersistedSessions, savePersistedActivityEvents, savePersistedSessions, loadPersistedSkills, savePersistedSkills, deleteAgentContinuation } from "./persistence.js";
import { initSkillsScheduler, syncSkillsScheduler } from "./skills-scheduler.js";
import { classifyLaunchPaths, extractLaunchPaths } from "./launch-paths.js";
import { normalizeLanguage, t } from "./i18n.js";
import { configureSystemToolRuntime } from "./system-tools.js";
import { startTelegramBot, stopTelegramBot } from "./telegram-bot.js";
import {
  validateAgentSendPayload,
  validateAttachmentPathsPayload,
  validateAutoApprovalPayload,
  validateBackgroundTaskPayload,
  validateCommandApprovalPayload,
  validateCommandId,
  validateConfigPayload,
  validateDesktopNotificationPayload,
  validateFileReadPayload,
  validateFileSearchPayload,
  validateOpenPathsPayload,
  validatePatchPayload,
  validateRequestId,
  validateTokenCountPayload,
  validateWorkspace,
  validateWorkspaceTreePayload
} from "./ipc-validation.js";
import { countAgentRequestTokens } from "../shared/tokenCounter.js";
import { getAutoApprovalState } from "./patch-approval.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow;
const activeRequests = new Map();
let pendingOpenPathPayloads = [];
let openPathsRendererReady = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    void queueOpenPaths(extractLaunchPaths(argv, { isPackaged: app.isPackaged }));
  });
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void queueOpenPaths([filePath]);
});

function createWindow() {
  openPathsRendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111318",
    title: "AgentDesk",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("close", (event) => {
    if (!shouldHideToTrayOnClose()) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.on("did-start-loading", () => {
    openPathsRendererReady = false;
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;

  // Register media protocol handler to serve local images and videos
  protocol.handle("media", (request) => {
    try {
      const urlPath = request.url.replace(/^media:\/+/i, "");
      const decoded = decodeURIComponent(urlPath);
      const normalized = path.normalize(decoded);
      const fileUrl = pathToFileURL(normalized).toString();
      return net.fetch(fileUrl);
    } catch (err) {
      console.error("[Electron Protocol] failed to fetch file:", err);
      return new Response("Not Found", { status: 404 });
    }
  });

  configureSystemToolRuntime({
    notify: showDesktopNotification,
    getDesktopState: getDesktopIntegrationState
  });
  createWindow();
  setupDesktopIntegration({
    getMainWindow: () => mainWindow,
    createWindow,
    getActiveRequestCount: () => activeRequests.size
  });
  configureBackgroundTasks({ notify: showDesktopNotification });
  void setupAutoUpdates({ notify: showDesktopNotification });
  void queueOpenPaths(extractLaunchPaths(process.argv, { isPackaged: app.isPackaged }));
  void startWebServer();

  loadAppConfig().then((config) => {
    startTelegramBot(config);
  }).catch(() => {});

  void initSkillsScheduler();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    showMainWindow();
  });
});

app.on("will-quit", () => {
  stopTelegramBot();
  stopWebServer();
});

app.on("window-all-closed", () => {
  if (keepsAppRunningInBackground()) return;
  if (process.platform !== "darwin") app.quit();
});

async function queueOpenPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return { ok: true, queued: 0 };
  const payload = await classifyLaunchPaths(paths);
  if (payload.paths.length === 0 && payload.missing.length === 0) return { ok: true, queued: 0 };
  pendingOpenPathPayloads.push(payload);
  showMainWindow();
  flushQueuedOpenPaths();
  return { ok: true, queued: payload.paths.length, missing: payload.missing.length };
}

function flushQueuedOpenPaths() {
  if (!openPathsRendererReady || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  while (pendingOpenPathPayloads.length > 0) {
    const payload = pendingOpenPathPayloads.shift();
    mainWindow.webContents.send("system:open-paths", payload);
  }
}

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
  const result = await saveAppConfig(validateConfigPayload(config));
  loadAppConfig().then((updatedConfig) => {
    startTelegramBot(updatedConfig);
  }).catch(() => {});
  return result;
});

ipcMain.handle("config:import-codex", async () => {
  return importCodexConfig();
});

ipcMain.handle("system:state", async () => {
  return {
    desktop: getDesktopIntegrationState(),
    updates: getUpdateState()
  };
});

ipcMain.handle("system:notify", async (_event, payload) => {
  return showDesktopNotification(validateDesktopNotificationPayload(payload));
});

ipcMain.handle("system:start-dictation", async () => {
  if (process.platform === "darwin") {
    try {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status !== "granted") {
        systemPreferences.askForMediaAccess("microphone").catch((err) => {
          console.warn("Failed to request microphone permission:", err);
        });
      }
    } catch (err) {
      console.warn("Failed to check microphone permission:", err);
    }
    Menu.sendActionToFirstResponder("startDictation:");
    return { ok: true };
  }

  if (process.platform === "win32") {
    // Simulate Win+H to open Windows built-in Voice Typing panel.
    // Uses PowerShell with -EncodedCommand to avoid escaping issues.
    const psScript = [
      "Add-Type -TypeDefinition @'",
      "using System; using System.Runtime.InteropServices;",
      "public class DictationKey {",
      '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);',
      "}",
      "'@",
      "[DictationKey]::keybd_event(0x5B, 0, 0, 0)",   // Win key down
      "[DictationKey]::keybd_event(0x48, 0, 0, 0)",   // H key down
      "Start-Sleep -Milliseconds 80",
      "[DictationKey]::keybd_event(0x48, 0, 2, 0)",   // H key up
      "[DictationKey]::keybd_event(0x5B, 0, 2, 0)",   // Win key up
    ].join("\n");

    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    return new Promise((resolve) => {
      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { timeout: 5000 },
        (err) => {
          if (err) {
            console.warn("Failed to trigger Win+H dictation:", err.message);
            resolve({ ok: false, error: "Failed to open voice typing panel" });
          } else {
            resolve({ ok: true });
          }
        },
      );
    });
  }

  return { ok: false, error: "Unsupported platform" };
});

ipcMain.handle("system:open-paths", async (_event, payload) => {
  return await queueOpenPaths(validateOpenPathsPayload(payload).paths);
});

ipcMain.handle("system:shell-open", async (_event, filePath) => {
  try {
    if (typeof filePath === "string") {
      if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        try {
          new URL(filePath);
          await shell.openExternal(filePath);
          return { ok: true };
        } catch (err) {
          console.error("[main] system:shell-open shell.openExternal failed, trying fallback:", err);
          try {
            if (/^[a-zA-Z0-9:\/\.\-\_\?\&\=\#\%\+]+$/.test(filePath)) {
              if (process.platform === "darwin") {
                exec(`open "${filePath}"`);
              } else if (process.platform === "win32") {
                exec(`start "" "${filePath}"`);
              } else {
                exec(`xdg-open "${filePath}"`);
              }
              return { ok: true };
            }
          } catch (fallbackError) {
            console.error("[main] system:shell-open fallback failed:", fallbackError);
          }
          return { ok: false, error: String(err) };
        }
      }
      const cleanPath = filePath.startsWith("media://")
        ? decodeURIComponent(filePath.replace(/^media:\/+/i, ""))
        : filePath;
      await shell.openPath(cleanPath);
      return { ok: true };
    }
    return { ok: false };
  } catch (error) {
    console.error("[main] system:shell-open failed:", error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle("system:open-paths-ready", async () => {
  openPathsRendererReady = true;
  flushQueuedOpenPaths();
  return { ok: true };
});

ipcMain.handle("updates:check", async () => {
  return await checkForUpdates();
});

ipcMain.handle("git:check-update", async () => {
  return await checkGitUpdate();
});

ipcMain.handle("git:apply-update", async (event, options) => {
  return await applyGitUpdate(event, options);
});


ipcMain.handle("background:list", async (_event, payload = {}) => {
  return await listBackgroundTasks({ includeCompleted: Boolean(payload.includeCompleted) });
});

ipcMain.handle("background:schedule", async (_event, payload) => {
  return await scheduleBackgroundTask(validateBackgroundTaskPayload(payload));
});

ipcMain.handle("background:cancel", async (_event, id) => {
  return await cancelBackgroundTask(validateCommandId(id));
});

ipcMain.handle("sessions:load", async () => {
  return await loadPersistedSessions();
});

ipcMain.handle("sessions:save", async (_event, sessions) => {
  return await savePersistedSessions(Array.isArray(sessions) ? sessions : []);
});

ipcMain.handle("activity:load", async () => {
  return await loadPersistedActivityEvents();
});

ipcMain.handle("activity:save", async (_event, events) => {
  return await savePersistedActivityEvents(Array.isArray(events) ? events : []);
});

ipcMain.handle("skills:load", async () => {
  return await loadPersistedSkills();
});

ipcMain.handle("skills:save", async (_event, skills) => {
  const result = await savePersistedSkills(Array.isArray(skills) ? skills : []);
  void syncSkillsScheduler();
  return result;
});

ipcMain.handle("approvals:list", async (_event, payload = {}) => {
  return await listPendingApprovals({ sessionId: String(payload.sessionId || "") });
});

ipcMain.handle("permissions:state", async (_event, payload) => {
  return getAutoApprovalState(validateAutoApprovalPayload(payload));
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
  refreshDesktopIntegrationState();
  const emit = (message) => {
    event.sender.send("agent:event", { requestId, ...message });
    handleAgentDesktopEvent(message);
    import("./web-server.js").then(({ broadcastSseEvent }) => {
      broadcastSseEvent("agent:event", { requestId, ...message });
    }).catch(() => {});
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
    refreshDesktopIntegrationState();
  }
});

ipcMain.handle("agent:resume", async (event, payload) => {
  let validatedPayload;
  try {
    validatedPayload = {
      ...payload,
      requestId: validateRequestId(payload?.requestId)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const requestId = validatedPayload.requestId;
  if (activeRequests.has(requestId)) {
    return { ok: false, error: "Duplicate requestId." };
  }

  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  refreshDesktopIntegrationState();
  const emit = (message) => {
    event.sender.send("agent:event", { requestId, ...message });
    handleAgentDesktopEvent(message);
    import("./web-server.js").then(({ broadcastSseEvent }) => {
      broadcastSseEvent("agent:event", { requestId, ...message });
    }).catch(() => {});
  };

  try {
    const result = await resumeAgentContinuation({ ...validatedPayload, signal: controller.signal }, emit);
    emit({ type: "done" });
    return { ok: true, result };
  } catch (error) {
    if (controller.signal.aborted) {
      emit({ type: "cancelled", message: t(normalizeLanguage(validatedPayload.language), "agent.cancelled") });
      return { ok: false, cancelled: true };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    activeRequests.delete(requestId);
    refreshDesktopIntegrationState();
  }
});

ipcMain.handle("agent:cancel", async (_event, requestId) => {
  const controller = activeRequests.get(validateRequestId(requestId));
  if (!controller) return { ok: false };
  controller.abort();
  return { ok: true };
});

ipcMain.handle("continuation:delete", async (_event, continuationId) => {
  try {
    const result = await deleteAgentContinuation(validateRequestId(continuationId));
    return result;
  } catch (error) {
    return { ok: false, error: String(error) };
  }
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

ipcMain.handle("permissions:full-access", async (_event, payload) => {
  return setFullAccessAutoApproval(validateAutoApprovalPayload(payload));
});
