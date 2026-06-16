import { ipcMain } from "electron";

import { resumeAgentContinuation, runAgentTurn } from "../agent.js";
import { handleAgentDesktopEvent, refreshDesktopIntegrationState } from "../desktop-integration.js";
import { normalizeLanguage, t } from "../i18n.js";
import { validateAgentResumePayload, validateAgentSendPayload, validateRequestId } from "../ipc-validation.js";

export function registerAgentIpc({ getMainWindow, activeRequests }) {
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
    const requestState = { controller, language, cancelledEmitted: false };
    activeRequests.set(requestId, requestState);
    refreshDesktopIntegrationState();

    const emit = (message) => {
      event.sender.send("agent:event", { requestId, ...message });
      handleAgentDesktopEvent(message);
      import("../web-server.js").then(({ broadcastSseEvent }) => {
        broadcastSseEvent("agent:event", { requestId, ...message });
      }).catch(() => {});
    };

    try {
      await runAgentTurn({ ...payload, signal: controller.signal }, emit);
      emit({ type: "done" });
      return { ok: true };
    } catch (error) {
      if (controller.signal.aborted) {
        const activeState = activeRequests.get(requestId);
        if (activeState) activeState.cancelledEmitted = true;
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
      validatedPayload = validateAgentResumePayload(payload);
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
    const requestState = { controller, language: normalizeLanguage(validatedPayload.language), cancelledEmitted: false };
    activeRequests.set(requestId, requestState);
    refreshDesktopIntegrationState();

    const emit = (message) => {
      event.sender.send("agent:event", { requestId, ...message });
      handleAgentDesktopEvent(message);
      import("../web-server.js").then(({ broadcastSseEvent }) => {
        broadcastSseEvent("agent:event", { requestId, ...message });
      }).catch(() => {});
    };

    try {
      const result = await resumeAgentContinuation({ ...validatedPayload, signal: controller.signal }, emit);
      emit({ type: "done" });
      return { ok: true, result };
    } catch (error) {
      if (controller.signal.aborted) {
        const activeState = activeRequests.get(requestId);
        if (activeState) activeState.cancelledEmitted = true;
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
    const id = validateRequestId(requestId);
    const requestState = activeRequests.get(id);
    if (!requestState) return { ok: false };
    requestState.controller.abort();
    if (!requestState.cancelledEmitted) {
      requestState.cancelledEmitted = true;
      const mainWindow = getMainWindow();
      mainWindow?.webContents?.send("agent:event", {
        requestId: id,
        type: "cancelled",
        message: t(requestState.language || "zh", "agent.cancelled")
      });
    }
    activeRequests.delete(id);
    refreshDesktopIntegrationState();
    return { ok: true };
  });
}
