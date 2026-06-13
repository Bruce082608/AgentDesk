import { sendTelegramMessage } from "../telegram-api.js";

export async function handleStartHelpCommand(chatId) {
  let lanUrl = "http://localhost:5175";
  try {
    const { getWebServerState } = await import("../../web-server.js");
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
}
