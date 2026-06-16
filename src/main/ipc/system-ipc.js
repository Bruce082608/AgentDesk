import { dialog, ipcMain, shell, Menu, systemPreferences } from "electron";
import { exec } from "node:child_process";

import { checkForUpdates, getUpdateState } from "../desktop-updates.js";
import { getDesktopIntegrationState, showDesktopNotification } from "../desktop-integration.js";
import { validateDesktopNotificationPayload, validateOpenPathsPayload } from "../ipc-validation.js";

export function registerSystemIpc({ getMainWindow, queueOpenPaths, markOpenPathsReady }) {
  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ["openDirectory"],
      title: "选择 Agent 工作区"
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
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
      const psScript = [
        "Add-Type -TypeDefinition @'",
        "using System; using System.Runtime.InteropServices;",
        "public class DictationKey {",
        '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);',
        "}",
        "'@",
        "[DictationKey]::keybd_event(0x5B, 0, 0, 0)",
        "[DictationKey]::keybd_event(0x48, 0, 0, 0)",
        "Start-Sleep -Milliseconds 80",
        "[DictationKey]::keybd_event(0x48, 0, 2, 0)",
        "[DictationKey]::keybd_event(0x5B, 0, 2, 0)"
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
          }
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
    markOpenPathsReady();
    return { ok: true };
  });

  ipcMain.handle("updates:check", async () => {
    return await checkForUpdates();
  });
}
