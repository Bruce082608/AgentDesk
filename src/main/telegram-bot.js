import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAgentTurn, resumeAgentContinuation } from "./agent.js";
import { loadPersistedSessions, savePersistedSessions } from "./persistence.js";
import { loadAppConfig } from "./config.js";
import { readAttachmentFiles } from "./attachments.js";

let isPolling = false;
let abortController = null;
let lastUpdateId = 0;
let activeBotToken = "";
let activeAllowedUserId = "";

// Keep track of active requests and Telegram message IDs to edit/stream
const activeRequests = new Map();
const pendingAttachmentsByChat = new Map();

export function startTelegramBot(config) {
  stopTelegramBot();

  const enabled = Boolean(config.telegramEnabled);
  const token = String(config.telegramBotToken || "").trim();
  const allowedUserId = String(config.telegramAllowedUserId || "").trim();

  if (!enabled || !token || !allowedUserId) {
    console.log("[Telegram Bot] Disabled or missing config.");
    return;
  }

  activeBotToken = token;
  activeAllowedUserId = allowedUserId;
  isPolling = true;
  abortController = new AbortController();

  console.log(`[Telegram Bot] Starting polling with token ${token.slice(0, 8)}... Allowed User: ${allowedUserId}`);
  void pollUpdates();
}

export function stopTelegramBot() {
  isPolling = false;
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  activeBotToken = "";
  activeAllowedUserId = "";
  console.log("[Telegram Bot] Service stopped.");
}

async function pollUpdates() {
  while (isPolling) {
    try {
      const url = `https://api.telegram.org/bot${activeBotToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=25&limit=5`;
      const response = await fetch(url, { signal: abortController?.signal });
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
      for (const update of updates) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        await handleUpdate(update);
      }
    } catch (error) {
      if (error.name === "AbortError" || !isPolling) {
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

  if (senderId !== activeAllowedUserId) {
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

async function handleMessage(message) {
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
            const pending = pendingAttachmentsByChat.get(chatId) || [];
            const allAttachments = [...pending, parsed];
            pendingAttachmentsByChat.delete(chatId); // Clear since we're running it

            await runRemoteAgentTurn(chatId, caption, allAttachments);
          } else {
            // No caption: save to pending list
            if (!pendingAttachmentsByChat.has(chatId)) {
              pendingAttachmentsByChat.set(chatId, []);
            }
            pendingAttachmentsByChat.get(chatId).push(parsed);

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

  if (text.startsWith("/")) {
    const cmd = text.split(" ")[0].toLowerCase();
    if (cmd === "/start" || cmd === "/help") {
      await sendTelegramMessage(
        chatId,
        "🤖 **欢迎使用 AgentDesk 远程控制机器人！**\n\n" +
          "直接向我发送任何开发指令，我将启动本地 Agent 为你编写代码、运行测试或部署应用。\n\n" +
          "**可用命令：**\n" +
          "• `/status` - 查看当前项目工作区与 Git 状态\n" +
          "• `/cancel` - 中断当前正在执行的 Agent 任务\n" +
          "• `/workspace` - 查看当前使用的工作区路径\n" +
          "• `/help` - 显示此帮助信息\n\n" +
          "所有包含修改文件或运行敏感命令的操作都将在手机端弹出确认按钮，保障系统安全。"
      );
      return;
    }

    if (cmd === "/status") {
      try {
        const session = await getOrCreateRemoteSession();
        const config = await loadAppConfig();
        const modelLabel = config.capability?.label || config.model || "Unknown";
        await sendTelegramMessage(
          chatId,
          `💻 **系统状态**:\n` +
            `• **当前工作区**: \`${session.workspace}\`\n` +
            `• **AI 模型**: \`${modelLabel}\`\n` +
            `• **网络状态**: ✅ Online`
        );
      } catch (error) {
        await sendTelegramMessage(chatId, `❌ 获取状态失败: ${error.message}`);
      }
      return;
    }

    if (cmd === "/workspace") {
      const session = await getOrCreateRemoteSession();
      await sendTelegramMessage(chatId, `📁 当前控制工作区目录为：\n\`${session.workspace}\``);
      return;
    }

    if (cmd === "/cancel") {
      let cancelledCount = 0;
      for (const [requestId, req] of activeRequests.entries()) {
        if (req.chatId === chatId) {
          req.controller.abort();
          activeRequests.delete(requestId);
          cancelledCount += 1;
        }
      }
      if (cancelledCount > 0) {
        await sendTelegramMessage(chatId, "⏹️ 任务取消指令已下发，正在中止 Agent...");
      } else {
        await sendTelegramMessage(chatId, "ℹ️ 当前没有正在运行的 Agent 任务。");
      }
      return;
    }
  }

  // Treat regular text as instructions
  const pending = pendingAttachmentsByChat.get(chatId) || [];
  pendingAttachmentsByChat.delete(chatId); // Consume
  await runRemoteAgentTurn(chatId, text, pending);
}

async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const queryId = query.id;
  const data = String(query.data || "");

  if (!data.startsWith("tg:")) return;
  await answerCallbackQuery(queryId, "正在处理审批...");

  // Parse: tg:approve:patch:<id> or tg:discard:patch:<id>
  const parts = data.split(":");
  const action = parts[1]; // "approve" or "discard"
  const type = parts[2]; // "patch" or "command" or "question"
  const id = parts[3];
  const option = parts[4] ? decodeURIComponent(parts[4]) : undefined;

  // Edit message to remove buttons and show action status
  const actionText = action === "approve" ? "已批准 ✅" : "已拒绝 ❌";
  const originalText = String(query.message.text || "");
  await editTelegramMessage(chatId, messageId, `${originalText}\n\n**我的决策：${actionText}**`);

  // Resume the agent execution
  const requestId = randomUUID();
  const controller = new AbortController();
  activeRequests.set(requestId, { chatId, controller });

  const emit = createTelegramEmit(chatId, requestId);

  try {
    const response = await resumeAgentContinuation(
      {
        requestId,
        continuationId: id,
        kind: type,
        decision: action === "approve" ? "approved" : "discarded",
        option,
        answer: option,
        language: "zh",
        signal: controller.signal
      },
      emit
    );

    if (!response.ok) {
      emit({ type: "error", message: response.error || "恢复会话失败" });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      emit({ type: "error", message: error.message });
    }
  } finally {
    activeRequests.delete(requestId);
  }
}

async function runRemoteAgentTurn(chatId, userInput, attachments = []) {
  // Check if there is already an active request running for this chat
  for (const req of activeRequests.values()) {
    if (req.chatId === chatId) {
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
  activeRequests.set(requestId, { chatId, controller });

  const emit = createTelegramEmit(chatId, requestId);

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
        messages: [], // Do not send prior history, only reply to the latest message
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
    activeRequests.delete(requestId);
  }
}

function createTelegramEmit(chatId, requestId) {
  let streamMessageId = null;
  let planMessageId = null;
  let textBuffer = "";
  let reasoningBuffer = "";
  let streamTimer = null;
  let lastStatusText = "";

  const sendOrEditStreamMessage = async () => {
    let output = "";
    if (reasoningBuffer.trim()) {
      output += `💭 **思考链:**\n> ${reasoningBuffer.replace(/\n/g, "\n> ")}\n\n`;
    }
    output += `🤖 **Agent:**\n${textBuffer}`;

    if (lastStatusText) {
      output += `\n\n⏳ _${lastStatusText}_`;
    }

    try {
      if (streamMessageId === null) {
        const res = await sendTelegramMessage(chatId, output || "思考中...");
        if (res && res.ok) {
          streamMessageId = res.result.message_id;
        }
      } else {
        await editTelegramMessage(chatId, streamMessageId, output);
      }
    } catch {
      // Ignore network glitches during streaming updates
    }
  };

  const scheduleStreamUpdate = () => {
    if (streamTimer) return;
    streamTimer = setTimeout(async () => {
      streamTimer = null;
      await sendOrEditStreamMessage();
    }, 1500);
  };

  return (event) => {
    if (event.type === "status") {
      lastStatusText = event.message;
      scheduleStreamUpdate();
      return;
    }

    if (event.type === "stream_delta") {
      textBuffer += event.text;
      scheduleStreamUpdate();
      return;
    }

    if (event.type === "reasoning_delta") {
      reasoningBuffer += event.text;
      scheduleStreamUpdate();
      return;
    }

    // When tool starts, update the status
    if (event.type === "tool_start") {
      lastStatusText = `🔧 正在调用工具: ${event.name}...`;
      scheduleStreamUpdate();
      return;
    }

    if (event.type === "tool_result") {
      lastStatusText = `✅ 工具 ${event.name} 调用完毕`;
      scheduleStreamUpdate();
      return;
    }

    if (event.type === "tool_error") {
      lastStatusText = `❌ 工具 ${event.name} 失败: ${event.message}`;
      scheduleStreamUpdate();
      return;
    }

    if (event.type === "plan_update") {
      const planText = formatPlanChecklist(event.items);
      if (planText) {
        const updatePlanMsg = async () => {
          try {
            if (planMessageId === null) {
              const res = await sendTelegramMessage(chatId, planText);
              if (res && res.ok) {
                planMessageId = res.result.message_id;
              }
            } else {
              await editTelegramMessage(chatId, planMessageId, planText);
            }
          } catch (error) {
            console.error("[Telegram Bot] plan_update send/edit failed:", error.message);
          }
        };
        void updatePlanMsg();
      }
      return;
    }

    if (event.type === "model") {
      // Record full response into local buffer just in case
      textBuffer = event.message || textBuffer;
      reasoningBuffer = event.reasoning || reasoningBuffer;
      return;
    }

    // Clear streaming timers and send final clean message
    const cleanUpStreams = async () => {
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }
      // Trigger one last sync update
      await sendOrEditStreamMessage();
      streamMessageId = null;
      planMessageId = null;
      textBuffer = "";
      reasoningBuffer = "";
    };

    if (event.type === "done") {
      void cleanUpStreams().then(async () => {
        // Append message to persisted session and save
        const session = await getOrCreateRemoteSession();
        const lastMsg = session.messages[session.messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") return; // Already saved

        session.messages.push({
          role: "assistant",
          content: event.message || "",
          reasoning: event.reasoning || undefined,
          createdAt: Date.now()
        });
        await saveRemoteSession(session);
      });
      return;
    }

    if (event.type === "error") {
      void cleanUpStreams().then(async () => {
        await sendTelegramMessage(chatId, `❌ **运行出错**:\n${event.message}`);
        const session = await getOrCreateRemoteSession();
        session.messages.push({
          role: "assistant",
          content: `错误: ${event.message}`,
          createdAt: Date.now()
        });
        await saveRemoteSession(session);
      });
      return;
    }

    if (event.type === "cancelled") {
      void cleanUpStreams().then(async () => {
        await sendTelegramMessage(chatId, `⏹️ **任务取消**:\n${event.message}`);
      });
      return;
    }

    // --- Approvals Handling ---

    if (event.type === "command_pending") {
      void cleanUpStreams().then(async () => {
        const riskPrefix = event.highRisk ? "🚨 **高风险操作** " : "⚠️ ";
        const text =
          `${riskPrefix}**待审批命令**:\n` +
          `\`${event.command}\`\n\n` +
          `• **工作目录**: \`${event.cwd || "./"}\`\n` +
          `• **申请理由**: ${event.reason}`;

        await sendTelegramMessage(chatId, text, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ 批准执行 (Approve)", callback_data: `tg:approve:command:${event.commandId}` },
                { text: "❌ 拒绝 (Discard)", callback_data: `tg:discard:command:${event.commandId}` }
              ]
            ]
          }
        });
      });
      return;
    }

    if (event.type === "patch_proposed") {
      void cleanUpStreams().then(async () => {
        // Show summary and preview patch (truncated if too large)
        const diffText = String(event.patch || "");
        const truncatedDiff = diffText.length > 2500 ? `${diffText.slice(0, 2500)}\n... (剩余较长，已截断)` : diffText;

        const text =
          `📝 **待审批补丁**:\n` +
          `**${event.summary}**\n\n` +
          `\`\`\`diff\n` +
          `${truncatedDiff}\n` +
          `\`\`\``;

        await sendTelegramMessage(chatId, text, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ 批准应用", callback_data: `tg:approve:patch:${event.patchId}` },
                { text: "❌ 丢弃补丁", callback_data: `tg:discard:patch:${event.patchId}` }
              ]
            ]
          }
        });
      });
      return;
    }

    if (event.type === "ask_user_pending") {
      void cleanUpStreams().then(async () => {
        const text =
          `❓ **Agent 提问澄清**:\n` +
          `${event.question}\n\n` +
          `${event.context ? `背景: _${event.context}_\n\n` : ""}` +
          `请选择一个选项答复：`;

        const buttons = (event.options || ["Yes", "No"]).map((option, idx) => {
          return [{ text: option, callback_data: `tg:approve:question:${event.questionId}:${encodeURIComponent(option)}` }];
        });

        // Add a cancel/dismiss option
        buttons.push([{ text: "❌ 忽略/跳过", callback_data: `tg:discard:question:${event.questionId}` }]);

        await sendTelegramMessage(chatId, text, {
          reply_markup: {
            inline_keyboard: buttons
          }
        });
      });
      return;
    }
  };
}

// --- Helper Functions targeting Telegram Bot API ---

async function downloadTelegramFile(fileId, fileName) {
  const getFileUrl = `https://api.telegram.org/bot${activeBotToken}/getFile?file_id=${fileId}`;
  const response = await fetch(getFileUrl, { signal: abortController?.signal });
  if (!response.ok) {
    throw new Error(`Telegram getFile API returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`Telegram getFile failed: ${data.description || "No file path"}`);
  }
  
  const filePath = data.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${activeBotToken}/${filePath}`;
  const fileResponse = await fetch(downloadUrl, { signal: abortController?.signal });
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

function escapeMarkdown(text) {
  return String(text || "").replace(/([_*`\[\]()])/g, "\\$1");
}

function formatPlanChecklist(items) {
  if (!items || items.length === 0) return "";
  
  const lines = items.map((item) => {
    let icon = "⬜";
    if (item.status === "completed") {
      icon = "✅";
    } else if (item.status === "in_progress") {
      icon = "⏳";
    }
    return `${icon} ${escapeMarkdown(item.step)}`;
  });
  
  return `📋 **执行计划**:\n${lines.join("\n")}`;
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    const url = `https://api.telegram.org/bot${activeBotToken}/sendMessage`;
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      ...extra
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await response.json();
  } catch (error) {
    console.error("[Telegram Bot] sendMessage failed:", error.message);
  }
}

async function editTelegramMessage(chatId, messageId, text, extra = {}) {
  try {
    const url = `https://api.telegram.org/bot${activeBotToken}/editMessageText`;
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
      ...extra
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await response.json();
  } catch (error) {
    console.error("[Telegram Bot] editMessageText failed:", error.message);
  }
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  try {
    const url = `https://api.telegram.org/bot${activeBotToken}/answerCallbackQuery`;
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

// --- Session Persistence Helpers ---

async function getOrCreateRemoteSession() {
  const sessions = await loadPersistedSessions().catch(() => []);
  let session = sessions.find((s) => s.id === "telegram-remote");

  if (!session) {
    // Find last active workspace from existing sessions to default
    const lastWorkspace = sessions[0]?.workspace || process.cwd();

    session = {
      id: "telegram-remote",
      title: "Telegram Remote",
      titleEdited: true,
      workspace: lastWorkspace,
      messages: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    sessions.push(session);
    await savePersistedSessions(sessions);
  }

  return session;
}

async function saveRemoteSession(updatedSession) {
  const sessions = await loadPersistedSessions().catch(() => []);
  const idx = sessions.findIndex((s) => s.id === "telegram-remote");
  updatedSession.updatedAt = Date.now();
  if (idx !== -1) {
    sessions[idx] = updatedSession;
  } else {
    sessions.push(updatedSession);
  }
  await savePersistedSessions(sessions);
}
