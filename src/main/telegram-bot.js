import { registerBotCommands, sendTelegramMessage, answerCallbackQuery } from "./telegram/telegram-api.js";
import { handleMessage, handleCallbackQuery } from "./telegram/telegram-handler.js";

// Shared state object to allow modular modules to read/write state
export const telegramState = {
  isPolling: false,
  abortController: null,
  lastUpdateId: 0,
  activeBotToken: "",
  activeAllowedUserId: "",
  activeRequests: new Map(),
  pendingAttachmentsByChat: new Map()
};

// Re-export methods used by external files
export { sendPhotoToActiveUser, sendTelegramPushNotification } from "./telegram/telegram-api.js";

export function startTelegramBot(config) {
  stopTelegramBot();

  const enabled = Boolean(config.telegramEnabled);
  const token = String(config.telegramBotToken || "").trim();
  const allowedUserId = String(config.telegramAllowedUserId || "").trim();

  if (!enabled || !token || !allowedUserId) {
    console.log("[Telegram Bot] Disabled or missing config.");
    return;
  }

  telegramState.activeBotToken = token;
  telegramState.activeAllowedUserId = allowedUserId;
  telegramState.isPolling = true;
  telegramState.abortController = new AbortController();

  console.log(`[Telegram Bot] Starting polling with token ${token.slice(0, 8)}... Allowed User: ${allowedUserId}`);
  void registerBotCommands();
  void pollUpdates();
}

export function stopTelegramBot() {
  telegramState.isPolling = false;
  if (telegramState.abortController) {
    telegramState.abortController.abort();
    telegramState.abortController = null;
  }
  telegramState.activeBotToken = "";
  telegramState.activeAllowedUserId = "";
  console.log("[Telegram Bot] Service stopped.");
}

const chatQueues = new Map();

function isCancelUpdate(update) {
  if (update.callback_query) {
    const data = String(update.callback_query.data || "");
    return data.startsWith("tg:cancel:");
  }
  if (update.message) {
    const text = String(update.message.text || "").trim().toLowerCase();
    return (
      text === "/cancel" ||
      text === "/stop" ||
      text === "/终止" ||
      text === "/取消" ||
      text === "cancel" ||
      text === "stop" ||
      text === "终止" ||
      text === "取消"
    );
  }
  return false;
}

function getChatId(update) {
  return update.message?.chat?.id || update.callback_query?.message?.chat?.id;
}

async function pollUpdates() {
  while (telegramState.isPolling) {
    try {
      const url = `https://api.telegram.org/bot${telegramState.activeBotToken}/getUpdates?offset=${telegramState.lastUpdateId + 1}&timeout=25&limit=5`;
      const response = await fetch(url, { signal: telegramState.abortController?.signal });
      if (!response.ok) {
        let desc = "";
        try {
          const errData = await response.json();
          desc = errData.description ? `: ${errData.description}` : "";
        } catch {}
        throw new Error(`HTTP ${response.status}${desc}`);
      }
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.description || "Unknown Telegram error");
      }

      const updates = data.result || [];
      if (updates.length > 0) {
        // Mark all updates in this batch as read by updating lastUpdateId
        telegramState.lastUpdateId = Math.max(telegramState.lastUpdateId, ...updates.map((u) => u.update_id));

        // 1. Process all callback queries
        const callbackUpdates = updates.filter((u) => u.callback_query);
        for (const cb of callbackUpdates) {
          if (isCancelUpdate(cb)) {
            void handleUpdate(cb);
          } else {
            const chatId = getChatId(cb);
            if (chatId) {
              const prev = chatQueues.get(chatId) || Promise.resolve();
              const next = prev.then(() => handleUpdate(cb)).catch((err) => console.error("[Telegram Bot] Queue error:", err));
              chatQueues.set(chatId, next);
            } else {
              void handleUpdate(cb);
            }
          }
        }

        // 2. Process only the latest message update (skip older ones)
        const messageUpdates = updates.filter((u) => u.message);
        if (messageUpdates.length > 0) {
          const latestMessageUpdate = messageUpdates[messageUpdates.length - 1];
          if (isCancelUpdate(latestMessageUpdate)) {
            void handleUpdate(latestMessageUpdate);
          } else {
            const chatId = getChatId(latestMessageUpdate);
            if (chatId) {
              const prev = chatQueues.get(chatId) || Promise.resolve();
              const next = prev.then(() => handleUpdate(latestMessageUpdate)).catch((err) => console.error("[Telegram Bot] Queue error:", err));
              chatQueues.set(chatId, next);
            } else {
              void handleUpdate(latestMessageUpdate);
            }
          }
        }
      }
    } catch (error) {
      if (error.name === "AbortError" || !telegramState.isPolling) {
        break;
      }
      console.error("[Telegram Bot] Polling error:", error.message);
      // Wait 5 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function handleUpdate(update) {
  // Check message or callback query sender
  const senderId = String(update.message?.from?.id || update.callback_query?.from?.id || "");
  if (!senderId) return;

  if (senderId !== telegramState.activeAllowedUserId) {
    // Reject unauthorized users
    if (update.message) {
      await sendTelegramMessage(update.message.chat.id, "❌ 未经授权的访问。本机器人已被锁定为专属控制。");
    } else if (update.callback_query) {
      await answerCallbackQuery(update.callback_query.id, "未授权访问");
    }
    return;
  }

  if (update.message) {
    await handleMessage(update.message);
  } else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  }
}
