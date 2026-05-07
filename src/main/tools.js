import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { normalizeLanguage, t } from "./i18n.js";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MAX_FILE_BYTES = 120_000;
const RIPGREP_COMMAND = process.platform === "win32" ? "rg.exe" : "rg";
const pendingPatches = new Map();
const pendingCommands = new Map();
const autoApprovalScopes = new Map();
const AUTO_APPROVAL_TTL_MS = 30 * 60 * 1000;

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "update_plan",
      description: "Update the visible execution plan before and during the task.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] }
              },
              required: ["step", "status"]
            }
          }
        },
        required: ["items"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in the current workspace. Use this before reading files when the target path is unknown.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Workspace-relative directory. Empty means workspace root." },
          max_files: { type: "number", description: "Maximum number of files to return, default 120." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file in the workspace. In default permission mode this produces a reviewable patch; in full access mode it writes immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path to create or overwrite." },
          content: { type: "string", description: "Complete file content." },
          summary: { type: "string", description: "Short summary shown to the user if approval is needed." }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file from the workspace. In default permission mode this produces a reviewable deletion patch; in full access mode it deletes immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path to delete." },
          summary: { type: "string", description: "Short summary shown to the user if approval is needed." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Ask the user a concise multiple-choice question when required information is missing or a decision is needed. Provide 2-6 clear options whenever possible.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to show to the user." },
          context: { type: "string", description: "Optional short context explaining why the answer is needed." },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Two to six user-facing options. Example: [\"Yes\", \"No\"]."
          }
        },
        required: ["question"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "Propose a unified diff patch. In default permission mode the user reviews it in the UI; in full access mode it is applied automatically.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Short human-readable summary of the intended change." },
          patch: {
            type: "string",
            description: "A complete unified diff, suitable for git apply, with paths relative to the workspace."
          }
        },
        required: ["patch"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search text files in the workspace for a plain text query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number", description: "Default 50." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current or external information. Use this when the user asks for latest/current facts, online information, documentation, news, prices, or anything not available in the workspace. Returns titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          max_results: { type: "number", description: "Default 5, maximum 10." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace and return stdout/stderr. Uses PowerShell on Windows and bash on macOS/Linux. High-risk or side-effecting commands require user approval unless future approvals were enabled.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeout_ms: { type: "number", description: "Default 30000, maximum 120000." }
        },
        required: ["command"]
      }
    }
  }
];

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
  switch (name) {
    case "list_files":
      return listFiles(workspace, args.directory || "", args.max_files || 120, context.language);
    case "read_file":
      return readFile(workspace, args.path, context.language);
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

async function webSearch(query, maxResults, language) {
  const searchQuery = String(query ?? "").trim();
  if (!searchQuery) throw localizedError(language, "tools.emptyQuery");
  const limit = Math.min(Math.max(Number(maxResults) || 5, 1), 10);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
  const { signal, cleanup } = createTimeoutSignal(20000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 AgentWindow/1.0",
        Accept: "text/html,application/xhtml+xml"
      },
      signal
    });
    if (!response.ok) {
      throw localizedError(language, "tools.searchFailed", { status: response.status, message: response.statusText });
    }
    const html = await response.text();
    const results = parseDuckDuckGoResults(html, limit);
    return JSON.stringify(
      {
        query: searchQuery,
        engine: "duckduckgo-html",
        results,
        note: "Search snippets may be incomplete. Open important URLs separately if precise source text is required."
      },
      null,
      2
    );
  } catch (error) {
    if (error?.name === "AbortError") throw localizedError(language, "tools.searchTimeout");
    throw error;
  } finally {
    cleanup();
  }
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

async function readFile(workspace, filePath, language) {
  const absolute = resolveInsideWorkspace(workspace, filePath, language);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw localizedError(language, "tools.notFile", { path: filePath });
  if (stat.size > MAX_FILE_BYTES) {
    throw localizedError(language, "tools.fileTooLarge", { path: filePath, size: stat.size, limit: MAX_FILE_BYTES });
  }
  return await fs.readFile(absolute, "utf8");
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
  const rgResults = await searchFilesWithRg(workspace, needle, maxResults, language).catch(() => null);
  if (rgResults) return rgResults;

  const filesJson = await listFiles(workspace, ".", 400);
  const files = JSON.parse(filesJson).files;
  const results = [];
  const limit = Math.min(Number(maxResults) || 50, 100);

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const content = await readFile(workspace, file, language);
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

async function proposePatch(context, patch, summary = "") {
  const workspace = context.workspace;
  const patchText = ensureTrailingNewline(stripMarkdownFence(String(patch ?? "")));
  if (!patchText.trim()) throw localizedError(context.language, "tools.emptyPatch");
  validatePatchPaths(workspace, patchText, context.language);
  const resolvedWorkspace = path.resolve(workspace);

  if (isAutoApprovalEnabled("patch", context)) {
    const result = await applyPatchText({
      id: randomUUID(),
      workspace: resolvedWorkspace,
      patch: patchText,
      summary: String(summary || "Proposed patch"),
      language: context.language
    });
    return JSON.stringify({
      ok: true,
      pending: false,
      applied: true,
      patchId: result.patchId,
      summary: result.summary,
      strategy: result.strategy,
      message: t(context.language, "tools.patchAppliedAuto")
    });
  }

  const patchId = randomUUID();
  pendingPatches.set(patchId, {
    id: patchId,
    workspace: resolvedWorkspace,
    requestId: context.requestId,
    sessionId: context.sessionId,
    patch: patchText,
    summary: String(summary || "Proposed patch"),
    language: context.language,
    createdAt: Date.now()
  });

  return JSON.stringify({
    ok: true,
    pending: true,
    patchId,
    summary: String(summary || "Proposed patch"),
    message: t(context.language, "tools.patchQueued")
  });
}

function stripMarkdownFence(value) {
  const text = String(value).trim();
  const fenced = text.match(/^```(?:diff|patch)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  return fenced ? fenced[1] : value;
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function getPendingPatch(patchId) {
  return pendingPatches.get(patchId) ?? null;
}

export async function applyPendingPatch(patchId, options = {}) {
  const language = normalizeLanguage(options.language);
  const pending = pendingPatches.get(patchId);
  if (!pending) throw localizedError(language, "tools.pendingPatchMissing");

  const result = await applyPatchText(pending);
  pendingPatches.delete(patchId);
  return result;
}

export function discardPendingPatch(patchId) {
  const existed = pendingPatches.delete(patchId);
  return { ok: existed, patchId };
}

async function runCommand(context, command, timeoutMs) {
  const workspace = context.workspace;
  const commandText = String(command ?? "").trim();
  if (!commandText) throw localizedError(context.language, "tools.emptyCommand");
  const highRisk = isDangerousCommand(commandText);
  if (!isAutoApprovalEnabled("command", context) && (highRisk || !isAutoAllowedCommand(commandText))) {
    const commandId = randomUUID();
    pendingCommands.set(commandId, {
      id: commandId,
      workspace: path.resolve(workspace),
      requestId: context.requestId,
      sessionId: context.sessionId,
      command: commandText,
      highRisk,
      timeoutMs,
      language: context.language,
      createdAt: Date.now()
    });
    return JSON.stringify({
      ok: true,
      pending: true,
      commandId,
      command: commandText,
      highRisk,
      risk: highRisk ? "high" : "normal",
      message: t(context.language, "tools.commandQueued")
    });
  }

  return executeCommand(workspace, commandText, timeoutMs);
}

async function executeCommand(workspace, commandText, timeoutMs) {
  const timeout = Math.min(Math.max(Number(timeoutMs) || 30_000, 1_000), 120_000);
  const { file, args } = getShellInvocation(commandText);
  const { stdout, stderr } = await execFileAsync(file, args, {
    cwd: workspace,
    timeout,
    windowsHide: true,
    maxBuffer: 1_000_000
  });

  return JSON.stringify({ stdout, stderr }, null, 2);
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

export async function approvePendingCommand(commandId, options = {}) {
  const language = normalizeLanguage(options.language);
  const pending = pendingCommands.get(commandId);
  if (!pending) throw localizedError(language, "tools.pendingCommandMissing");
  pendingCommands.delete(commandId);
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
    commandId,
    command: pending.command,
    result,
    highRisk: Boolean(pending.highRisk),
    autoApproveFutureCommands: permissionState.commandAutoApproval,
    commandAutoApproval: permissionState.commandAutoApproval,
    patchAutoApproval: permissionState.patchAutoApproval,
    commandAutoApprovalExpiresAt: permissionState.commandAutoApprovalExpiresAt,
    patchAutoApprovalExpiresAt: permissionState.patchAutoApprovalExpiresAt
  };
}

export function discardPendingCommand(commandId) {
  const existed = pendingCommands.delete(commandId);
  return { ok: existed, commandId };
}

export function setCommandAutoApproval(payload) {
  const context = normalizeApprovalPayload(payload, "command");
  return setScopedAutoApproval(context);
}

export function setPatchAutoApproval(payload) {
  const context = normalizeApprovalPayload(payload, "patch");
  return setScopedAutoApproval(context);
}

async function applyPatchText(pending) {
  validatePatchPaths(pending.workspace, pending.patch, pending.language);
  const tempPath = path.join(os.tmpdir(), `agent-window-${pending.id}.diff`);

  try {
    await fs.writeFile(tempPath, pending.patch, "utf8");
    await runGitApply(pending.workspace, ["apply", "--check", "--recount", "--whitespace=nowarn", tempPath], pending.language);
    await runGitApply(pending.workspace, ["apply", "--recount", "--whitespace=nowarn", tempPath], pending.language);
    return {
      ok: true,
      patchId: pending.id,
      summary: pending.summary,
      strategy: "git apply --recount"
    };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

function resolveInsideWorkspace(workspace, targetPath, language) {
  if (!workspace) throw localizedError(language, "tools.missingWorkspace");
  const absoluteWorkspace = path.resolve(workspace);
  const absoluteTarget = path.resolve(absoluteWorkspace, String(targetPath || "."));
  const relative = path.relative(absoluteWorkspace, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw localizedError(language, "tools.outsideWorkspace", { path: targetPath });
  }
  return absoluteTarget;
}

function normalizeWorkspacePath(filePath, language) {
  const normalized = String(filePath ?? "").replaceAll("\\", "/").trim();
  if (!normalized) throw localizedError(language, "tools.emptyPath");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw localizedError(language, "tools.unsafePath", { path: filePath });
  }
  return normalized;
}

function buildWholeFilePatch(filePath, previousContent, nextContent) {
  const oldLines = previousContent === null ? [] : splitDiffLines(previousContent);
  const newLines = nextContent === null ? [] : splitDiffLines(nextContent);
  const oldPath = previousContent === null ? "/dev/null" : `a/${filePath}`;
  const newPath = nextContent === null ? "/dev/null" : `b/${filePath}`;
  const lines = [`diff --git a/${filePath} b/${filePath}`];

  if (previousContent === null) lines.push("new file mode 100644");
  if (nextContent === null) lines.push("deleted file mode 100644");
  lines.push(`--- ${oldPath}`);
  lines.push(`+++ ${newPath}`);

  if (oldLines.length > 0 || newLines.length > 0) {
    lines.push(`@@ -${formatDiffRange(oldLines.length)} +${formatDiffRange(newLines.length)} @@`);
    for (const line of oldLines) lines.push(`-${line}`);
    for (const line of newLines) lines.push(`+${line}`);
  }

  return `${lines.join("\n")}\n`;
}

function splitDiffLines(content) {
  if (content === "") return [];
  const normalized = ensureTrailingNewline(String(content));
  return normalized.slice(0, -1).split("\n");
}

function formatDiffRange(count) {
  return count > 0 ? `1,${count}` : "0,0";
}

function validatePatchPaths(workspace, patchText, language) {
  const paths = extractPatchPaths(patchText, language);
  if (paths.length === 0) {
    throw localizedError(language, "tools.invalidPatch");
  }

  for (const filePath of paths) {
    resolveInsideWorkspace(workspace, filePath, language);
  }
}

function extractPatchPaths(patchText, language = "zh") {
  const paths = new Set();
  for (const line of patchText.split(/\r?\n/)) {
    const gitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitMatch) {
      addPatchPath(paths, gitMatch[1], language);
      addPatchPath(paths, gitMatch[2], language);
      continue;
    }

    const fileMatch = line.match(/^(---|\+\+\+) (.+)$/);
    if (fileMatch) {
      addPatchPath(paths, normalizeDiffPath(fileMatch[2]), language);
    }
  }
  return [...paths];
}

function normalizeDiffPath(rawPath) {
  const clean = String(rawPath).split("\t")[0].trim();
  if (clean === "/dev/null") return "";
  if (clean.startsWith("a/") || clean.startsWith("b/")) return clean.slice(2);
  return clean;
}

function addPatchPath(paths, filePath, language) {
  const normalized = normalizeDiffPath(filePath).replaceAll("\\", "/");
  if (!normalized) return;
  if (normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || normalized.startsWith("../")) {
    throw localizedError(language, "tools.unsafePatchPath", { path: filePath });
  }
  paths.add(normalized);
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

async function searchFilesWithRg(workspace, needle, maxResults, language) {
  const limit = Math.min(Number(maxResults) || 50, 100);
  const results = [];
  let stdout = "";

  try {
    ({ stdout } = await execFileAsync(
      RIPGREP_COMMAND,
      [
        "--line-number",
        "--no-heading",
        "--fixed-strings",
        "--color=never",
        "--glob",
        "!{.git,node_modules,dist,build,.next,.vite,coverage}/**",
        needle,
        "."
      ],
      {
        cwd: resolveInsideWorkspace(workspace, ".", language),
        windowsHide: true,
        maxBuffer: 1_000_000
      }
    ));
  } catch (error) {
    if (error?.code === 1) {
      return JSON.stringify({ results: [], truncated: false, engine: RIPGREP_COMMAND }, null, 2);
    }
    throw error;
  }

  for (const line of stdout.split(/\r?\n/)) {
    if (!line || results.length >= limit) break;
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    results.push({
      file: match[1].replaceAll("\\", "/"),
      line: Number(match[2]),
      text: match[3].slice(0, 240)
    });
  }

  return JSON.stringify({ results, truncated: results.length >= limit, engine: RIPGREP_COMMAND }, null, 2);
}

function parseDuckDuckGoResults(html, limit) {
  const results = [];
  const blocks = String(html).split(/<div class="result results_links[\s\S]*?result__body">/g).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    if (block.includes("result--ad")) continue;

    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const displayUrlMatch = block.match(/<a[^>]*class="result__url"[^>]*>([\s\S]*?)<\/a>/i);

    const targetUrl = normalizeSearchUrl(decodeHtml(titleMatch[1]));
    if (!targetUrl) continue;
    results.push({
      title: cleanHtmlText(titleMatch[2]),
      url: targetUrl,
      displayUrl: displayUrlMatch ? cleanHtmlText(displayUrlMatch[1]) : "",
      snippet: snippetMatch ? cleanHtmlText(snippetMatch[1]) : ""
    });
  }
  return results;
}

function normalizeSearchUrl(rawUrl) {
  let value = String(rawUrl || "").replaceAll("&amp;", "&").trim();
  if (value.startsWith("//duckduckgo.com/l/?")) value = `https:${value}`;
  if (value.startsWith("/l/?")) value = `https://duckduckgo.com${value}`;
  try {
    const parsed = new URL(value);
    const redirected = parsed.searchParams.get("uddg");
    if (redirected) return decodeURIComponent(redirected);
    return parsed.href;
  } catch {
    return "";
  }
}

function cleanHtmlText(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout)
  };
}

async function runGitApply(workspace, args, language = "zh") {
  try {
    return await execFileAsync("git", args, {
      cwd: workspace,
      windowsHide: true,
      maxBuffer: 1_000_000
    });
  } catch (error) {
    const detail = [error?.message, error?.stderr, error?.stdout].filter(Boolean).join("\n").trim();
    throw new Error(detail || t(language, "tools.gitApplyFailed"));
  }
}

function normalizeToolContext(context) {
  if (typeof context === "string") {
    return { workspace: context, requestId: "", sessionId: "" };
  }
  return {
    workspace: context?.workspace || process.cwd(),
    requestId: String(context?.requestId || ""),
    sessionId: String(context?.sessionId || ""),
    language: normalizeLanguage(context?.language)
  };
}

function normalizeApprovalPayload(payload, kind) {
  if (typeof payload === "boolean") {
    return { workspace: process.cwd(), requestId: "", sessionId: "", kind, enabled: payload };
  }
  return {
    workspace: payload?.workspace || process.cwd(),
    requestId: String(payload?.requestId || ""),
    sessionId: String(payload?.sessionId || ""),
    kind,
    enabled: Boolean(payload?.enabled)
  };
}

function localizedError(language, key, values = {}) {
  const error = new Error(t(language, key, values));
  error.language = normalizeLanguage(language);
  return error;
}

function permissionScopeKey(context) {
  const workspace = path.resolve(context.workspace || process.cwd());
  const session = String(context.sessionId || "workspace");
  return `${workspace}::${session}`;
}

function getAutoApprovalState(context) {
  const key = permissionScopeKey(context);
  const now = Date.now();
  const state = autoApprovalScopes.get(key) || {};
  const commandAutoApproval = Number(state.commandExpiresAt || 0) > now;
  const patchAutoApproval = Number(state.patchExpiresAt || 0) > now;
  if (!commandAutoApproval && !patchAutoApproval && autoApprovalScopes.has(key)) {
    autoApprovalScopes.delete(key);
  }
  return {
    ok: true,
    scope: {
      workspace: path.resolve(context.workspace || process.cwd()),
      sessionId: String(context.sessionId || "")
    },
    commandAutoApproval,
    patchAutoApproval,
    autoApproveFutureCommands: commandAutoApproval,
    commandAutoApprovalExpiresAt: commandAutoApproval ? state.commandExpiresAt : null,
    patchAutoApprovalExpiresAt: patchAutoApproval ? state.patchExpiresAt : null,
    ttlMs: AUTO_APPROVAL_TTL_MS
  };
}

function setScopedAutoApproval(context) {
  const key = permissionScopeKey(context);
  const now = Date.now();
  const expiresAt = now + AUTO_APPROVAL_TTL_MS;
  const current = autoApprovalScopes.get(key) || {};
  const next = { ...current };
  if (context.kind === "command") {
    next.commandExpiresAt = context.enabled ? expiresAt : 0;
  }
  if (context.kind === "patch") {
    next.patchExpiresAt = context.enabled ? expiresAt : 0;
  }
  autoApprovalScopes.set(key, next);
  return getAutoApprovalState(context);
}

function isAutoApprovalEnabled(kind, context) {
  const state = getAutoApprovalState(context);
  return kind === "command" ? state.commandAutoApproval : state.patchAutoApproval;
}

export const __test__ = {
  addPatchPath,
  buildWholeFilePatch,
  extractPatchPaths,
  isAutoAllowedCommand,
  isDangerousCommand,
  normalizeWorkspacePath,
  resolveInsideWorkspace,
  validatePatchPaths,
  permissionScopeKey,
  setScopedAutoApproval,
  getAutoApprovalState
};
