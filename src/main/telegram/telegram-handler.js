import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BrowserWindow } from "electron";
import { runAgentTurn, resumeAgentContinuation } from "../agent.js";
import { loadPersistedSessions, savePersistedSessions } from "../persistence.js";
import { loadAppConfig } from "../config.js";
import { readAttachmentFiles } from "../attachments.js";
import { capturePrimaryScreen } from "../screen-capture.js";
import { telegramState } from "../telegram-bot.js";
import {
  downloadTelegramFile,
  escapeMarkdown,
  sendTelegramMessage,
  editTelegramMessage,
  sendTelegramPhoto,
  sendTelegramDocument,
  answerCallbackQuery
} from "./telegram-api.js";

export function formatPlanChecklist(items) {
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

  if (text.startsWith("/")) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    
    if (cmd === "/start" || cmd === "/help") {
      let lanUrl = "http://localhost:5175";
      try {
        const { getWebServerState } = await import("../web-server.js");
        lanUrl = getWebServerState().lanUrl;
      } catch (e) {}

      await sendTelegramMessage(
        chatId,
        "🤖 **欢迎使用 AgentDesk 远程控制机器人！**\n\n" +
          "直接向我发送任何开发指令，我将启动本地 Agent 为你编写代码、运行测试或部署应用。\n\n" +
          "**可用命令列表：**\n" +
          "• `/status` - 查看当前项目工作区、Git 及宿主机状态\n" +
          "• `/workspace [绝对路径]` - 查看当前工作区或远程切换工作区\n" +
          "• `/sessions` - 列出本地会话，并支持通过按钮快速切换工作区\n" +
          "• `/clear` - 清空当前积攒的待处理文件附件队列\n" +
          "• `/webapp_url [HTTPS链接]` - 配置并挂载底部的 Telegram 网页面板按钮\n" +
          "• `/screenshot` - 截取当前电脑屏幕并发送图片\n" +
          "• `/cancel` - 中断当前正在执行的 Agent 任务\n" +
          "• `/help` - 显示此帮助信息\n\n" +
          `🖥️ **局域网直接访问链接** (限同 Wi-Fi 访问):\n\`${lanUrl}\`\n\n` +
          "所有包含修改文件或运行敏感命令的操作都将在手机端弹出确认按钮，保障系统安全。"
      );
      return;
    }

    if (cmd === "/status") {
      try {
        const session = await getOrCreateRemoteSession();
        const config = await loadAppConfig();
        const modelLabel = config.capability?.label || config.model || "Unknown";
        
        let gitText = "未初始化或不是 Git 仓库";
        try {
          const { getGitSummary } = await import("../workspace.js");
          const gitSummary = await getGitSummary(session.workspace);
          gitText = `\`${gitSummary.branch}\` (改动文件数: ${gitSummary.changedFiles.length})`;
        } catch (e) {}

        const totalMemGb = (os.totalmem() / (1024 ** 3)).toFixed(1);
        const freeMemGb = (os.freemem() / (1024 ** 3)).toFixed(1);
        const platform = os.platform();
        const arch = os.arch();
        const activeCount = telegramState.activeRequests.size;
        const usage = session.tokenUsage || { totalTokens: 0, requests: 0 };

        await sendTelegramMessage(
          chatId,
          `💻 **系统状态与统计**\n\n` +
            `• **当前工作区**: \`${session.workspace}\`\n` +
            `• **Git 状态**: ${gitText}\n` +
            `• **AI 模型**: \`${modelLabel}\`\n` +
            `• **活动任务**: \`${activeCount}\` 个正在运行\n` +
            `• **手机端用量**: \`${usage.totalTokens.toLocaleString()}\` tokens (\`${usage.requests}\` 次请求)\n\n` +
            `🖥️ **宿主机状态 (${platform}-${arch})**:\n` +
            `• **内存占用**: \`${(totalMemGb - freeMemGb).toFixed(1)} / ${totalMemGb} GB\`\n` +
            `• **系统负载 (1m/5m/15m)**: \`${os.loadavg().map(v => v.toFixed(2)).join(" / ")}\``
        );
      } catch (error) {
        await sendTelegramMessage(chatId, `❌ 获取状态失败: ${error.message}`);
      }
      return;
    }

    if (cmd === "/workspace") {
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
      return;
    }

    if (cmd === "/sessions" || cmd === "/chats") {
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
      return;
    }

    if (cmd === "/clear") {
      telegramState.pendingAttachmentsByChat.delete(chatId);
      await sendTelegramMessage(chatId, "🧹 已清空当前所有待处理的附件队列。");
      return;
    }

    if (cmd === "/webapp_url") {
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

          const { getWebServerState } = await import("../web-server.js");
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
      return;
    }

    if (cmd === "/cancel") {
      let cancelledCount = 0;
      for (const [requestId, req] of telegramState.activeRequests.entries()) {
        if (req.chatId === chatId) {
          req.controller.abort();
          telegramState.activeRequests.delete(requestId);
          cancelledCount += 1;
        }
      }
      if (cancelledCount > 0) {
        await sendTelegramMessage(chatId, "⏹️ 任务取消指令已下发，正在中止 Agent...");
      } else {
        await sendTelegramMessage(chatId, "ℹ️ 当前没有正在运行 of Agent 任务。");
      }
      return;
    }

    if (cmd === "/screenshot") {
      try {
        await sendTelegramMessage(chatId, "📸 正在截取电脑屏幕，请稍候...");
        const pngBuffer = await capturePrimaryScreen();
        await sendTelegramPhoto(chatId, pngBuffer, "🖥️ **当前电脑屏幕截图**");
      } catch (error) {
        console.error("[Telegram Bot] Screenshot failed:", error);
        await sendTelegramMessage(chatId, `❌ 截图失败: ${error.message}`);
      }
      return;
    }
  }

  // Treat regular text as instructions
  const pending = telegramState.pendingAttachmentsByChat.get(chatId) || [];
  telegramState.pendingAttachmentsByChat.delete(chatId); // Consume
  await runRemoteAgentTurn(chatId, text, pending);
}

export async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const queryId = query.id;
  const data = String(query.data || "");

  if (!data.startsWith("tg:")) return;

  // Handle immediate task cancel button click
  if (data === "tg:cancel" || data.startsWith("tg:cancel:")) {
    await answerCallbackQuery(queryId, "正在中止任务...");
    for (const [requestId, req] of telegramState.activeRequests.entries()) {
      if (req.chatId === chatId) {
        req.controller.abort();
        telegramState.activeRequests.delete(requestId);
      }
    }
    return;
  }

  // Parse: tg:approve:patch:<id> or tg:discard:patch:<id>
  const parts = data.split(":");

  if (parts[1] === "switch_session") {
    const idx = parseInt(parts[2], 10);
    await answerCallbackQuery(queryId, "正在切换工作区...");
    try {
      const sessions = await loadPersistedSessions().catch(() => []);
      const filtered = sessions.filter(s => s.id !== "telegram-remote");
      const targetSession = filtered[idx];
      if (targetSession) {
        const session = await getOrCreateRemoteSession();
        session.workspace = targetSession.workspace;
        await saveRemoteSession(session);
        await editTelegramMessage(chatId, messageId, `${query.message.text}\n\n**已成功将工作区切换至：**\n\`${targetSession.workspace}\``);
      } else {
        await sendTelegramMessage(chatId, "⚠️ 找不到指定的会话记录。");
      }
    } catch (error) {
      await sendTelegramMessage(chatId, `❌ 切换工作区失败: ${error.message}`);
    }
    return;
  }

  await answerCallbackQuery(queryId, "正在处理审批...");

  let action, type, id, option;

  if (data.startsWith("tg:q:")) {
    const subAction = parts[2];
    action = subAction === "a" ? "approve" : "discard";
    type = "question";
    id = parts[3];
    const idx = parts[4] ? parseInt(parts[4], 10) : undefined;

    if (subAction === "a" && idx !== undefined) {
      try {
        const continuation = await getOrCreateRemoteSession().then(() =>
          import("../persistence.js").then((p) => p.getAgentContinuation(id))
        );
        option = continuation?.approval?.options?.[idx];
      } catch (err) {
        console.error("[Telegram Bot] Failed to load continuation for option mapping:", err);
      }
    }
  } else {
    action = parts[1];
    type = parts[2];
    id = parts[3];
    option = parts[4] ? decodeURIComponent(parts[4]) : undefined;
  }

  const actionText = action === "approve"
    ? (type === "question" && option ? `已回答: ${option} ✅` : "已批准 ✅")
    : "已拒绝 ❌";
  const originalText = String(query.message.text || "");
  await editTelegramMessage(chatId, messageId, `${originalText}\n\n**我的决策：${actionText}**`);

  // Resume the agent execution
  const requestId = randomUUID();
  const controller = new AbortController();
  telegramState.activeRequests.set(requestId, { chatId, controller });

  const continuation = await getOrCreateRemoteSession().then(() =>
    import("../persistence.js").then((p) => p.getAgentContinuation(id))
  );
  const workspace = continuation?.workspace || process.cwd();
  const emit = createTelegramEmit(chatId, requestId, workspace);

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
    } else {
      emit({ type: "done" });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      emit({ type: "error", message: error.message });
    }
  } finally {
    telegramState.activeRequests.delete(requestId);
  }
}

export async function runRemoteAgentTurn(chatId, userInput, attachments = []) {
  // Check if there is already an active request running for this chat
  for (const req of telegramState.activeRequests.values()) {
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

export function createTelegramEmit(chatId, requestId, workspace) {
  let streamMessageId = null;
  let planMessageId = null;
  let textBuffer = "";
  let reasoningBuffer = "";
  let streamTimer = null;
  let lastStatusText = "";
  let sentLength = 0;

  const sendOrEditStreamMessage = async (isFinal = false) => {
    const maxChunkSize = 3500;
    const currentText = textBuffer.slice(sentLength);

    if (currentText.length > maxChunkSize) {
      const chunk = currentText.slice(0, maxChunkSize);
      let output = `📁 **工作区:** \`${workspace}\` (第 ${Math.floor(sentLength / maxChunkSize) + 1} 部分)\n\n`;
      output += chunk;
      output += `\n\n📄 _(内容过长，本段已结束，后续内容将在新消息中发送...)_`;

      try {
        const extra = { reply_markup: { inline_keyboard: [] } };
        if (streamMessageId === null) {
          const res = await sendTelegramMessage(chatId, output, extra);
          if (res && res.ok) {
            streamMessageId = res.result.message_id;
          }
        } else {
          await editTelegramMessage(chatId, streamMessageId, output, extra);
        }
      } catch (err) {
        // ignore
      }

      sentLength += maxChunkSize;
      streamMessageId = null;

      await sendOrEditStreamMessage(isFinal);
      return;
    }

    let output = `📁 **工作区:** \`${workspace}\`${sentLength > 0 ? ` (接上文 - 第 ${Math.floor(sentLength / maxChunkSize) + 1} 部分)` : ""}\n\n`;
    output += currentText;

    if (!isFinal) {
      output += `\n\n🤖 **Agent 正在工作中...**`;
      if (lastStatusText) {
        output += `\n⏳ _${lastStatusText}_`;
      }
    }

    try {
      const extra = isFinal
        ? { reply_markup: { inline_keyboard: [] } }
        : {
            reply_markup: {
              inline_keyboard: [[{ text: "⏹️ 终止 (Cancel)", callback_data: `tg:cancel:${requestId}` }]]
            }
          };

      if (streamMessageId === null) {
        const res = await sendTelegramMessage(chatId, output || "思考中...", extra);
        if (res && res.ok) {
          streamMessageId = res.result.message_id;
        }
      } else {
        await editTelegramMessage(chatId, streamMessageId, output, extra);
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
    if (event.type === "image_sent") {
      void sendTelegramPhoto(chatId, event.buffer, event.caption || "");
      return;
    }

    if (event.type === "status") {
      // Filter out technical context/token sending status messages
      if (
        event.message.includes("发送给模型") ||
        event.message.includes("上下文") ||
        event.message.includes("context")
      ) {
        return;
      }
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
      await sendOrEditStreamMessage(true);
      streamMessageId = null;
      planMessageId = null;
      textBuffer = "";
      reasoningBuffer = "";
      sentLength = 0;
    };

    if (event.type === "done") {
      const content = textBuffer;
      const reasoning = reasoningBuffer || undefined;
      void cleanUpStreams().then(async () => {
        // Append message to persisted session and save
        const session = await getOrCreateRemoteSession();
        const lastMsg = session.messages[session.messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") return; // Already saved

        session.messages.push({
          role: "assistant",
          content: content || "",
          reasoning: reasoning || undefined,
          createdAt: Date.now()
        });
        await saveRemoteSession(session);
      });
      return;
    }

    if (event.type === "error") {
      void cleanUpStreams().then(async () => {
        await sendTelegramMessage(chatId, `❌ **运行出错**:\n${escapeMarkdown(event.message)}`);
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
        await sendTelegramMessage(chatId, `⏹️ **任务取消**:\n${escapeMarkdown(event.message)}`);
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
        const truncatedDiff = diffText.length > 2500 ? `${diffText.slice(0, 2500)}\n... (剩余较长，已截断并附带完整文件)` : diffText;

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

        if (diffText.length > 2500) {
          // Write the full diff to a temp file and upload it
          try {
            const tempDir = os.tmpdir();
            const tempFilePath = path.join(tempDir, `patch_${event.patchId}.diff`);
            await fs.promises.writeFile(tempFilePath, diffText, "utf8");
            await sendTelegramDocument(chatId, tempFilePath, `完整的补丁代码文件 - ${event.summary}`);
            fs.promises.unlink(tempFilePath).catch(() => {});
          } catch (err) {
            console.error("[Telegram Bot] Failed to send full patch document:", err);
          }
        }
      });
      return;
    }

    if (event.type === "ask_user_pending") {
      void cleanUpStreams().then(async () => {
        const text =
          `❓ **Agent 提问澄清**:\n` +
          `${escapeMarkdown(event.question)}\n\n` +
          `${event.context ? `背景: _${escapeMarkdown(event.context)}_\n\n` : ""}` +
          `请选择一个选项答复：`;

        const buttons = (event.options || ["Yes", "No"]).map((option, idx) => {
          return [{ text: option, callback_data: `tg:q:a:${event.questionId}:${idx}` }];
        });

        // Add a cancel/dismiss option
        buttons.push([{ text: "❌ 忽略/跳过", callback_data: `tg:q:d:${event.questionId}` }]);

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

export async function getOrCreateRemoteSession() {
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
    notifySessionsUpdated();
  }

  return session;
}

export async function saveRemoteSession(updatedSession) {
  const sessions = await loadPersistedSessions().catch(() => []);
  const idx = sessions.findIndex((s) => s.id === "telegram-remote");
  updatedSession.updatedAt = Date.now();
  if (idx !== -1) {
    sessions[idx] = updatedSession;
  } else {
    sessions.push(updatedSession);
  }
  await savePersistedSessions(sessions);
  notifySessionsUpdated();
}

export function notifySessionsUpdated() {
  try {
    if (typeof BrowserWindow !== "undefined" && BrowserWindow && typeof BrowserWindow.getAllWindows === "function") {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send("sessions:updated");
        }
      }
    }
    import("../web-server.js").then(({ broadcastSseEvent }) => {
      broadcastSseEvent("sessions:updated", {});
    }).catch(() => {});
  } catch (error) {
    console.error("[Telegram Bot] notifySessionsUpdated failed:", error);
  }
}
