import os from "node:os";
import { getOrCreateRemoteSession } from "../telegram-session.js";
import { loadAppConfig } from "../../config.js";
import { telegramState } from "../../telegram-bot.js";
import { sendTelegramMessage } from "../telegram-api.js";

export async function handleStatusCommand(chatId) {
  try {
    const session = await getOrCreateRemoteSession();
    const config = await loadAppConfig();
    const modelLabel = config.capability?.label || config.model || "Unknown";
    
    let gitText = "未初始化或不是 Git 仓库";
    try {
      const { getGitSummary } = await import("../../workspace.js");
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
}
