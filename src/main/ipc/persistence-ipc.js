import { ipcMain } from "electron";

import {
  deleteAgentContinuation,
  listPendingApprovals,
  loadPersistedActivityEvents,
  loadPersistedSessions,
  loadPersistedSkills,
  savePersistedActivityEvents,
  savePersistedSessions,
  savePersistedSkills
} from "../persistence.js";
import { syncSkillsScheduler } from "../skills-scheduler.js";
import { validateApprovalsListPayload, validateJsonArrayPayload, validateRequestId } from "../ipc-validation.js";

export function registerPersistenceIpc() {
  ipcMain.handle("sessions:load", async () => {
    return await loadPersistedSessions();
  });

  ipcMain.handle("sessions:save", async (_event, sessions) => {
    return await savePersistedSessions(validateJsonArrayPayload(sessions, "sessions"));
  });

  ipcMain.handle("activity:load", async () => {
    return await loadPersistedActivityEvents();
  });

  ipcMain.handle("activity:save", async (_event, events) => {
    return await savePersistedActivityEvents(validateJsonArrayPayload(events, "activity events"));
  });

  ipcMain.handle("skills:load", async () => {
    return await loadPersistedSkills();
  });

  ipcMain.handle("skills:save", async (_event, skills) => {
    const result = await savePersistedSkills(validateJsonArrayPayload(skills, "skills"));
    void syncSkillsScheduler();
    return result;
  });

  ipcMain.handle("approvals:list", async (_event, payload = {}) => {
    return await listPendingApprovals(validateApprovalsListPayload(payload));
  });

  ipcMain.handle("continuation:delete", async (_event, continuationId) => {
    try {
      const result = await deleteAgentContinuation(validateRequestId(continuationId));
      return result;
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
}
