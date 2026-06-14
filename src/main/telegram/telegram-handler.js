import { randomUUID } from "node:crypto";
import { runAgentTurn } from "../agent.js";
import { loadAppConfig } from "../config.js";
import { readAttachmentFiles } from "../attachments.js";
import { telegramState } from "../telegram-bot.js";
import {
  downloadTelegramFile,
  sendTelegramMessage
} from "./telegram-api.js";
import { getOrCreateRemoteSession, saveRemoteSession } from "./telegram-session.js";
import { createTelegramEmit } from "./telegram-emit.js";

// Import Commands
import { handleStartHelpCommand } from "./commands/start-help.js";
import { handleStatusCommand } from "./commands/status.js";
import { handleWorkspaceCommand } from "./commands/workspace.js";
import { handleSessionsCommand } from "./commands/sessions.js";
import { handleClearCommand } from "./commands/clear.js";
import { handleWebappUrlCommand } from "./commands/webapp-url.js";
import { handleCancelCommand } from "./commands/cancel.js";
import { handleScreenshotCommand } from "./commands/screenshot.js";

// Re-export callback query handler from telegram-approvals
export { handleCallbackQuery } from "./telegram-approvals.js";

export async function handleMessage(message) {
  const chatId = message.chat.id;

  // 1. Check for documents/photos
  if (message.document || message.photo) {
    let fileId = "";
    let fileName = "";

    if (message.document) {
      fileId = message.document.file_id;
      fileName = message.document.file_name || "document";
    } else if (message.photo && message.photo.length > 0) {
      const highestResPhoto = message.photo[message.photo.length - 1];
      fileId = highestResPhoto.file_id;
      fileName = `photo_${Date.now()}.jpg`;
    }

    if (fileId) {
      try {
        await sendTelegramMessage(chatId, `⏳ 正在下载附件: ${fileName}...`);
        const tempPath = await downloadTelegramFile(fileId, fileName);
        const parsedFiles = await readAttachmentFiles([tempPath]);

        if (parsedFiles && parsedFiles.length > 0) {
          const parsed = parsedFiles[0];

          // Check if there is a caption
          const caption = String(message.caption || "").trim();
          if (caption) {
            // Retrieve any previously accumulated pending attachments for this chat
            const pending = telegramState.pendingAttachmentsByChat.get(chatId) || [];
            const allAttachments = [...pending, parsed];
            telegramState.pendingAttachmentsByChat.delete(chatId); // Clear since we're running it

            await runRemoteAgentTurn(chatId, caption, allAttachments);
          } else {
            // No caption: save to pending list
            if (!telegramState.pendingAttachmentsByChat.has(chatId)) {
              telegramState.pendingAttachmentsByChat.set(chatId, []);
            }
            telegramState.pendingAttachmentsByChat.get(chatId).push(parsed);

            await sendTelegramMessage(
              chatId,
              `📎 已收到附件: \`${fileName}\`\n请输入指令进行操作（例如: "帮我重构这段代码" 或 "解释这个日志"）。`
            );
          }
        } else {
          await sendTelegramMessage(chatId, `⚠️ 无法解析该附件: ${fileName}`);
        }
      } catch (error) {
        console.error("[Telegram Bot] File processing failed:", error);
        await sendTelegramMessage(chatId, `❌ 处理附件失败: ${error.message}`);
      }
    }
    return;
  }

  const text = String(message.text || "").trim();

  if (!text) return;

  const lowerText = text.toLowerCase();
  const isCommand = text.startsWith("/") || ["cancel", "clear", "stop", "终止", "取消", "清空", "清除", "status", "help", "workspace", "sessions", "webapp_url", "screenshot"].includes(lowerText);

  if (isCommand) {
    const cleanText = text.startsWith("/") ? text : "/" + text;
    const parts = cleanText.split(/\s+/);
    let cmd = parts[0].toLowerCase();

    // Normalize command aliases
    if (cmd === "/stop" || cmd === "/终止" || cmd === "/取消") {
      cmd = "/cancel";
    } else if (cmd === "/清空" || cmd === "/清除") {
      cmd = "/clear";
    }

    if (cmd === "/start" || cmd === "/help") {
      await handleStartHelpCommand(chatId);
      return;
    }

    if (cmd === "/status") {
      await handleStatusCommand(chatId);
      return;
    }

    if (cmd === "/workspace") {
      await handleWorkspaceCommand(chatId, parts);
      return;
    }

    if (cmd === "/sessions" || cmd === "/chats") {
      await handleSessionsCommand(chatId);
      return;
    }

    if (cmd === "/clear") {
      await handleClearCommand(chatId);
      return;
    }

    if (cmd === "/webapp_url") {
      await handleWebappUrlCommand(chatId, parts);
      return;
    }

    if (cmd === "/cancel") {
      await handleCancelCommand(chatId);
      return;
    }

    if (cmd === "/screenshot") {
      await handleScreenshotCommand(chatId);
      return;
    }
  }

  // Treat regular text as instructions
  const pending = telegramState.pendingAttachmentsByChat.get(chatId) || [];
  telegramState.pendingAttachmentsByChat.delete(chatId); // Consume
  await runRemoteAgentTurn(chatId, text, pending);
}

export async function runRemoteAgentTurn(chatId, userInput, attachments = []) {
  // Check if there is already an active request running for this chat
  for (const req of telegramState.activeRequests.values()) {
    if (String(req.chatId) === String(chatId)) {
      await sendTelegramMessage(chatId, "⚠️ 当前已有正在执行的任务，请先通过 `/cancel` 中止它。");
      return;
    }
  }

  const session = await getOrCreateRemoteSession();
  const config = await loadAppConfig();

  // Append user message
  session.messages.push({
    role: "user",
    content: userInput,
    createdAt: Date.now()
  });
  await saveRemoteSession(session);

  const requestId = randomUUID();
  const controller = new AbortController();
  telegramState.activeRequests.set(requestId, { chatId, controller });

  const emit = createTelegramEmit(chatId, requestId, session.workspace);

  // Send initial acknowledge status
  emit({ type: "status", message: "正在初始化 Agent..." });

  try {
    await runAgentTurn(
      {
        requestId,
        sessionId: session.id,
        workspace: session.workspace,
        input: userInput,
        providerConfig: config,
        messages: Array.isArray(session.messages) ? session.messages.slice(0, -1) : [],
        attachments,
        permissionMode: "full",
        language: "zh",
        signal: controller.signal
      },
      emit
    );

    emit({ type: "done" });
  } catch (error) {
    if (!controller.signal.aborted) {
      emit({ type: "error", message: error.message });
    } else {
      emit({ type: "cancelled", message: "任务已中止" });
    }
  } finally {
    telegramState.activeRequests.delete(requestId);
  }
}
