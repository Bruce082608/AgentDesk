import { capturePrimaryScreen } from "../../screen-capture.js";
import { sendTelegramMessage, sendTelegramPhoto } from "../telegram-api.js";

export async function handleScreenshotCommand(chatId) {
  try {
    await sendTelegramMessage(chatId, "📸 正在截取电脑屏幕，请稍候...");
    const pngBuffer = await capturePrimaryScreen();
    await sendTelegramPhoto(chatId, pngBuffer, "🖥️ **当前电脑屏幕截图**");
  } catch (error) {
    console.error("[Telegram Bot] Screenshot failed:", error);
    await sendTelegramMessage(chatId, `❌ 截图失败: ${error.message}`);
  }
}
