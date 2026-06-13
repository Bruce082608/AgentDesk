import type { AttachedFile, ChatMessage } from "../../types";
import type { Language } from "../../i18n";

export type ToolCardStatus = "running" | "completed" | "error";

export function formatMessageTimestamp(timestamp: number | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "未记录时间" : "Timestamp not recorded";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(timestamp);
}

export function formatDuration(durationMs: number | undefined, language: Language) {
  if (!Number.isFinite(durationMs) || Number(durationMs) < 0) return "";
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const value = Number(durationMs);
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`;
  if (value < 60000) {
    return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: value < 10000 ? 1 : 0 })}s`;
  }
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function toolStatusLabel(status: ToolCardStatus, language: Language) {
  if (status === "running") return language === "zh" ? "执行中" : "Running";
  if (status === "error") return language === "zh" ? "失败" : "Failed";
  return language === "zh" ? "完成" : "Done";
}

export function toolActionLabel(name: string, language: Language) {
  const zh = language === "zh";
  const normalized = String(name || "").toLowerCase();
  const labels: Record<string, [string, string]> = {
    list_files: ["List files", "列出文件"],
    workspace_map: ["Workspace map", "项目地图"],
    read_file: ["Read file", "读取文件"],
    read_files: ["Read files", "批量读取文件"],
    read_file_range: ["Read range", "读取行范围"],
    read_result_chunk: ["Read result chunk", "读取结果分页"],
    search_files: ["Search files", "搜索文件"],
    web_search: ["Web search", "联网搜索"],
    write_file: ["Write file", "写入文件"],
    delete_file: ["Delete file", "删除文件"],
    replace_text: ["Replace text", "替换文本"],
    apply_patch: ["Apply patch", "应用 Patch"],
    ask_user: ["Ask user", "询问用户"],
    update_plan: ["Update plan", "更新计划"],
    run_command: ["Run command", "运行命令"],
    start_command: ["Start command", "启动命令"],
    read_command_output: ["Read output", "读取命令输出"],
    stop_command: ["Stop command", "停止命令"],
    browser_page: ["Browser", "浏览器验证"],
    system_clipboard: ["Clipboard", "剪贴板"],
    system_window_info: ["Window info", "窗口信息"],
    system_notify: ["Notify", "系统通知"],
    background_task: ["Background task", "后台任务"]
  };
  return labels[normalized]?.[zh ? 1 : 0] || name || (zh ? "工具调用" : "Tool call");
}

export function parseToolPayload(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function truncateInline(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

export function summarizeRunningTool(name: string, args: Record<string, unknown> | null, language: Language) {
  const zh = language === "zh";
  const normalized = String(name || "").toLowerCase();
  if (normalized === "read_file" || normalized === "read_file_range") {
    const path = stringValue(args?.path);
    return path ? (zh ? `正在读取 ${truncateInline(path, 62)}` : `Reading ${truncateInline(path, 62)}`) : (zh ? "正在读取文件" : "Reading file");
  }
  if (normalized === "read_files") {
    const paths = Array.isArray(args?.paths) ? args.paths.length : 0;
    return zh ? `正在批量读取 ${paths || ""} 个文件`.trim() : `Reading ${paths || ""} files`.trim();
  }
  if (normalized === "read_result_chunk") return zh ? "正在读取结果分页" : "Reading result chunk";
  if (normalized === "workspace_map") return zh ? "正在生成项目地图" : "Mapping workspace";
  if (normalized === "list_files") {
    const directory = stringValue(args?.directory);
    return directory ? (zh ? `正在列出 ${truncateInline(directory, 62)}` : `Listing ${truncateInline(directory, 62)}`) : (zh ? "正在列出工作区文件" : "Listing workspace files");
  }
  if (normalized === "search_files" || normalized === "web_search") {
    const query = stringValue(args?.query);
    return query ? (zh ? `正在搜索：${truncateInline(query, 62)}` : `Searching for ${truncateInline(query, 62)}`) : (zh ? "正在搜索" : "Searching");
  }
  if (normalized === "run_command" || normalized === "start_command") {
    const command = stringValue(args?.command);
    return command ? (zh ? `正在运行：${truncateInline(command, 62)}` : `Running ${truncateInline(command, 62)}`) : (zh ? "正在运行命令" : "Running command");
  }
  if (normalized === "read_command_output") return zh ? "正在读取命令输出" : "Reading command output";
  if (normalized === "stop_command") return zh ? "正在停止命令" : "Stopping command";
  if (normalized === "browser_page") {
    const action = stringValue(args?.action) || (stringValue(args?.url) ? "open" : "");
    const url = stringValue(args?.url);
    return zh
      ? `正在执行浏览器 ${action || "操作"}${url ? `：${truncateInline(url, 58)}` : ""}`
      : `Running browser ${action || "action"}${url ? `: ${truncateInline(url, 58)}` : ""}`;
  }
  if (normalized === "apply_patch") {
    const summary = stringValue(args?.summary);
    return summary ? truncateInline(summary, 80) : (zh ? "正在准备文件变更" : "Preparing file changes");
  }
  if (normalized === "write_file" || normalized === "delete_file") {
    const path = stringValue(args?.path);
    return path ? (zh ? `正在处理 ${truncateInline(path, 62)}` : `Working on ${truncateInline(path, 62)}`) : (zh ? "正在处理文件" : "Working on files");
  }
  if (normalized === "ask_user") return zh ? "正在准备一个确认问题" : "Preparing a question";
  if (normalized === "update_plan") return zh ? "正在更新执行计划" : "Updating the plan";
  return zh ? "正在调用工具" : "Calling tool";
}

export function summarizeToolCall(name: string, rawArgs: string | undefined, rawResult: string | undefined, status: ToolCardStatus, language: Language) {
  const zh = language === "zh";
  const args = parseToolPayload(rawArgs);
  const result = parseToolPayload(rawResult);
  if (status === "running") return summarizeRunningTool(name, args, language);

  if (status === "error" || result?.ok === false) {
    const message = stringValue(result?.error) || stringValue(result?.message) || (zh ? "工具调用失败" : "Tool call failed");
    return zh ? `失败：${truncateInline(message, 80)}` : `Failed: ${truncateInline(message, 80)}`;
  }

  if (name === "list_files") {
    const count = Array.isArray(result?.files) ? result.files.length : 0;
    const truncated = result?.truncated ? (zh ? "，结果已截断" : ", truncated") : "";
    return zh ? `已列出 ${count} 个文件${truncated}` : `Listed ${count} files${truncated}`;
  }

  if (name === "workspace_map") {
    const packageInfo = result?.package && typeof result.package === "object" ? result.package as Record<string, unknown> : null;
    const scripts = packageInfo?.scripts && typeof packageInfo.scripts === "object" ? packageInfo.scripts as Record<string, unknown> : null;
    const scriptCount = scripts
      ? Object.keys(scripts).length
      : 0;
    const frameworkCount = Array.isArray(result?.frameworks) ? result.frameworks.length : 0;
    return zh ? `已生成项目地图：${frameworkCount} 个框架，${scriptCount} 个脚本` : `Mapped workspace: ${frameworkCount} frameworks, ${scriptCount} scripts`;
  }

  if (name === "read_file") {
    const path = stringValue(args?.path);
    const chars = stringValue(result?.result).length;
    return zh
      ? `已读取${path ? ` ${path}` : ""}${chars ? `，${chars.toLocaleString("zh-CN")} 字符` : ""}`
      : `Read${path ? ` ${path}` : ""}${chars ? `, ${chars.toLocaleString("en-US")} chars` : ""}`;
  }

  if (name === "read_files") {
    const count = Array.isArray(result?.files) ? result.files.length : 0;
    const failed = Array.isArray(result?.files) ? result.files.filter((file) => file && typeof file === "object" && file.ok === false).length : 0;
    return zh
      ? `已读取 ${count} 个文件${failed ? `，${failed} 个失败` : ""}`
      : `Read ${count} files${failed ? `, ${failed} failed` : ""}`;
  }

  if (name === "read_file_range") {
    const path = stringValue(result?.path) || stringValue(args?.path);
    const start = Number(result?.startLine) || Number(args?.start_line) || 1;
    const end = Number(result?.endLine) || Number(args?.end_line) || start;
    return zh
      ? `已读取${path ? ` ${path}` : ""} 第 ${start}-${end} 行`
      : `Read${path ? ` ${path}` : ""} lines ${start}-${end}`;
  }

  if (name === "read_result_chunk") {
    const chars = Number(result?.returnedChars) || stringValue(result?.chunk).length;
    const hasMore = result?.hasMore;
    return zh
      ? `已读取结果分页 ${chars.toLocaleString("zh-CN")} 字符${hasMore ? "，还有更多" : ""}`
      : `Read ${chars.toLocaleString("en-US")} result chars${hasMore ? ", more available" : ""}`;
  }

  if (name === "search_files" || name === "web_search") {
    const count = Array.isArray(result?.results) ? result.results.length : 0;
    const query = stringValue(result?.query) || stringValue(args?.query);
    return zh ? `找到 ${count} 条结果${query ? `：${truncateInline(query, 48)}` : ""}` : `Found ${count} results${query ? ` for ${truncateInline(query, 48)}` : ""}`;
  }

  if (name === "run_command") {
    if (result?.pending) return zh ? "命令等待确认" : "Command is waiting for approval";
    const stdout = stringValue(result?.stdout);
    const stderr = stringValue(result?.stderr);
    if (stderr) return zh ? `命令完成，有 stderr：${truncateInline(stderr, 70)}` : `Command completed with stderr: ${truncateInline(stderr, 70)}`;
    return stdout ? (zh ? `命令完成：${truncateInline(stdout, 70)}` : `Command completed: ${truncateInline(stdout, 70)}`) : (zh ? "命令已完成" : "Command completed");
  }

  if (name === "start_command") {
    if (result?.pending) return zh ? "命令等待确认" : "Command is waiting for approval";
    const id = stringValue(result?.sessionId);
    return id ? (zh ? `后台命令已启动：${truncateInline(id, 36)}` : `Background command started: ${truncateInline(id, 36)}`) : (zh ? "后台命令已启动" : "Background command started");
  }

  if (name === "read_command_output") {
    const output = stringValue(result?.output);
    const running = result?.running;
    return zh
      ? `读取输出 ${output.length.toLocaleString("zh-CN")} 字符${running ? "，仍在运行" : "，已结束"}`
      : `Read ${output.length.toLocaleString("en-US")} output chars${running ? ", still running" : ", exited"}`;
  }

  if (name === "stop_command") return zh ? "后台命令已请求停止" : "Background command stop requested";

  if (name === "browser_page") {
    const action = stringValue(result?.action) || stringValue(args?.action) || (stringValue(args?.url) ? "open" : "");
    const errors = Array.isArray(result?.pageErrors) ? result.pageErrors.length : 0;
    const consoleErrors = Array.isArray(result?.consoleErrors) ? result.consoleErrors.length : 0;
    const url = stringValue(result?.url) || stringValue(args?.url);
    const suffix = errors || consoleErrors
      ? (zh ? `，发现 ${errors + consoleErrors} 个错误/警告` : `, ${errors + consoleErrors} errors/warnings`)
      : "";
    return zh
      ? `浏览器 ${action || "操作"} 完成${url ? `：${truncateInline(url, 52)}` : ""}${suffix}`
      : `Browser ${action || "action"} completed${url ? `: ${truncateInline(url, 52)}` : ""}${suffix}`;
  }

  if (name === "apply_patch" || name === "write_file" || name === "delete_file" || name === "replace_text") {
    if (result?.pending) return zh ? "变更等待确认" : "Change is waiting for approval";
    if (result?.applied || result?.written || result?.deleted) return zh ? "文件变更已应用" : "File change applied";
    return stringValue(result?.summary) || (zh ? "文件变更已生成" : "File change prepared");
  }

  if (name === "ask_user") return zh ? "已向用户请求输入" : "Asked the user for input";
  if (name === "update_plan") {
    const count = Array.isArray(result?.items) ? result.items.length : 0;
    return zh ? `计划已更新，${count} 项` : `Plan updated, ${count} items`;
  }

  const message = stringValue(result?.message) || stringValue(result?.result);
  return message ? truncateInline(message, 90) : (zh ? "工具调用完成" : "Tool call completed");
}

export function isToolResultError(rawResult: string | undefined) {
  return parseToolPayload(rawResult)?.ok === false;
}

export function formatToolCardPayload(raw: string | undefined) {
  if (!raw?.trim()) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function getStreamingAssistantIndex(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (message.content.trim() || message.reasoning?.trim()) return index;
    if (!message.tool_calls?.length) return index;
  }
  return -1;
}

export function formatAttachmentStatus(file: AttachedFile, language: Language) {
  const zh = language === "zh";
  if (file.status === "large") return zh ? "过大" : "large";
  if (file.status === "binary") return zh ? "二进制" : "binary";
  if (file.status === "truncated" || file.truncated) return zh ? "已截断" : "truncated";
  return zh ? "就绪" : "ready";
}

export function formatAttachmentTitle(file: AttachedFile, language: Language, removeTitle: string) {
  const parts = [
    removeTitle,
    file.path,
    formatAttachmentStatus(file, language),
    file.size ? `${file.size.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} bytes` : "",
    file.chars ? `${file.chars.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} chars` : "",
    file.duplicateCount && file.duplicateCount > 1 ? `${language === "zh" ? "重复添加" : "duplicate adds"}: ${file.duplicateCount}` : ""
  ].filter(Boolean);
  return parts.join("\n");
}
