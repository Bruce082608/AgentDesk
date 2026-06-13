import { randomUUID } from "node:crypto";
import { resumeAgentContinuation } from "../agent.js";
import { loadPersistedSessions } from "../persistence.js";
import { telegramState } from "../telegram-bot.js";
import {
  editTelegramMessage,
  sendTelegramMessage,
  answerCallbackQuery
} from "./telegram-api.js";
import { getOrCreateRemoteSession, saveRemoteSession } from "./telegram-session.js";
import { createTelegramEmit } from "./telegram-emit.js";

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
