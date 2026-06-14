import { telegramState } from "../../telegram-bot.js";
import { sendTelegramMessage } from "../telegram-api.js";

export async function handleCancelCommand(chatId) {
  let cancelledCount = 0;
  for (const [requestId, req] of telegramState.activeRequests.entries()) {
    if (String(req.chatId) === String(chatId)) {
      req.controller.abort();
      telegramState.activeRequests.delete(requestId);
      cancelledCount += 1;
    }
  }
  if (cancelledCount > 0) {
    await sendTelegramMessage(chatId, "⏹️ 任务取消指令已下发，正在中止 Agent...");
  } else {
    await sendTelegramMessage(chatId, "ℹ️ 当前没有正在运行的 Agent 任务。");
  }
}
