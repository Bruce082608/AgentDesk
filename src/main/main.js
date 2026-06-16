import { app, BrowserWindow, protocol, net } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

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
import { configureBackgroundTasks } from "./background-tasks.js";
import { setupAutoUpdates } from "./desktop-updates.js";
import { startWebServer, stopWebServer } from "./web-server.js";
import { getDesktopIntegrationState, keepsAppRunningInBackground, setupDesktopIntegration, shouldHideToTrayOnClose, showDesktopNotification, showMainWindow } from "./desktop-integration.js";
import { initSkillsScheduler } from "./skills-scheduler.js";
import { classifyLaunchPaths, extractLaunchPaths } from "./launch-paths.js";
import { configureSystemToolRuntime } from "./system-tools.js";
import { startTelegramBot, stopTelegramBot } from "./telegram-bot.js";
import { registerMainIpc } from "./ipc/register-main-ipc.js";
import { loadAppConfig } from "./config.js";

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
  registerMainIpc({
    getMainWindow: () => mainWindow,
    activeRequests,
    queueOpenPaths,
    markOpenPathsReady: () => {
      openPathsRendererReady = true;
      flushQueuedOpenPaths();
    }
  });

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
