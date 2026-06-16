import { ipcMain } from "electron";

import { getAutoApprovalState } from "../patch-approval.js";
import {
  applyPendingPatch,
  approvePendingCommand,
  discardPendingCommand,
  discardPendingPatch,
  setCommandAutoApproval,
  setFullAccessAutoApproval,
  setPatchAutoApproval
} from "../tools.js";
import { normalizeLanguage } from "../i18n.js";
import {
  validateAutoApprovalPayload,
  validateCommandApprovalPayload,
  validateCommandId,
  validatePatchPayload
} from "../ipc-validation.js";

export function registerToolApprovalIpc() {
  ipcMain.handle("permissions:state", async (_event, payload) => {
    return getAutoApprovalState(validateAutoApprovalPayload(payload));
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
      const result = await approvePendingCommand(validated.commandId, {
        allowFuture: validated.allowFuture,
        language: normalizeLanguage(validated.language)
      });
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
}
