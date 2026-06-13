import { BrowserWindow } from "electron";
import { loadPersistedSessions, savePersistedSessions } from "../persistence.js";

export async function getOrCreateRemoteSession() {
  const sessions = await loadPersistedSessions().catch(() => []);
  let session = sessions.find((s) => s.id === "telegram-remote");

  if (!session) {
    const lastWorkspace = sessions[0]?.workspace || process.cwd();

    session = {
      id: "telegram-remote",
      title: "Telegram Remote",
      titleEdited: true,
      workspace: lastWorkspace,
      messages: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    sessions.push(session);
    await savePersistedSessions(sessions);
    notifySessionsUpdated();
  }

  return session;
}

export async function saveRemoteSession(updatedSession) {
  const sessions = await loadPersistedSessions().catch(() => []);
  const idx = sessions.findIndex((s) => s.id === "telegram-remote");
  updatedSession.updatedAt = Date.now();
  if (idx !== -1) {
    sessions[idx] = updatedSession;
  } else {
    sessions.push(updatedSession);
  }
  await savePersistedSessions(sessions);
  notifySessionsUpdated();
}

export function notifySessionsUpdated() {
  try {
    if (typeof BrowserWindow !== "undefined" && BrowserWindow && typeof BrowserWindow.getAllWindows === "function") {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send("sessions:updated");
        }
      }
    }
    import("../web-server.js").then(({ broadcastSseEvent }) => {
      broadcastSseEvent("sessions:updated", {});
    }).catch(() => {});
  } catch (error) {
    console.error("[Telegram Bot] notifySessionsUpdated failed:", error);
  }
}
