import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { normalizeLanguage, t } from "./i18n.js";
import { webSearch } from "./web-search.js";
import { executeSystemTool, isSystemTool } from "./system-tools.js";
import { searchWorkspaceTextWithRg } from "../shared/ripgrep.js";
import { extractPdfText, isPdfExtension, looksBinaryBuffer } from "../shared/pdfReader.js";

import {
  buildWholeFilePatch,
  getAutoApprovalState,
  isAutoApprovalEnabled,
  localizedError,
  normalizeWorkspacePath,
  proposePatch,
  resolveInsideWorkspace,
  setScopedAutoApproval
} from "./patch-approval.js";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MAX_FILE_BYTES = 120_000;
const pendingCommands = new Map();

export async function executeToolCall(toolCall, context) {
  const name = toolCall.function?.name;
  const toolContext = normalizeToolContext(context);
  let args = {};

  try {
    args = parseToolArgs(toolCall.function?.arguments, toolContext.language);
    const result = await executeToolImplementation(name, args, toolContext);
    return formatToolSuccess(name, result);
  } catch (error) {
    return formatToolFailure(name, error, args, toolContext.language);
  }
}

async function executeToolImplementation(name, args, context) {
  const workspace = context.workspace;
  if (isSystemTool(name)) return executeSystemTool(name, args, context);
  switch (name) {
    case "list_files":
      return listFiles(workspace, args.directory || "", args.max_files || 120, context.language);
    case "read_file":
      return readFile(context, args.path);
    case "write_file":
      return writeFile(context, args.path, args.content, args.summary);
    case "delete_file":
      return deleteFile(context, args.path, args.summary);
    case "ask_user":
      return askUser(args.question, args.context, args.options, context.language);
    case "apply_patch":
      return proposePatch(context, args.patch, args.summary);
    case "search_files":
      return searchFiles(workspace, args.query, args.max_results || 50, context.language);
    case "web_search":
      return webSearch(args.query, args.max_results || 5, context.language);
    case "run_command":
      return runCommand(context, args.command, args.timeout_ms || 30_000);
    case "update_plan":
      return JSON.stringify({ ok: true, items: Array.isArray(args.items) ? args.items : [] });
    default:
      throw localizedError(context.language, "tools.unknownTool", { name });
  }
}

function formatToolSuccess(name, result) {
  const parsed = parseJsonResult(result);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return JSON.stringify({ ok: parsed.ok !== false, tool: name, ...parsed }, null, 2);
  }
  return JSON.stringify({ ok: true, tool: name, result: String(result ?? "") }, null, 2);
}

function formatToolFailure(name, error, args, fallbackLanguage = "zh") {
  const classified = classifyToolError(error);
  const language = normalizeLanguage(error?.language || fallbackLanguage);
  return JSON.stringify(
    {
      ok: false,
      tool: name || "unknown",
      error: t(language, `tools.toolErrors.${classified.type}`),
      errorType: classified.type,
      detail: [classified.message, classified.detail].filter(Boolean).join("\n").trim(),
      recoverable: classified.recoverable,
      args: sanitizeArgsForError(args)
    },
    null,
    2
  );
}

function parseJsonResult(result) {
  if (result && typeof result === "object") return result;
  if (typeof result !== "string") return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function classifyToolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error?.code === "string" ? error.code : "";
  const detail = [error?.stderr, error?.stdout].filter(Boolean).join("\n").trim();
  const lower = `${code} ${message} ${detail}`.toLowerCase();

  if (code === "ENOENT" || /no such file|not found|不存在|找不到/.test(lower)) {
    return { type: "file_not_found", message, detail, recoverable: true };
  }
  if (code === "EACCES" || code === "EPERM" || /permission denied|operation not permitted|权限/.test(lower)) {
    return { type: "permission_denied", message, detail, recoverable: true };
  }
  if (/json|参数|argument|syntaxerror|unexpected token/.test(lower)) {
    return { type: "invalid_arguments", message, detail, recoverable: true };
  }
  if (/路径越界|路径不安全|unsafe|outside workspace/.test(lower)) {
    return { type: "path_security", message, detail, recoverable: true };
  }
  if (/timeout|timed out|超时/.test(lower)) {
    return { type: "timeout", message, detail, recoverable: true };
  }
  if (/network|fetch|econn|enotfound|socket|搜索请求/.test(lower)) {
    return { type: "network", message, detail, recoverable: true };
  }
  if (/command failed|git apply failed|exited|stderr/.test(lower) || typeof error?.code === "number") {
    return { type: "command_failed", message, detail, recoverable: true };
  }
  return { type: "unknown", message, detail, recoverable: true };
}

function sanitizeArgsForError(args) {
  if (!args || typeof args !== "object") return {};
  const sanitized = { ...args };
  if (typeof sanitized.content === "string" && sanitized.content.length > 500) {
    sanitized.content = `${sanitized.content.slice(0, 500)}...`;
  }
  if (typeof sanitized.patch === "string" && sanitized.patch.length > 500) {
    sanitized.patch = `${sanitized.patch.slice(0, 500)}...`;
  }
  return sanitized;
}

function parseToolArgs(raw, language) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw localizedError(language, "tools.invalidJson", { raw });
  }
}

async function listFiles(workspace, directory, maxFiles, language) {
  const root = resolveInsideWorkspace(workspace, directory || ".", language);
  const limit = Math.min(Number(maxFiles) || 120, 500);
  const files = [];

  async function walk(current) {
    if (files.length >= limit) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(workspace, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  await walk(root);
  return JSON.stringify({ files, truncated: files.length >= limit }, null, 2);
}

async function readFile(context, filePath) {
  const workspace = context.workspace;
  const language = context.language;
  const absolute = resolveReadableFilePath(context, filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw localizedError(language, "tools.notFile", { path: filePath });

  // PDF files – allow larger sizes and extract text
  if (isPdfExtension(filePath)) {
    const result = await extractPdfText(absolute);
    if (result.error) {
      throw localizedError(language, "tools.pdfError", {
        path: filePath,
        message: result.error
      });
    }
    // Build a helpful header so the agent knows it's reading a PDF
    const meta = result.pageCount
      ? `PDF | ${result.pageCount} pages | ${formatToolBytes(result.size)}`
      : `PDF | ${formatToolBytes(result.size)}`;
    const header = [
      `[${meta}]`,
      result.truncated ? `[Note: extracted text was truncated to display limit]` : "",
      ""
    ].filter(Boolean).join("\n");
    return header + result.text;
  }

  // Regular text files – enforce size limit
  if (stat.size > MAX_FILE_BYTES) {
    throw localizedError(language, "tools.fileTooLarge", {
      path: filePath,
      size: stat.size,
      limit: MAX_FILE_BYTES
    });
  }

  // Read as buffer to detect binary content
  const buffer = await fs.readFile(absolute);
  if (looksBinaryBuffer(buffer)) {
    throw localizedError(language, "tools.binaryFile", { path: filePath });
  }

  return buffer.toString("utf8");
}

function formatToolBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function writeFile(context, filePath, content, summary = "") {
  const workspace = context.workspace;
  const normalizedPath = normalizeWorkspacePath(filePath, context.language);
  const absolute = resolveInsideWorkspace(workspace, normalizedPath, context.language);
  const nextContent = String(content ?? "");
  if (Buffer.byteLength(nextContent, "utf8") > MAX_FILE_BYTES * 2) {
    throw localizedError(context.language, "tools.contentTooLarge", { path: normalizedPath, limit: MAX_FILE_BYTES * 2 });
  }

  if (isAutoApprovalEnabled("patch", context)) {
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, nextContent, "utf8");
    return JSON.stringify({ ok: true, written: true, path: normalizedPath, bytes: Buffer.byteLength(nextContent, "utf8") }, null, 2);
  }

  const previousContent = await fs.readFile(absolute, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const patch = buildWholeFilePatch(normalizedPath, previousContent, nextContent);
  const result = JSON.parse(await proposePatch(context, patch, summary || `${previousContent === null ? "Create" : "Update"} ${normalizedPath}`));
  return JSON.stringify({ ...result, patch }, null, 2);
}

async function deleteFile(context, filePath, summary = "") {
  const workspace = context.workspace;
  const normalizedPath = normalizeWorkspacePath(filePath, context.language);
  const absolute = resolveInsideWorkspace(workspace, normalizedPath, context.language);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw localizedError(context.language, "tools.notFile", { path: normalizedPath });

  if (isAutoApprovalEnabled("patch", context)) {
    await fs.rm(absolute, { force: true });
    return JSON.stringify({ ok: true, deleted: true, path: normalizedPath }, null, 2);
  }

  const previousContent = await fs.readFile(absolute, "utf8");
  const patch = buildWholeFilePatch(normalizedPath, previousContent, null);
  const result = JSON.parse(await proposePatch(context, patch, summary || `Delete ${normalizedPath}`));
  return JSON.stringify({ ...result, patch }, null, 2);
}

function askUser(question, context = "", options = [], language) {
  const text = String(question ?? "").trim();
  if (!text) throw localizedError(language, "tools.emptyQuestion");
  const choices = normalizeQuestionOptions(options, text);
  return JSON.stringify(
    {
      ok: true,
      pending: true,
      question: text,
      context: String(context ?? "").trim(),
      options: choices,
      message: "Question shown to the user as multiple-choice options. Stop and wait for the user's selected option before continuing."
    },
    null,
    2
  );
}

function normalizeQuestionOptions(options, question) {
  const choices = Array.isArray(options)
    ? options.map((option) => String(option ?? "").trim()).filter(Boolean)
    : [];
  const unique = [...new Set(choices)].slice(0, 6);
  if (unique.length >= 2) return unique;
  return /[\u3400-\u9fff]/.test(String(question)) ? ["是", "否"] : ["Yes", "No"];
}

async function searchFiles(workspace, query, maxResults, language) {
  const needle = String(query ?? "");
  if (!needle) throw localizedError(language, "tools.emptyQuery");
  const rgResults = await searchWorkspaceTextWithRg({
    workspace,
    query: needle,
    maxResults,
    pathOptions: pathSecurityOptions(language)
  }).catch(() => null);
  if (rgResults) return JSON.stringify(rgResults, null, 2);

  const filesJson = await listFiles(workspace, ".", 400);
  const files = JSON.parse(filesJson).files;
  const results = [];
  const limit = Math.min(Number(maxResults) || 50, 100);

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const content = await readFile({ workspace, language, attachments: [] }, file);
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes(needle)) {
          results.push({ file, line: index + 1, text: lines[index].slice(0, 240) });
          if (results.length >= limit) break;
        }
      }
    } catch {
      continue;
    }
  }

  return JSON.stringify({ results, truncated: results.length >= limit }, null, 2);
}

async function runCommand(context, command, timeoutMs) {
  const workspace = context.workspace;
  const commandText = String(command ?? "").trim();
  if (!commandText) throw localizedError(context.language, "tools.emptyCommand");
  const timeout = normalizeCommandTimeout(timeoutMs);
  const shell = getShellInvocation(commandText);
  const cwd = path.resolve(workspace);
  const highRisk = isDangerousCommand(commandText);
  if (!isAutoApprovalEnabled("command", context) && (highRisk || !isAutoAllowedCommand(commandText))) {
    const commandId = randomUUID();
    pendingCommands.set(commandId, {
      id: commandId,
      workspace: cwd,
      requestId: context.requestId,
      sessionId: context.sessionId,
      command: commandText,
      highRisk,
      timeoutMs: timeout,
      cwd,
      shell: formatShellLabel(shell.file),
      inheritedEnv: true,
      language: context.language,
      createdAt: Date.now()
    });
    return JSON.stringify({
      ok: true,
      pending: true,
      commandId,
      command: commandText,
      cwd,
      timeoutMs: timeout,
      shell: formatShellLabel(shell.file),
      inheritedEnv: true,
      highRisk,
      risk: highRisk ? "high" : "normal",
      riskReason: commandApprovalReason(highRisk, context.language),
      message: t(context.language, "tools.commandQueued")
    });
  }

  return executeCommand(workspace, commandText, timeout);
}

async function executeCommand(workspace, commandText, timeoutMs) {
  const timeout = normalizeCommandTimeout(timeoutMs);
  const { file, args } = getShellInvocation(commandText);
  const cwd = path.resolve(workspace);
  const { stdout, stderr } = await execFileAsync(file, args, {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: 1_000_000
  });

  return JSON.stringify({ stdout, stderr, cwd, timeoutMs: timeout, shell: formatShellLabel(file), inheritedEnv: true }, null, 2);
}

function normalizeCommandTimeout(timeoutMs) {
  return Math.min(Math.max(Number(timeoutMs) || 30_000, 1_000), 120_000);
}

function getShellInvocation(commandText) {
  if (process.env.AGENT_SHELL) {
    return process.platform === "win32"
      ? { file: process.env.AGENT_SHELL, args: ["-NoProfile", "-Command", commandText] }
      : { file: process.env.AGENT_SHELL, args: ["-lc", commandText] };
  }
  if (process.platform === "win32") {
    return { file: "powershell.exe", args: ["-NoProfile", "-Command", commandText] };
  }
  return { file: "/bin/bash", args: ["-lc", commandText] };
}

function formatShellLabel(file) {
  return path.basename(String(file || "shell"));
}

function commandApprovalReason(highRisk, language) {
  return highRisk
    ? t(language, "tools.commandPendingHighRisk")
    : t(language, "tools.commandPendingNormal");
}

export async function approvePendingCommand(commandId, options = {}) {
  const language = normalizeLanguage(options.language);
  const pending = pendingCommands.get(commandId);
  if (!pending) throw localizedError(language, "tools.pendingCommandMissing");
  pendingCommands.delete(commandId);
  return executeCommandRecord(pending, options);
}

export async function executeCommandRecord(pending, options = {}) {
  let permissionState = getAutoApprovalState(pending);
  if (options.allowFuture) {
    permissionState = setScopedAutoApproval({
      ...pending,
      kind: "command",
      enabled: true
    });
  }
  const result = await executeCommand(pending.workspace, pending.command, pending.timeoutMs);
  return {
    ok: true,
    commandId: pending.id || pending.commandId,
    command: pending.command,
    result,
    cwd: pending.cwd,
    timeoutMs: pending.timeoutMs,
    shell: pending.shell,
    inheritedEnv: pending.inheritedEnv,
    highRisk: Boolean(pending.highRisk),
    autoApproveFutureCommands: permissionState.commandAutoApproval,
    commandAutoApproval: permissionState.commandAutoApproval,
    patchAutoApproval: permissionState.patchAutoApproval,
    fullAccessAutoApproval: permissionState.fullAccessAutoApproval,
    commandAutoApprovalExpiresAt: permissionState.commandAutoApprovalExpiresAt,
    patchAutoApprovalExpiresAt: permissionState.patchAutoApprovalExpiresAt
  };
}

export function discardPendingCommand(commandId) {
  const existed = pendingCommands.delete(commandId);
  return { ok: existed, commandId };
}

function isDangerousCommand(command) {
  const lowered = command.toLowerCase();
  return [
    /\bremove-item\b/,
    /(^|[;&|\s])rm\s+/,
    /(^|[;&|\s])sudo\s+/,
    /(^|[;&|\s])chmod\s+(-r\s+)?777\b/,
    /(^|[;&|\s])del\s+/,
    /(^|[;&|\s])erase\s+/,
    /(^|[;&|\s])rmdir\s+/,
    /(^|[;&|\s])format\s+/,
    /\bshutdown\b/,
    /\brestart-computer\b/,
    /\bstop-computer\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\b/,
    /\bgit\s+checkout\s+--\b/
  ].some((pattern) => pattern.test(lowered));
}

function isAutoAllowedCommand(command) {
  const lowered = command.trim().toLowerCase();
  if (/[;&|`<>]/.test(lowered)) return false;
  return [
    /^git\s+(status|diff|branch|log|show)(\s+[^\n]*)?$/,
    /^npm\s+run\s+typecheck(\s|$)/,
    /^npm\s+run\s+build(\s|$)/,
    /^npm\s+test(\s|$)/,
    /^node\s+--check(\s|$)/,
    /^pwd$/,
    /^cat\s+/,
    /^rg(\.exe)?\s+/,
    /^get-childitem(\s|$)/,
    /^dir(\s|$)/,
    /^ls(\s|$)/,
    /^get-content(\s|$)/,
    /^type\s+/,
    /^select-string(\s|$)/,
    /^findstr(\s|$)/
  ].some((pattern) => pattern.test(lowered));
}

function normalizeToolContext(context) {
  if (typeof context === "string") {
    return { workspace: context, requestId: "", sessionId: "", language: "zh", fullAccessAutoApproval: false, attachments: [] };
  }
  return {
    workspace: context?.workspace || process.cwd(),
    requestId: String(context?.requestId || ""),
    sessionId: String(context?.sessionId || ""),
    language: normalizeLanguage(context?.language),
    fullAccessAutoApproval: Boolean(context?.fullAccessAutoApproval),
    attachments: normalizeAttachmentPaths(context?.attachments)
  };
}

function resolveReadableFilePath(context, filePath) {
  const requestedPath = String(filePath ?? "");
  if (path.isAbsolute(requestedPath)) {
    const absolute = path.resolve(requestedPath);
    if (isAttachedPathAllowed(absolute, context.attachments)) return absolute;
  }
  return resolveInsideWorkspace(context.workspace, requestedPath, context.language);
}

function normalizeAttachmentPaths(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((file) => typeof file?.path === "string" ? normalizeComparablePath(file.path) : "")
    .filter(Boolean);
}

function isAttachedPathAllowed(absolutePath, attachmentPaths) {
  const comparable = normalizeComparablePath(absolutePath);
  return attachmentPaths.includes(comparable);
}

function normalizeComparablePath(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathSecurityOptions(language) {
  const normalized = normalizeLanguage(language);
  return {
    language: normalized,
    message: (key, values) => t(normalized, `tools.${key}`, values)
  };
}

export const __test__ = {
  isAutoAllowedCommand,
  isDangerousCommand
};
