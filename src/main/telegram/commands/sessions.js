import { loadPersistedSessions } from "../../persistence.js";
import { sendTelegramMessage } from "../telegram-api.js";

export async function handleSessionsCommand(chatId) {
  try {
    const sessions = await loadPersistedSessions().catch(() => []);
    const filtered = sessions.filter(s => s.id !== "telegram-remote");
    if (filtered.length === 0) {
      await sendTelegramMessage(chatId, "💬 电脑端暂无其他本地会话记录。");
      return;
    }

    const lines = filtered.slice(0, 8).map((s, idx) => {
      return `${idx + 1}. **${s.title || "未命名会话"}**\n   📁 \`${s.workspace || ""}\``;
    });

    const buttons = filtered.slice(0, 8).map((s, idx) => {
      return [{
        text: `📁 切换: ${s.title || "未命名会话"}`,
        callback_data: `tg:switch_session:${idx}`
      }];
    });

    await sendTelegramMessage(
      chatId,
      `💬 **电脑端最近会话列表 (前8个)**:\n\n${lines.join("\n\n")}\n\n点击下方按钮可快速将手机端工作区切换至对应会话工作区：`,
      { reply_markup: { inline_keyboard: buttons } }
    );
  } catch (error) {
    await sendTelegramMessage(chatId, `❌ 获取会话列表失败: ${error.message}`);
  }
}
