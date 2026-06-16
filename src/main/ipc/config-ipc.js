import { ipcMain } from "electron";

import { getConfigPath, importCodexConfig, loadAppConfig, saveAppConfig } from "../config.js";
import { startTelegramBot } from "../telegram-bot.js";
import { validateConfigPayload } from "../ipc-validation.js";

export function registerConfigIpc() {
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
}
