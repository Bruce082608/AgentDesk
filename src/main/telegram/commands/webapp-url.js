import { telegramState } from "../../telegram-bot.js";
import { sendTelegramMessage } from "../telegram-api.js";

export async function handleWebappUrlCommand(chatId, parts) {
  if (parts.length > 1) {
    const inputUrl = parts[1].trim();
    if (inputUrl.toLowerCase() === "clear" || inputUrl.toLowerCase() === "reset") {
      try {
        const setBtnUrl = `https://api.telegram.org/bot${telegramState.activeBotToken}/setChatMenuButton`;
        const body = {
          chat_id: chatId,
          menu_button: {
            type: "default"
          }
        };
        const response = await fetch(setBtnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const resData = await response.json();
        if (resData.ok) {
          await sendTelegramMessage(chatId, "✅ 已成功清除 Web App 菜单按钮并恢复为默认菜单！");
        } else {
          await sendTelegramMessage(chatId, `❌ 清除失败：${resData.description}`);
        }
      } catch (error) {
        await sendTelegramMessage(chatId, `❌ 请求失败：${error.message}`);
      }
      return;
    }

    try {
      const testUrl = new URL(inputUrl);
      if (testUrl.protocol !== "https:") {
        await sendTelegramMessage(chatId, "❌ 错误：Telegram Web App 必须使用 `https://` 协议的安全网址。");
        return;
      }

      const { getWebServerState } = await import("../../web-server.js");
      const serverState = getWebServerState();
      testUrl.searchParams.set("token", serverState.token);
      const finalUrl = testUrl.toString();

      const setBtnUrl = `https://api.telegram.org/bot${telegramState.activeBotToken}/setChatMenuButton`;
      const body = {
        chat_id: chatId,
        menu_button: {
          type: "web_app",
          text: "🌐 网页面板",
          web_app: {
            url: finalUrl
          }
        }
      };
      const response = await fetch(setBtnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const resData = await response.json();
      if (resData.ok) {
        await sendTelegramMessage(
          chatId,
          `✅ 成功配置 Web App 菜单按钮！\n\n你可以点击聊天视窗左下角的 **🌐 网页面板** 按钮直接开启手机微型面板。`
        );
      } else {
        await sendTelegramMessage(chatId, `❌ 配置失败：${resData.description}`);
      }
    } catch (error) {
      await sendTelegramMessage(chatId, `❌ URL 解析或请求失败：${error.message}`);
    }
  } else {
    await sendTelegramMessage(
      chatId,
      `🌐 **配置 Web App 菜单按钮**\n\n` +
        `由于 Telegram 规范，手机端打开 Web App 必须为 HTTPS 网址（且不能使用 localhost）。\n\n` +
        `**使用指南**：\n` +
        `1. 在宿主机上对 \`5175\` 端口进行内网穿透（例如使用 ngrok: \`ngrok http 5175\`）。\n` +
        `2. 复制得到的 \`https://...\` 网址。\n` +
        `3. 发送给机器人：\n\`/webapp_url <你的HTTPS穿透网址>\`\n\n` +
        `机器人将自动为你生成并挂载底部“网页面板”按钮。`
    );
  }
}
