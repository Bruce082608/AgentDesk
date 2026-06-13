import { telegramState } from "../../telegram-bot.js";
import { sendTelegramMessage } from "../telegram-api.js";

export async function handleClearCommand(chatId) {
  telegramState.pendingAttachmentsByChat.delete(chatId);
  await sendTelegramMessage(chatId, "🧹 已清空当前所有待处理的附件队列。");
}
