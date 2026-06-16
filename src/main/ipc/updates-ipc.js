import { ipcMain } from "electron";

import { cancelBackgroundTask, listBackgroundTasks, scheduleBackgroundTask } from "../background-tasks.js";
import { checkGitUpdate, applyGitUpdate } from "../git-updates.js";
import { validateBackgroundTaskPayload, validateCommandId, validateGitApplyUpdatePayload } from "../ipc-validation.js";

export function registerUpdatesIpc() {
  ipcMain.handle("git:check-update", async () => {
    return await checkGitUpdate();
  });

  ipcMain.handle("git:apply-update", async (event, options) => {
    return await applyGitUpdate(event, validateGitApplyUpdatePayload(options));
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
}
