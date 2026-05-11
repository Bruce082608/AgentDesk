import { app } from "electron";

let autoUpdater = null;
let notifyUpdate = null;
let updateState = {
  ok: true,
  configured: false,
  status: "idle",
  reason: "",
  updateUrl: "",
  version: app.getVersion()
};

export async function setupAutoUpdates({ notify } = {}) {
  notifyUpdate = typeof notify === "function" ? notify : notifyUpdate;
  const updateUrl = String(process.env.AGENTDESK_UPDATE_URL || "").trim();
  updateState = {
    ...updateState,
    configured: false,
    status: "disabled",
    reason: app.isPackaged
      ? "Set AGENTDESK_UPDATE_URL to enable update checks."
      : "Auto updates are disabled in development.",
    updateUrl,
    version: app.getVersion()
  };

  if (!app.isPackaged || !updateUrl) return updateState;

  try {
    const imported = await import("electron-updater");
    autoUpdater = imported.autoUpdater ?? imported.default?.autoUpdater;
    if (!autoUpdater) throw new Error("electron-updater did not expose autoUpdater.");
    autoUpdater.autoDownload = false;
    autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });
    wireUpdaterEvents();
    updateState = {
      ...updateState,
      configured: true,
      status: "idle",
      reason: "",
      updateUrl
    };
  } catch (error) {
    updateState = {
      ...updateState,
      ok: false,
      configured: false,
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error)
    };
  }

  return updateState;
}

export async function checkForUpdates() {
  if (!autoUpdater || !updateState.configured) return getUpdateState();
  updateState = { ...updateState, status: "checking", reason: "" };
  try {
    const result = await autoUpdater.checkForUpdates();
    updateState = {
      ...updateState,
      ok: true,
      status: "checked",
      updateInfo: result?.updateInfo ?? null
    };
  } catch (error) {
    updateState = {
      ...updateState,
      ok: false,
      status: "error",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  return getUpdateState();
}

export function getUpdateState() {
  return JSON.parse(JSON.stringify(updateState));
}

function wireUpdaterEvents() {
  autoUpdater.on("update-available", (info) => {
    updateState = { ...updateState, status: "available", updateInfo: info };
    notifyUpdate?.({
      title: "AgentDesk update available",
      body: info?.version ? `Version ${info.version} is available.` : "A new version is available."
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    updateState = { ...updateState, status: "not-available", updateInfo: info };
  });
  autoUpdater.on("error", (error) => {
    updateState = {
      ...updateState,
      ok: false,
      status: "error",
      reason: error instanceof Error ? error.message : String(error)
    };
  });
  autoUpdater.on("download-progress", (progress) => {
    updateState = { ...updateState, status: "downloading", progress };
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateState = { ...updateState, status: "downloaded", updateInfo: info };
    notifyUpdate?.({
      title: "AgentDesk update downloaded",
      body: "Restart AgentDesk to install the update."
    });
  });
}
