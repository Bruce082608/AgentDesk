import { ipcMain } from "electron";

import { getProviderBalance, testProviderConnection } from "../providers.js";
import { countAgentRequestTokens } from "../../shared/tokenCounter.js";
import { validateConfigPayload, validateTokenCountPayload } from "../ipc-validation.js";

export function registerProviderIpc() {
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
}
