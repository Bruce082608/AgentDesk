import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
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
const MAX_RANGE_FILE_BYTES = 2_000_000;
const MAX_READ_FILES = 20;
const MAX_COMMAND_SESSION_BUFFER = 500_000;
const MAX_COMMAND_SESSIONS = 20;
const MAX_INLINE_RESULT_CHARS = 60_000;
const DEFAULT_RESULT_CHUNK_CHARS = 40_000;
const MAX_RESULT_CHUNK_CHARS = 120_000;
const MAX_STORED_RESULTS = 40;
const MAX_BROWSER_SESSIONS = 8;
const pendingCommands = new Map();
const commandSessions = new Map();
const storedResults = new Map();
const browserSessions = new Map();

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
      return listFiles(context, args.directory || "", args.max_files || 120);
    case "read_file":
      return readFile(context, args.path);
    case "read_files":
      return readFiles(context, args.paths, args.max_chars, args.per_file_max_chars);
    case "read_file_range":
      return readFileRange(context, args.path, args.start_line, args.end_line);
    case "read_result_chunk":
      return readResultChunk(args.result_id || args.resultId, args.offset, args.max_chars, context.language);
    case "write_file":
      return writeFile(context, args.path, args.content, args.summary);
    case "replace_text":
      return replaceText(context, args);
    case "delete_file":
      return deleteFile(context, args.path, args.summary);
    case "ask_user":
      return askUser(args.question, args.context, args.options, context.language);
    case "apply_patch":
      return proposePatch(context, args.patch, args.summary);
    case "search_files":
      return searchFiles(workspace, args.query, args.max_results || 50, context.language);
    case "web_search":
      return webSearch(args.query, args.max_results || 5, context.language, {
        fetchPages: args.fetch_pages !== false,
        maxFetchPages: args.max_fetch_pages
      });
    case "browser_page":
      return browserPage(context, args);
    case "workspace_map":
      return workspaceMap(context, args);
    case "run_command":
      return runCommand(context, args.command, args.timeout_ms || 30_000);
    case "start_command":
      return startCommand(context, args.command, args.cwd);
    case "read_command_output":
      return readCommandOutput(args.session_id, args.output_offset, args.max_chars, context.language);
    case "stop_command":
      return stopCommand(args.session_id, context.language);
    case "update_plan":
      return JSON.stringify({ ok: true, items: Array.isArray(args.items) ? args.items : [] });
    default:
      throw localizedError(context.language, "tools.unknownTool", { name });
  }
}

function formatToolSuccess(name, result) {
  const parsed = parseJsonResult(result);
  let payload;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    payload = { ok: parsed.ok !== false, tool: name, ...parsed };
  } else {
    payload = { ok: true, tool: name, result: String(result ?? "") };
  }
  return JSON.stringify(storeLargeResultIfNeeded(name, payload), null, 2);
}

function formatToolFailure(name, error, args, fallbackLanguage = "zh") {
  const classified = classifyToolError(error);
  const language = normalizeLanguage(error?.language || fallbackLanguage);
  const diagnostics = buildFailureDiagnostics(name, classified, args, language);
  return JSON.stringify(
    {
      ok: false,
      tool: name || "unknown",
      error: t(language, `tools.toolErrors.${classified.type}`),
      errorType: classified.type,
      detail: [classified.message, classified.detail].filter(Boolean).join("\n").trim(),
      ...diagnostics,
      recoverable: classified.recoverable,
      args: sanitizeArgsForError(args)
    },
    null,
    2
  );
}

function buildFailureDiagnostics(name, classified, args, language) {
  const zh = language === "zh";
  const detail = `${classified.message}\n${classified.detail || ""}`;
  const lower = detail.toLowerCase();
  const steps = [];
  const suspectFiles = extractLikelyFilePaths(detail);

  if (name === "apply_patch" || /git apply|patch hunk|hunk/i.test(detail)) {
    const patchTargets = extractLikelyPatchTargets(args?.patch);
    const targets = patchTargets.length ? patchTargets : suspectFiles;
    steps.push(zh
      ? "先用 read_file_range 读取失败文件附近的最新内容，再用更长上下文重新生成补丁。"
      : "Read the latest nearby lines with read_file_range, then regenerate the patch with more context.");
    if (targets[0]) {
      steps.push(zh
        ? `建议调用 read_file_range：path=${targets[0]}，覆盖目标 hunk 附近 80-160 行。`
        : `Suggested read_file_range call: path=${targets[0]}, covering 80-160 lines around the target hunk.`);
    }
  } else if (name === "replace_text") {
    steps.push(zh
      ? "用 search_files 查找 old_text 的实际位置，或用 read_file_range 读取目标片段后扩大 old_text 上下文。"
      : "Use search_files to locate old_text, or read the target range and widen old_text context.");
  } else if (name === "run_command" || name === "start_command") {
    if (/command not found|not recognized|enoent|找不到命令|不是内部或外部命令/.test(lower)) {
      steps.push(zh
        ? "命令不存在时先调用 workspace_map 或读取 package.json scripts，优先使用项目已有 npm scripts。"
        : "When a command is missing, call workspace_map or read package.json scripts, then prefer existing npm scripts.");
    }
    if (/failed|fail|error|vitest|jest|pytest|tsc|vite|test/i.test(detail)) {
      steps.push(zh
        ? "测试/构建失败时，优先读取 stderr 中出现的文件，并用 search_files 定位失败用例或报错符号。"
        : "For test/build failures, read files mentioned in stderr and use search_files to locate the failing test or symbol.");
    }
  } else if (name === "browser_page") {
    if (/playwright|browser executable|install/i.test(detail)) {
      steps.push(zh
        ? "如果浏览器运行时缺失，运行 npx playwright install chromium 后重试。"
        : "If the browser runtime is missing, run npx playwright install chromium and retry.");
    } else {
      steps.push(zh
        ? "先确认页面 URL 可访问；若是本地应用，使用 start_command 启动 dev server 后再打开。"
        : "Confirm the URL is reachable; for local apps, start the dev server with start_command before opening it.");
    }
  }

  if (classified.type === "file_not_found" || classified.type === "path_security") {
    steps.push(zh
      ? "调用 workspace_map 或 list_files 确认真实路径；full access 模式下可以使用绝对路径。"
      : "Call workspace_map or list_files to confirm the real path; full access mode can use absolute paths.");
  }

  return {
    diagnosis: classifyFailureDiagnosis(name, classified, detail, language),
    suggestedNextSteps: [...new Set(steps)].slice(0, 4),
    suspectFiles: suspectFiles.slice(0, 8)
  };
}

function classifyFailureDiagnosis(name, classified, detail, language) {
  const zh = language === "zh";
  const lower = detail.toLowerCase();
  if (name === "apply_patch" || /git apply|patch hunk|hunk/i.test(detail)) {
    return zh ? "补丁上下文与当前文件不匹配，或 hunk 行号/上下文已过期。" : "Patch context likely does not match the current file, or hunk line numbers/context are stale.";
  }
  if ((name === "run_command" || name === "start_command") && /command not found|not recognized|enoent|找不到命令|不是内部或外部命令/.test(lower)) {
    return zh ? "命令在当前 shell 中不可用，可能应使用 package.json scripts 或先安装依赖。" : "The command is unavailable in the current shell; use package.json scripts or install dependencies first.";
  }
  if ((name === "run_command" || name === "start_command") && /failed|fail|error|vitest|jest|pytest|tsc|vite|test/i.test(detail)) {
    return zh ? "命令已经运行，但测试/构建/脚本返回失败，需要根据 stderr 定位具体文件。" : "The command ran but a test/build/script failed; locate the concrete file from stderr.";
  }
  return zh ? "工具调用失败，但通常可以通过读取更多上下文或换一个工具恢复。" : "The tool failed, but it is usually recoverable by reading more context or switching tools.";
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

function storeLargeResultIfNeeded(tool, payload) {
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized.length <= MAX_INLINE_RESULT_CHARS) return payload;

  pruneStoredResults();
  const resultId = randomUUID();
  const now = Date.now();
  storedResults.set(resultId, {
    id: resultId,
    tool,
    content: serialized,
    createdAt: now,
    updatedAt: now
  });

  const chunk = serialized.slice(0, MAX_INLINE_RESULT_CHARS);
  return {
    ok: payload?.ok !== false,
    tool,
    paginated: true,
    resultId,
    result_id: resultId,
    totalChars: serialized.length,
    returnedChars: chunk.length,
    nextOffset: chunk.length,
    hasMore: chunk.length < serialized.length,
    chunk,
    message: "Tool result was large, so only the first chunk is included. Use read_result_chunk with result_id and nextOffset to continue."
  };
}

function readResultChunk(resultId, offset, maxChars, language) {
  const id = String(resultId || "").trim();
  const entry = storedResults.get(id);
  if (!entry) throw localizedError(language, "tools.resultMissing", { id });
  const start = Math.min(Math.max(Number(offset) || 0, 0), entry.content.length);
  const limit = Math.min(Math.max(Number(maxChars) || DEFAULT_RESULT_CHUNK_CHARS, 1_000), MAX_RESULT_CHUNK_CHARS);
  const chunk = entry.content.slice(start, start + limit);
  const nextOffset = start + chunk.length;
  entry.updatedAt = Date.now();
  return JSON.stringify({
    resultId: id,
    result_id: id,
    sourceTool: entry.tool,
    offset: start,
    returnedChars: chunk.length,
    nextOffset,
    totalChars: entry.content.length,
    hasMore: nextOffset < entry.content.length,
    chunk
  }, null, 2);
}

function pruneStoredResults() {
  if (storedResults.size < MAX_STORED_RESULTS) return;
  const oldest = [...storedResults.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  while (storedResults.size >= MAX_STORED_RESULTS && oldest.length > 0) {
    storedResults.delete(oldest.shift().id);
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

function extractLikelyPatchTargets(patch) {
  const text = String(patch || "");
  const targets = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("diff --git ")) continue;
    const matches = line.matchAll(/(?:^|\s)(?:a\/|b\/)?([^ \t\n]+?\.(?:[cm]?[jt]sx?|json|css|scss|html|md|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|txt|yml|yaml))(?:\s|$)/g);
    for (const match of matches) {
      const file = cleanDiagnosticPath(match[1]);
      if (file && file !== "/dev/null" && !targets.includes(file)) targets.push(file);
    }
  }
  return targets;
}

function extractLikelyFilePaths(text) {
  const candidates = [];
  const patterns = [
    /(?:^|\s|["'(`])((?:[A-Za-z]:\\|\/|\.{0,2}\/)?[\w .@~/-]+\.(?:[cm]?[jt]sx?|json|css|scss|html|md|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|txt|yml|yaml))(?::\d+)?/g,
    /(?:at\s+|File\s+["'])([^"'\n]+\.(?:[cm]?[jt]sx?|json|css|scss|html|md|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|txt|yml|yaml))(?::\d+)?/g
  ];
  for (const pattern of patterns) {
    for (const match of String(text || "").matchAll(pattern)) {
      const file = cleanDiagnosticPath(match[1]);
      if (file && !candidates.includes(file)) candidates.push(file);
    }
  }
  return candidates;
}

function cleanDiagnosticPath(value) {
  return String(value || "")
    .replace(/^["'(`]+|["'`),.;]+$/g, "")
    .replace(/^(?:a|b)\//, "")
    .trim();
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

async function listFiles(context, directory, maxFiles) {
  const workspace = context.workspace;
  const root = resolveDirectoryPath(context, directory || ".");
  const workspaceRoot = path.resolve(workspace);
  const requestedDirectory = String(directory ?? "").trim();
  const useAbsoluteOutput = isFullAccess(context) && (path.isAbsolute(expandHomePath(requestedDirectory)) || isOutsideWorkspace(workspaceRoot, root));
  const limit = Math.min(Number(maxFiles) || 120, 500);
  const files = [];

  async function walk(current) {
    if (files.length >= limit) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(workspaceRoot, absolute).replaceAll("\\", "/");
      const displayPath = useAbsoluteOutput ? absolute : relative;
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(displayPath);
      }
    }
  }

  await walk(root);
  return JSON.stringify({ files, truncated: files.length >= limit }, null, 2);
}

async function readFile(context, filePath) {
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

async function readFiles(context, paths, maxChars, perFileMaxChars) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw localizedError(context.language, "tools.emptyPath");
  }
  const selectedPaths = paths.slice(0, MAX_READ_FILES).map((item) => String(item ?? ""));
  const totalLimit = Math.min(Math.max(Number(maxChars) || 60_000, 1_000), 200_000);
  const fileLimit = Math.min(Math.max(Number(perFileMaxChars) || 40_000, 500), MAX_FILE_BYTES);
  let remaining = totalLimit;
  const files = [];

  for (const filePath of selectedPaths) {
    if (remaining <= 0) {
      files.push({
        path: filePath,
        ok: false,
        error: "Total read_files content budget exhausted.",
        errorType: "content_budget_exhausted"
      });
      continue;
    }

    try {
      const content = await readFile(context, filePath);
      const text = String(content ?? "");
      const limit = Math.min(fileLimit, remaining);
      const excerpt = text.slice(0, limit);
      remaining -= excerpt.length;
      files.push({
        path: filePath,
        ok: true,
        content: excerpt,
        chars: text.length,
        returnedChars: excerpt.length,
        truncated: excerpt.length < text.length
      });
    } catch (error) {
      const classified = classifyToolError(error);
      files.push({
        path: filePath,
        ok: false,
        error: classified.message,
        errorType: classified.type,
        detail: classified.detail
      });
    }
  }

  return JSON.stringify({
    files,
    requested: paths.length,
    processed: selectedPaths.length,
    truncated: paths.length > selectedPaths.length || files.some((file) => file.truncated || file.errorType === "content_budget_exhausted"),
    maxChars: totalLimit,
    remainingChars: remaining
  }, null, 2);
}

async function readFileRange(context, filePath, startLine, endLine) {
  const language = context.language;
  const requestedPath = String(filePath ?? "");
  if (isPdfExtension(requestedPath)) {
    throw localizedError(language, "tools.rangePdfUnsupported", { path: requestedPath });
  }

  const absolute = resolveReadableFilePath(context, requestedPath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw localizedError(language, "tools.notFile", { path: requestedPath });
  if (stat.size > MAX_RANGE_FILE_BYTES) {
    throw localizedError(language, "tools.fileTooLarge", {
      path: requestedPath,
      size: stat.size,
      limit: MAX_RANGE_FILE_BYTES
    });
  }

  const buffer = await fs.readFile(absolute);
  if (looksBinaryBuffer(buffer)) {
    throw localizedError(language, "tools.binaryFile", { path: requestedPath });
  }

  const lines = buffer.toString("utf8").split(/\r?\n/);
  const totalLines = lines.length;
  const start = Math.min(Math.max(Math.floor(Number(startLine) || 1), 1), Math.max(totalLines, 1));
  const requestedEnd = Number.isFinite(Number(endLine)) ? Math.floor(Number(endLine)) : start + 199;
  const end = Math.min(Math.max(requestedEnd, start), start + 999, totalLines);
  const selected = lines.slice(start - 1, end);

  return JSON.stringify({
    path: requestedPath,
    startLine: start,
    endLine: end,
    totalLines,
    content: selected.join("\n"),
    hasMoreBefore: start > 1,
    hasMoreAfter: end < totalLines
  }, null, 2);
}

function formatToolBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function writeFile(context, filePath, content, summary = "") {
  const { absolute, displayPath } = resolveMutableFilePath(context, filePath);
  const nextContent = String(content ?? "");
  if (Buffer.byteLength(nextContent, "utf8") > MAX_FILE_BYTES * 2) {
    throw localizedError(context.language, "tools.contentTooLarge", { path: displayPath, limit: MAX_FILE_BYTES * 2 });
  }

  if (isAutoApprovalEnabled("patch", context)) {
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, nextContent, "utf8");
    return JSON.stringify({ ok: true, written: true, path: displayPath, absolutePath: absolute, bytes: Buffer.byteLength(nextContent, "utf8") }, null, 2);
  }

  const previousContent = await fs.readFile(absolute, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const patch = buildWholeFilePatch(displayPath, previousContent, nextContent);
  const result = JSON.parse(await proposePatch(context, patch, summary || `${previousContent === null ? "Create" : "Update"} ${displayPath}`));
  return JSON.stringify({ ...result, patch }, null, 2);
}

async function deleteFile(context, filePath, summary = "") {
  const { absolute, displayPath } = resolveMutableFilePath(context, filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw localizedError(context.language, "tools.notFile", { path: displayPath });

  if (isAutoApprovalEnabled("patch", context)) {
    await fs.rm(absolute, { force: true });
    return JSON.stringify({ ok: true, deleted: true, path: displayPath, absolutePath: absolute }, null, 2);
  }

  const previousContent = await fs.readFile(absolute, "utf8");
  const patch = buildWholeFilePatch(displayPath, previousContent, null);
  const result = JSON.parse(await proposePatch(context, patch, summary || `Delete ${displayPath}`));
  return JSON.stringify({ ...result, patch }, null, 2);
}

async function replaceText(context, args = {}) {
  const { absolute, displayPath } = resolveMutableFilePath(context, args.path);
  const oldText = String(args.old_text ?? "");
  const newText = String(args.new_text ?? "");
  if (!oldText) throw localizedError(context.language, "tools.emptyOldText");

  const buffer = await fs.readFile(absolute);
  if (looksBinaryBuffer(buffer)) {
    throw localizedError(context.language, "tools.binaryFile", { path: displayPath });
  }

  const previousContent = buffer.toString("utf8");
  const matches = countOccurrences(previousContent, oldText);
  const replaceAll = Boolean(args.replace_all);
  const expectedReplacements = Number.isFinite(Number(args.expected_replacements))
    ? Math.max(0, Math.floor(Number(args.expected_replacements)))
    : (replaceAll ? matches : 1);
  if (matches === 0) throw localizedError(context.language, "tools.replaceTextMissing", { path: displayPath });
  if (!replaceAll && matches !== 1 && !Number.isFinite(Number(args.expected_replacements))) {
    throw localizedError(context.language, "tools.replaceTextAmbiguous", { path: displayPath, count: matches });
  }
  if (matches !== expectedReplacements) {
    throw localizedError(context.language, "tools.replaceTextCountMismatch", {
      path: displayPath,
      count: matches,
      expected: expectedReplacements
    });
  }

  const nextContent = replaceAll
    ? previousContent.split(oldText).join(newText)
    : previousContent.replace(oldText, newText);
  if (nextContent === previousContent) {
    return JSON.stringify({ ok: true, changed: false, path: displayPath, replacements: 0 }, null, 2);
  }

  if (isAutoApprovalEnabled("patch", context)) {
    await fs.writeFile(absolute, nextContent, "utf8");
    return JSON.stringify({
      ok: true,
      changed: true,
      written: true,
      path: displayPath,
      absolutePath: absolute,
      replacements: replaceAll ? matches : 1,
      bytes: Buffer.byteLength(nextContent, "utf8")
    }, null, 2);
  }

  const patch = buildWholeFilePatch(displayPath, previousContent, nextContent);
  const summary = String(args.summary || `Replace text in ${displayPath}`);
  const result = JSON.parse(await proposePatch(context, patch, summary));
  return JSON.stringify({ ...result, patch, replacements: replaceAll ? matches : 1 }, null, 2);
}

function countOccurrences(content, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index <= content.length) {
    const foundAt = content.indexOf(needle, index);
    if (foundAt === -1) break;
    count += 1;
    index = foundAt + needle.length;
  }
  return count;
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

  const filesJson = await listFiles({ workspace, language, fullAccessAutoApproval: false, attachments: [] }, ".", 400);
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

async function workspaceMap(context, args = {}) {
  const root = resolveInsideWorkspace(context.workspace, ".", context.language);
  const includeFiles = args.include_files !== false;
  const maxFiles = Math.min(Math.max(Number(args.max_files) || 80, 10), 200);
  const packageJson = await readJsonIfExists(path.join(root, "package.json"));
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const dependencies = {
    ...objectKeys(packageJson?.dependencies),
    ...objectKeys(packageJson?.devDependencies)
  };
  const frameworks = detectFrameworks(dependencies, root);
  const configFiles = await findExistingWorkspaceFiles(root, [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "electron-builder.json",
    "README.md",
    "src/main/main.js",
    "src/renderer/App.tsx",
    "src/renderer/App.jsx",
    "src/App.tsx",
    "src/App.jsx",
    "index.html"
  ]);
  const entryFiles = await findExistingWorkspaceFiles(root, [
    "src/main/main.js",
    "src/main/main.ts",
    "src/main/index.js",
    "src/main/index.ts",
    "src/renderer/App.tsx",
    "src/renderer/App.jsx",
    "src/App.tsx",
    "src/App.jsx",
    "src/main.tsx",
    "src/main.jsx",
    "src/index.tsx",
    "src/index.jsx",
    "main.js",
    "index.js",
    "index.html"
  ]);
  const directories = await listTopLevelDirectories(root);
  const files = includeFiles ? await sampleWorkspaceFiles(root, maxFiles) : [];
  const git = await getWorkspaceGitMap(root);

  return JSON.stringify({
    workspace: root,
    package: packageJson ? {
      name: packageJson.name || "",
      version: packageJson.version || "",
      private: Boolean(packageJson.private),
      type: packageJson.type || "",
      scripts
    } : null,
    frameworks,
    configFiles,
    entryFiles,
    directories,
    files,
    git,
    suggestedCommands: suggestWorkspaceCommands(scripts)
  }, null, 2);
}

function objectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(value).map((key) => [key, true]));
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function detectFrameworks(dependencies, root) {
  const frameworks = [];
  const has = (name) => Boolean(dependencies[name]);
  if (has("electron")) frameworks.push("Electron");
  if (has("react")) frameworks.push("React");
  if (has("vite") || has("@vitejs/plugin-react")) frameworks.push("Vite");
  if (has("next")) frameworks.push("Next.js");
  if (has("typescript")) frameworks.push("TypeScript");
  if (has("vitest")) frameworks.push("Vitest");
  if (has("jest")) frameworks.push("Jest");
  if (has("playwright") || has("@playwright/test")) frameworks.push("Playwright");
  if (root.toLowerCase().includes("electron") && !frameworks.includes("Electron")) frameworks.push("Electron");
  return frameworks;
}

async function findExistingWorkspaceFiles(root, candidates) {
  const found = [];
  for (const candidate of candidates) {
    const absolute = path.join(root, candidate);
    const stat = await fs.stat(absolute).catch(() => null);
    if (stat?.isFile()) found.push(candidate);
  }
  return found;
}

async function listTopLevelDirectories(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function sampleWorkspaceFiles(root, maxFiles) {
  const files = [];
  async function walk(current, depth) {
    if (files.length >= maxFiles || depth > 3) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        files.push(`${relative}/`);
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  await walk(root, 0);
  return files;
}

async function getWorkspaceGitMap(root) {
  const branch = await runGitCommand(root, ["branch", "--show-current"]).catch(() => "");
  const statusText = await runGitCommand(root, ["status", "--short"]).catch(() => "");
  const recentCommits = await runGitCommand(root, ["log", "-5", "--oneline"]).catch(() => "");
  return {
    branch: branch.trim(),
    changedFiles: statusText.split(/\r?\n/).filter(Boolean).map((line) => ({
      status: line.slice(0, 2).trim() || "?",
      path: line.slice(3).trim()
    })),
    recentCommits: recentCommits.split(/\r?\n/).filter(Boolean)
  };
}

async function runGitCommand(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1_000_000
  });
  return stdout;
}

function suggestWorkspaceCommands(scripts) {
  const names = new Set(Object.keys(scripts || {}));
  const commands = [];
  for (const name of ["test", "typecheck", "lint", "build", "dev"]) {
    if (names.has(name)) commands.push(`npm run ${name}`);
  }
  if (names.has("test")) commands.unshift("npm test");
  return [...new Set(commands)];
}

async function browserPage(context, args = {}) {
  const action = String(args.action || (args.url ? "open" : "screenshot")).toLowerCase();
  if (action === "open") return openBrowserPage(context, args);
  if (action === "close") return closeBrowserPage(args.session_id, context.language);

  const session = getBrowserSession(args.session_id, context.language);
  if (action === "click") {
    const selector = String(args.selector || "").trim();
    if (!selector) throw localizedError(context.language, "tools.emptySelector");
    await session.page.click(selector, { timeout: 10_000 });
  } else if (action === "type") {
    const selector = String(args.selector || "").trim();
    if (!selector) throw localizedError(context.language, "tools.emptySelector");
    const text = String(args.text ?? "");
    if (args.clear === false) {
      await session.page.type(selector, text, { timeout: 10_000 });
    } else {
      await session.page.fill(selector, text, { timeout: 10_000 });
    }
  } else if (action === "evaluate") {
    const script = String(args.script || "").trim();
    if (!script) throw localizedError(context.language, "tools.emptyScript");
    session.lastEvaluation = await session.page.evaluate((source) => {
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${source});`)();
    }, script);
  } else if (action !== "screenshot") {
    throw localizedError(context.language, "tools.invalidBrowserAction", { action });
  }

  await waitAfterBrowserAction(session.page, args.wait_ms);
  const screenshotPath = args.screenshot || action === "screenshot"
    ? await saveBrowserScreenshot(context, session.page, args.screenshot_path, args.full_page !== false)
    : "";
  return browserSnapshot(session, { screenshotPath, action });
}

async function openBrowserPage(context, args = {}) {
  pruneBrowserSessions();
  const chromium = await loadPlaywrightChromium(context.language);
  const browser = await chromium.launch({ headless: args.headless !== false });
  const viewport = {
    width: Math.min(Math.max(Number(args.viewport_width) || 1280, 320), 3840),
    height: Math.min(Math.max(Number(args.viewport_height) || 800, 240), 2160)
  };
  const page = await browser.newPage({ viewport });
  const session = {
    id: randomUUID(),
    browser,
    page,
    consoleMessages: [],
    pageErrors: [],
    lastEvaluation: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  attachBrowserDiagnostics(session);
  browserSessions.set(session.id, session);

  const url = await normalizeBrowserUrl(context, args.url);
  const waitUntil = ["load", "domcontentloaded", "networkidle", "commit"].includes(args.wait_until)
    ? args.wait_until
    : "networkidle";
  await page.goto(url, { waitUntil, timeout: 30_000 });
  await waitAfterBrowserAction(page, args.wait_ms);
  const screenshotPath = args.screenshot
    ? await saveBrowserScreenshot(context, page, args.screenshot_path, args.full_page !== false)
    : "";
  return browserSnapshot(session, { screenshotPath, action: "open" });
}

async function loadPlaywrightChromium(language) {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch (error) {
    throw localizedError(language, "tools.browserUnavailable", { message: error?.message || String(error) });
  }
}

function attachBrowserDiagnostics(session) {
  session.page.on("console", (message) => {
    const entry = {
      type: message.type(),
      text: message.text(),
      location: message.location()
    };
    session.consoleMessages.push(entry);
    session.consoleMessages = session.consoleMessages.slice(-80);
    session.updatedAt = Date.now();
  });
  session.page.on("pageerror", (error) => {
    session.pageErrors.push(error?.stack || error?.message || String(error));
    session.pageErrors = session.pageErrors.slice(-40);
    session.updatedAt = Date.now();
  });
}

async function normalizeBrowserUrl(context, rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) throw localizedError(context.language, "tools.emptyUrl");
  if (/^https?:\/\//i.test(value) || /^file:\/\//i.test(value) || /^data:/i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;

  const absolute = isFullAccess(context)
    ? path.resolve(expandHomePath(value))
    : resolveInsideWorkspace(context.workspace, value, context.language);
  const stat = await fs.stat(absolute).catch(() => null);
  if (stat?.isFile()) return pathToFileURL(absolute).href;
  return `http://${value}`;
}

async function waitAfterBrowserAction(page, waitMs) {
  const delay = Math.min(Math.max(Number(waitMs) || 250, 0), 10_000);
  if (delay > 0) await page.waitForTimeout(delay);
}

async function saveBrowserScreenshot(context, page, requestedPath, fullPage) {
  const { absolute, displayPath } = resolveBrowserScreenshotPath(context, requestedPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await page.screenshot({ path: absolute, fullPage });
  return displayPath;
}

function resolveBrowserScreenshotPath(context, requestedPath) {
  const cleaned = String(requestedPath || "").trim();
  if (cleaned) return resolveMutableFilePath(context, cleaned);
  const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  return {
    absolute: path.join(path.resolve(context.workspace), ".agentdesk", "browser-screenshots", filename),
    displayPath: `.agentdesk/browser-screenshots/${filename}`
  };
}

function getBrowserSession(sessionId, language) {
  const id = String(sessionId || "").trim();
  const session = browserSessions.get(id);
  if (!session) throw localizedError(language, "tools.browserSessionMissing", { id });
  session.updatedAt = Date.now();
  return session;
}

async function closeBrowserPage(sessionId, language) {
  const session = getBrowserSession(sessionId, language);
  browserSessions.delete(session.id);
  await session.browser.close();
  return JSON.stringify({
    sessionId: session.id,
    closed: true,
    consoleErrors: collectConsoleErrors(session),
    pageErrors: session.pageErrors
  }, null, 2);
}

async function browserSnapshot(session, extra = {}) {
  const title = await session.page.title().catch(() => "");
  const url = session.page.url();
  const bodyText = await session.page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
  return JSON.stringify({
    sessionId: session.id,
    action: extra.action || "",
    url,
    title,
    screenshotPath: extra.screenshotPath || "",
    consoleErrors: collectConsoleErrors(session),
    pageErrors: session.pageErrors,
    evaluation: session.lastEvaluation,
    textExcerpt: bodyText.replace(/\s+/g, " ").trim().slice(0, 4000),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }, null, 2);
}

function collectConsoleErrors(session) {
  return session.consoleMessages
    .filter((entry) => entry.type === "error" || entry.type === "warning")
    .slice(-40);
}

function pruneBrowserSessions() {
  if (browserSessions.size < MAX_BROWSER_SESSIONS) return;
  const oldest = [...browserSessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  while (browserSessions.size >= MAX_BROWSER_SESSIONS && oldest.length > 0) {
    const session = oldest.shift();
    browserSessions.delete(session.id);
    session.browser.close().catch(() => {});
  }
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
      mode: "run",
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
      mode: "run",
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

async function startCommand(context, command, cwdInput = "") {
  const commandText = String(command ?? "").trim();
  if (!commandText) throw localizedError(context.language, "tools.emptyCommand");
  const cwd = resolveCommandCwd(context, cwdInput);
  const shell = getShellInvocation(commandText);
  const highRisk = isDangerousCommand(commandText);
  if (!isAutoApprovalEnabled("command", context) && (highRisk || !isAutoAllowedCommand(commandText))) {
    const commandId = randomUUID();
    pendingCommands.set(commandId, {
      id: commandId,
      mode: "start",
      workspace: context.workspace,
      requestId: context.requestId,
      sessionId: context.sessionId,
      command: commandText,
      highRisk,
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
      mode: "start",
      command: commandText,
      cwd,
      shell: formatShellLabel(shell.file),
      inheritedEnv: true,
      highRisk,
      risk: highRisk ? "high" : "normal",
      riskReason: commandApprovalReason(highRisk, context.language),
      message: t(context.language, "tools.commandQueued")
    });
  }

  return startCommandSession({
    command: commandText,
    cwd,
    shellLabel: formatShellLabel(shell.file)
  });
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
  const result = pending.mode === "start"
    ? await startCommandSession({
      command: pending.command,
      cwd: pending.cwd || pending.workspace,
      shellLabel: pending.shell
    })
    : await executeCommand(pending.workspace, pending.command, pending.timeoutMs);
  return {
    ok: true,
    commandId: pending.id || pending.commandId,
    command: pending.command,
    mode: pending.mode || "run",
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

async function startCommandSession({ command, cwd, shellLabel = "" }) {
  pruneCommandSessions();
  const { file, args } = getShellInvocation(command);
  const sessionId = randomUUID();
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const child = spawn(file, args, {
    cwd: resolvedCwd,
    windowsHide: true,
    env: process.env
  });
  const session = {
    id: sessionId,
    process: child,
    command,
    cwd: resolvedCwd,
    shell: shellLabel || formatShellLabel(file),
    pid: child.pid || null,
    output: "",
    outputStartOffset: 0,
    totalOutputChars: 0,
    exitCode: null,
    signal: "",
    running: true,
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
  commandSessions.set(sessionId, session);

  const append = (stream, chunk) => appendCommandOutput(session, stream, chunk);
  child.stdout?.on("data", (chunk) => append("stdout", chunk));
  child.stderr?.on("data", (chunk) => append("stderr", chunk));
  child.on("error", (error) => append("error", `${error.message}\n`));
  child.on("exit", (code, signal) => {
    session.exitCode = code;
    session.signal = signal || "";
    session.running = false;
    session.updatedAt = Date.now();
  });

  return JSON.stringify({
    sessionId,
    command,
    cwd: session.cwd,
    shell: session.shell,
    pid: session.pid,
    running: true,
    outputOffset: session.totalOutputChars,
    startedAt: session.startedAt
  }, null, 2);
}

function appendCommandOutput(session, stream, chunk) {
  const text = `[${stream}] ${Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)}`;
  session.output += text;
  session.totalOutputChars += text.length;
  session.updatedAt = Date.now();
  if (session.output.length > MAX_COMMAND_SESSION_BUFFER) {
    const overflow = session.output.length - MAX_COMMAND_SESSION_BUFFER;
    session.output = session.output.slice(overflow);
    session.outputStartOffset += overflow;
  }
}

function readCommandOutput(sessionId, outputOffset, maxChars, language) {
  const id = String(sessionId || "");
  const session = commandSessions.get(id);
  if (!session) throw localizedError(language, "tools.commandSessionMissing", { id });
  const limit = Math.min(Math.max(Number(maxChars) || 20_000, 1_000), 100_000);
  const requestedOffset = Math.max(Number(outputOffset) || 0, 0);
  const effectiveOffset = Math.max(requestedOffset, session.outputStartOffset);
  const localOffset = Math.max(0, effectiveOffset - session.outputStartOffset);
  const output = session.output.slice(localOffset, localOffset + limit);
  const nextOffset = effectiveOffset + output.length;
  return JSON.stringify({
    sessionId: id,
    command: session.command,
    cwd: session.cwd,
    shell: session.shell,
    pid: session.pid,
    running: session.running,
    exitCode: session.exitCode,
    signal: session.signal,
    output,
    outputOffset: nextOffset,
    outputStartOffset: session.outputStartOffset,
    totalOutputChars: session.totalOutputChars,
    truncatedBefore: requestedOffset < session.outputStartOffset,
    hasMore: nextOffset < session.outputStartOffset + session.output.length,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt
  }, null, 2);
}

function stopCommand(sessionId, language) {
  const id = String(sessionId || "");
  const session = commandSessions.get(id);
  if (!session) throw localizedError(language, "tools.commandSessionMissing", { id });
  if (session.running) {
    session.process.kill("SIGTERM");
    setTimeout(() => {
      if (session.running) session.process.kill("SIGKILL");
    }, 1500).unref?.();
  }
  return JSON.stringify({
    sessionId: id,
    command: session.command,
    running: session.running,
    stopped: true,
    exitCode: session.exitCode,
    signal: session.signal,
    outputOffset: session.totalOutputChars
  }, null, 2);
}

function pruneCommandSessions() {
  if (commandSessions.size < MAX_COMMAND_SESSIONS) return;
  const finished = [...commandSessions.values()]
    .filter((session) => !session.running)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  while (commandSessions.size >= MAX_COMMAND_SESSIONS && finished.length > 0) {
    commandSessions.delete(finished.shift().id);
  }
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
  if (isFullAccess(context)) return resolveAnyPath(context, requestedPath);
  if (path.isAbsolute(requestedPath)) {
    const absolute = path.resolve(requestedPath);
    if (isAttachedPathAllowed(absolute, context.attachments)) return absolute;
  }
  return resolveInsideWorkspace(context.workspace, requestedPath, context.language);
}

function resolveDirectoryPath(context, directory) {
  const requestedPath = String(directory ?? "").trim();
  if (isFullAccess(context)) return resolveAnyPath(context, requestedPath || ".");
  return resolveInsideWorkspace(context.workspace, requestedPath || ".", context.language);
}

function resolveCommandCwd(context, cwdInput = "") {
  const requestedPath = String(cwdInput ?? "").trim();
  if (!requestedPath) return path.resolve(context.workspace || process.cwd());
  if (isFullAccess(context)) return resolveAnyPath(context, requestedPath);
  return resolveInsideWorkspace(context.workspace, requestedPath, context.language);
}

function resolveMutableFilePath(context, filePath) {
  const requestedPath = requireToolPath(filePath, context.language);
  if (!isFullAccess(context)) {
    const displayPath = normalizeWorkspacePath(requestedPath, context.language);
    return {
      absolute: resolveInsideWorkspace(context.workspace, displayPath, context.language),
      displayPath
    };
  }

  const absolute = resolveAnyPath(context, requestedPath);
  return {
    absolute,
    displayPath: formatFullAccessDisplayPath(requestedPath, absolute)
  };
}

function resolveAnyPath(context, filePath) {
  const requestedPath = requireToolPath(filePath, context.language);
  return path.resolve(context.workspace || process.cwd(), expandHomePath(requestedPath));
}

function requireToolPath(filePath, language) {
  const requestedPath = String(filePath ?? "").trim();
  if (!requestedPath) throw localizedError(language, "tools.emptyPath");
  return requestedPath;
}

function expandHomePath(filePath) {
  const value = String(filePath ?? "");
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function formatFullAccessDisplayPath(requestedPath, absolute) {
  if (path.isAbsolute(expandHomePath(requestedPath))) return absolute;
  return requestedPath.replaceAll("\\", "/");
}

function isOutsideWorkspace(workspaceRoot, targetPath) {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function isFullAccess(context) {
  return Boolean(context?.fullAccessAutoApproval);
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
