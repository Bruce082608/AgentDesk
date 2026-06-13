import fs from "node:fs";
import { getOrCreateRemoteSession, saveRemoteSession } from "../telegram-session.js";
import { sendTelegramMessage } from "../telegram-api.js";

export async function handleWorkspaceCommand(chatId, parts) {
  const session = await getOrCreateRemoteSession();
  if (parts.length > 1) {
    const targetPath = parts.slice(1).join(" ");
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        session.workspace = targetPath;
        await saveRemoteSession(session);
        await sendTelegramMessage(chatId, `📁 已成功将控制工作区切换为：\n\`${targetPath}\``);
      } else {
        await sendTelegramMessage(chatId, `❌ 错误：路径 \`${targetPath}\` 不是一个有效的本地目录。`);
      }
    } catch (error) {
      await sendTelegramMessage(chatId, `❌ 路径切换失败：${error.message}`);
    }
  } else {
    await sendTelegramMessage(
      chatId,
      `📁 当前控制工作区目录为：\n\`${session.workspace}\`\n\n你可以使用 \`/workspace <目录绝对路径>\` 远程切换工作区。`
    );
  }
}
