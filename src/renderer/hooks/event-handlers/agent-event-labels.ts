import type { Language } from "../../i18n";
import type { TaskStatus } from "../../types";

export function classifyToolPhase(name: string): TaskStatus["phase"] {
  const normalized = String(name || "").toLowerCase();
  if (!normalized) return "understanding";
  if (["list_files", "read_file", "read_files", "read_file_range", "read_result_chunk", "search_files", "web_search", "workspace_map", "workspace_tree", "read_command_output"].includes(normalized)) return "searching";
  if (["write_file", "delete_file", "replace_text", "apply_patch"].includes(normalized)) return "editing";
  if (["run_command", "start_command", "stop_command", "browser_page", "system_clipboard", "system_window_info", "system_notify", "background_task"].includes(normalized)) return "running";
  if (["ask_user", "update_plan"].includes(normalized)) return "waiting";
  return "understanding";
}

export function getTaskStatusLabels(language: Language) {
  if (language === "en") {
    return {
      idle: "",
      understanding: "Thinking",
      searching: "Reading files",
      editing: "Editing files",
      waiting: "Waiting for approval",
      running: "Running command",
      completed: "Completed",
      error: "Needs attention"
    };
  }
  return {
    idle: "",
    understanding: "思考中",
    searching: "读取文件",
    editing: "编辑文件",
    waiting: "等待审批",
    running: "运行命令",
    completed: "已完成",
    error: "需要处理"
  };
}

export function getAgentEventLabels(language: Language) {
  if (language === "en") {
    return {
      status: "Status",
      toolStart: "Tool call",
      toolResult: "Tool result",
      toolFailed: "Tool failed",
      streamRecovery: "Stream recovery",
      streamInterrupted: "Stream interrupted",
      pendingChanges: "Pending changes",
      patchWaiting: "Agent proposed a patch and is waiting for approval.",
      patchAutoApplied: "Patch auto-applied",
      commandPending: "Command waiting for approval",
      agentQuestion: "Agent requested input",
      agentError: "Agent error",
      requestFailed: "Request failed",
      requestCancelled: "Request cancelled",
      requestCancelledBody: "Request cancelled.",
      patchApplied: "Patch applied",
      patchApplyFailed: "Patch apply failed",
      patchDiscarded: "Patch discarded",
      commandExecuted: "Command executed",
      futureCommandsAllowed: "Future commands allowed",
      futureCommandsAllowedBody: "Future command requests in this chat and workspace will run automatically until you switch back.",
      commandFailed: "Command failed",
      commandConfirmRestored: "Future command confirmation restored",
      commandConfirmRestoredBody: "Future high-risk or side-effect commands will ask for confirmation again.",
      patchAutoApplyDisabled: "Patch auto-apply disabled",
      patchAutoApplyDisabledBody: "Future file changes will ask for confirmation again.",
      commandAutoRunEnabled: "Command auto-run enabled",
      commandAutoRunDisabled: "Command auto-run disabled",
      autoPermissionScoped: "Only applies to this chat until you switch back. File tools can access paths outside the workspace.",
      commandNeedsConfirm: "High-risk or side-effect commands will ask for confirmation.",
      patchAutoApplyEnabled: "Patch auto-apply enabled",
      patchNeedsConfirm: "File writes, deletes, and patches will ask for confirmation."
    };
  }

  return {
    status: "状态",
    toolStart: "调用工具",
    toolResult: "工具结果",
    toolFailed: "工具失败",
    streamRecovery: "流式恢复",
    streamInterrupted: "流式连接中断",
    pendingChanges: "待确认变更",
    patchWaiting: "Agent 提交了一个 patch，等待应用。",
    patchAutoApplied: "Patch 已自动应用",
    commandPending: "命令等待确认",
    agentQuestion: "Agent 请求用户输入",
    agentError: "Agent 错误",
    requestFailed: "请求失败",
    requestCancelled: "请求已取消",
    requestCancelledBody: "请求已取消。",
    patchApplied: "Patch 已应用",
    patchApplyFailed: "Patch 应用失败",
    patchDiscarded: "Patch 已放弃",
    commandExecuted: "命令已执行",
    futureCommandsAllowed: "后续命令已允许",
    futureCommandsAllowedBody: "当前会话和 workspace 内，后续命令请求将自动执行，直到你切回默认权限。",
    commandFailed: "命令执行失败",
    commandConfirmRestored: "后续命令确认已恢复",
    commandConfirmRestoredBody: "agent 后续高危或副作用命令会再次请求确认。",
    patchAutoApplyDisabled: "自动应用 Patch 已关闭",
    patchAutoApplyDisabledBody: "agent 后续文件变更会再次请求确认。",
    commandAutoRunEnabled: "已启用命令自动执行",
    commandAutoRunDisabled: "已关闭命令自动执行",
    autoPermissionScoped: "仅当前会话生效，文件工具可访问 workspace 外路径，直到你切回默认权限。",
    commandNeedsConfirm: "高危或副作用命令会请求确认。",
    patchAutoApplyEnabled: "已启用 Patch 自动应用",
    patchNeedsConfirm: "文件写入、删除和 patch 会请求确认。"
  };
}
