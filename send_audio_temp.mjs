import { telegramState } from "./src/main/telegram-bot.js";
import { sendTelegramDocument } from "./src/main/telegram/telegram-api.js";

const filePath = "/Users/bruce/Documents/Codex/AgentDesk/recording_10s.mp3";
const chatId = telegramState.activeAllowedUserId;
const token = telegramState.activeBotToken;

console.log("Bot token:", token ? token.slice(0, 8) + "..." : "NOT SET");
console.log("Chat ID:", chatId || "NOT SET");

if (!token || !chatId) {
  console.error("Telegram bot is not active. Cannot send audio.");
  process.exit(1);
}

try {
  const result = await sendTelegramDocument(chatId, filePath, "🎙️ 10秒录音");
  console.log("Result:", JSON.stringify(result));
  if (result && result.ok) {
    console.log("✅ Audio sent successfully!");
  } else {
    console.error("❌ Failed to send audio:", result?.description);
  }
} catch (err) {
  console.error("Error:", err.message);
}
