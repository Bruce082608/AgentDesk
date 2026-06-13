import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { telegramState } from "../telegram-bot.js";

export async function downloadTelegramFile(fileId, fileName) {
  const getFileUrl = `https://api.telegram.org/bot${telegramState.activeBotToken}/getFile?file_id=${fileId}`;
  const response = await fetch(getFileUrl, { signal: telegramState.abortController?.signal });
  if (!response.ok) {
    throw new Error(`Telegram getFile API returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`Telegram getFile failed: ${data.description || "No file path"}`);
  }

  const filePath = data.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${telegramState.activeBotToken}/${filePath}`;
  const fileResponse = await fetch(downloadUrl, { signal: telegramState.abortController?.signal });
  if (!fileResponse.ok) {
    throw new Error(`Telegram file download returned HTTP ${fileResponse.status}`);
  }

  const buffer = await fileResponse.arrayBuffer();
  const tempDir = os.tmpdir();
  const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const tempFilePath = path.join(tempDir, safeName);

  await fs.promises.writeFile(tempFilePath, Buffer.from(buffer));
  return tempFilePath;
}

export function escapeMarkdown(text) {
  return String(text || "").replace(/([_*`\[\]()])/g, "\\$1");
}

export function sanitizeTextForTelegram(text) {
  if (typeof text !== "string") return text;
  
  // Split by backticks to identify code blocks/spans and avoid escaping underscores inside them
  const parts = text.split(/(`+)/);
  let inCode = false;
  let codeMarker = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("`")) {
      if (!inCode) {
        inCode = true;
        codeMarker = part;
      } else if (part === codeMarker) {
        inCode = false;
      }
    } else {
      if (!inCode) {
        // Escape underscores outside code blocks/spans
        parts[i] = part.replace(/_/g, "\\_");
      }
    }
  }
  return parts.join("");
}

export async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    const url = `https://api.telegram.org/bot${telegramState.activeBotToken}/sendMessage`;
    const sanitizedText = sanitizeTextForTelegram(text);
    const body = {
      chat_id: chatId,
      text: sanitizedText,
      parse_mode: "Markdown",
      ...extra
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const resData = await response.json();
    if (!resData.ok && body.parse_mode) {
      const desc = resData.description || "";
      if (!desc.includes("message is not modified") && !desc.includes("message to edit not found")) {
        console.warn(`[Telegram Bot] sendMessage failed with Markdown, retrying without parse_mode: ${desc}. Content length: ${text.length}`);
        delete body.parse_mode;
        body.text = text;
        const fallbackResponse = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        return await fallbackResponse.json();
      }
    }
    return resData;
  } catch (error) {
    console.error("[Telegram Bot] sendMessage failed:", error.message);
  }
}

export async function editTelegramMessage(chatId, messageId, text, extra = {}) {
  try {
    const url = `https://api.telegram.org/bot${telegramState.activeBotToken}/editMessageText`;
    const sanitizedText = sanitizeTextForTelegram(text);
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text: sanitizedText,
      parse_mode: "Markdown",
      ...extra
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const resData = await response.json();
    if (!resData.ok && body.parse_mode) {
      const desc = resData.description || "";
      if (!desc.includes("message is not modified") && !desc.includes("message to edit not found")) {
        console.warn(`[Telegram Bot] editMessageText failed with Markdown, retrying without parse_mode: ${desc}. Content length: ${text.length}`);
        delete body.parse_mode;
        body.text = text;
        const fallbackResponse = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        return await fallbackResponse.json();
      }
    }
    return resData;
  } catch (error) {
    console.error("[Telegram Bot] editMessageText failed:", error.message);
  }
}

export async function sendPhotoToActiveUser(photoBuffer, caption = "") {
  if (!telegramState.activeBotToken || !telegramState.activeAllowedUserId) {
    return false;
  }
  try {
    await sendTelegramPhoto(telegramState.activeAllowedUserId, photoBuffer, caption);
    return true;
  } catch (error) {
    console.error("[Telegram Bot] sendPhotoToActiveUser failed:", error);
    return false;
  }
}

export async function sendTelegramPhoto(chatId, photoBuffer, caption = "") {
  try {
    const url = `https://api.telegram.org/bot${telegramState.activeBotToken}/sendPhoto`;
    
    // Normalize photoBuffer in case it is serialized over IPC/network
    let buffer = photoBuffer;
    if (photoBuffer && typeof photoBuffer === "object" && photoBuffer.type === "Buffer" && Array.isArray(photoBuffer.data)) {
      buffer = Buffer.from(photoBuffer.data);
    } else if (photoBuffer instanceof Uint8Array) {
      buffer = Buffer.from(photoBuffer.buffer, photoBuffer.byteOffset, photoBuffer.byteLength);
    }

    const makeRequest = async (useMarkdown) => {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      const blob = new Blob([buffer], { type: "image/png" });
      formData.append("photo", blob, "screenshot.png");
      if (caption) {
        formData.append("caption", useMarkdown ? sanitizeTextForTelegram(caption) : caption);
        if (useMarkdown) {
          formData.append("parse_mode", "Markdown");
        }
      }
      const response = await fetch(url, {
        method: "POST",
        body: formData
      });
      return await response.json();
    };

    const resData = await makeRequest(true);
    if (!resData.ok && caption) {
      const desc = resData.description || "";
      if (desc.includes("can't find end") || desc.includes("can't parse entities") || desc.includes("can't parse")) {
        console.warn(`[Telegram Bot] sendPhoto failed with Markdown, retrying without parse_mode: ${desc}. Caption length: ${caption.length}`);
        return await makeRequest(false);
      }
    }
    return resData;
  } catch (error) {
    console.error("[Telegram Bot] sendPhoto failed:", error.message);
  }
}

export async function sendTelegramDocument(chatId, filePath, caption = "") {
  try {
    const url = `https://api.telegram.org/bot${telegramState.activeBotToken}/sendDocument`;
    const fileContent = await fs.promises.readFile(filePath);
    
    const makeRequest = async (useMarkdown) => {
      const formData = new FormData();
      formData.append("chat_id", String(chatId));
      const blob = new Blob([fileContent], { type: "application/octet-stream" });
      formData.append("document", blob, path.basename(filePath));
      if (caption) {
        formData.append("caption", useMarkdown ? sanitizeTextForTelegram(caption) : caption);
        if (useMarkdown) {
          formData.append("parse_mode", "Markdown");
        }
      }
      const response = await fetch(url, {
        method: "POST",
        body: formData
      });
      return await response.json();
    };

    const resData = await makeRequest(true);
    if (!resData.ok && caption) {
      const desc = resData.description || "";
      if (desc.includes("can't find end") || desc.includes("can't parse entities") || desc.includes("can't parse")) {
        console.warn(`[Telegram Bot] sendDocument failed with Markdown, retrying without parse_mode: ${desc}. Caption length: ${caption.length}`);
        return await makeRequest(false);
      }
    }
    return resData;
  } catch (error) {
    console.error("[Telegram Bot] sendDocument failed:", error.message);
  }
}

export async function answerCallbackQuery(callbackQueryId, text = "") {
  try {
    const url = `https://api.telegram.org/bot${telegramState.activeBotToken}/answerCallbackQuery`;
    const body = {
      callback_query_id: callbackQueryId,
      text
    };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    console.error("[Telegram Bot] answerCallbackQuery failed:", error.message);
  }
}

export async function registerBotCommands() {
  try {
    const url = `https://api.telegram.org/bot${telegramState.activeBotToken}/setMyCommands`;
    const body = {
      commands: [
        { command: "status", description: "查看当前项目工作区、Git 及宿主机状态" },
        { command: "workspace", description: "查看或切换工作区目录：/workspace <绝对路径>" },
        { command: "sessions", description: "列出本地会话，并支持通过按钮快速切换工作区" },
        { command: "clear", description: "清空当前积攒的待处理文件附件队列" },
        { command: "webapp_url", description: "配置并挂载底部的 Telegram 网页面板按钮" },
        { command: "screenshot", description: "截取当前电脑屏幕并发送图片" },
        { command: "cancel", description: "中止当前正在执行的 Agent 任务" },
        { command: "help", description: "显示帮助与使用指南" }
      ]
    };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    console.log("[Telegram Bot] Bot commands registered successfully.");
  } catch (error) {
    console.error("[Telegram Bot] Failed to register commands:", error.message);
  }
}

export async function sendTelegramPushNotification(text, extra = {}) {
  if (!telegramState.activeBotToken || !telegramState.activeAllowedUserId) {
    return { ok: false, error: "Telegram bot is not active or configured" };
  }
  return await sendTelegramMessage(telegramState.activeAllowedUserId, text, extra);
}
