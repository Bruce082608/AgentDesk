import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { telegramState } from "../telegram-bot.js";
import {
  escapeMarkdown,
  sendTelegramMessage,
  editTelegramMessage,
  sendTelegramPhoto,
  sendTelegramDocument
} from "./telegram-api.js";
import { getOrCreateRemoteSession, saveRemoteSession } from "./telegram-session.js";

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
