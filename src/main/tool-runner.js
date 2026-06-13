import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { normalizeLanguage, t } from "./i18n.js";
import { webSearch } from "./web-search.js";
import { executeSystemTool, isSystemTool } from "./system-tools.js";
import { capturePrimaryScreen } from "./screen-capture.js";
import { getWebServerState } from "./web-server.js";
import { proposePatch, localizedError } from "./patch-approval.js";

// Import split modular tools
import {
  listFiles,
  readFile,
  readFiles,
  readFileRange,
  writeFile,
  deleteFile,
  replaceText,
  normalizeToolContext
} from "./tools/file-tools.js";

import {
  runCommand,
  startCommand,
  readCommandOutput,
  stopCommand,
  isAutoAllowedCommand,
  isDangerousCommand,
  commandApprovalReason
} from "./tools/command-tools.js";

import {
  browserPage
} from "./tools/browser-tools.js";

import {
  workspaceMap,
  searchFiles
} from "./tools/workspace-tools.js";

// Re-export methods used by external files
export {
  approvePendingCommand,
  executeCommandRecord,
  discardPendingCommand
} from "./tools/command-tools.js";

const MAX_INLINE_RESULT_CHARS = 60_000;
const DEFAULT_RESULT_CHUNK_CHARS = 40_000;
const MAX_RESULT_CHUNK_CHARS = 120_000;
const MAX_STORED_RESULTS = 40;
const storedResults = new Map();

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
    case "take_screenshot":
      return takeScreenshot(context, args.caption);
    case "send_image":
      return sendImage(context, args.path, args.caption);
    case "manage_skills":
      return manageSkills(context, args);
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
    if (/command not found|not recognized|enoent|找不到命令|不是内部或外部命令|无法将.*识别为|cmdlet/i.test(lower)) {
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

async function takeScreenshot(context, caption = "") {
  const buffer = await capturePrimaryScreen();
  const filename = `screenshot_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;
  const screenshotDir = path.join(app.getPath("userData"), "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, filename);
  await fs.writeFile(filePath, buffer);

  const serverState = getWebServerState();
  const token = serverState.token;
  const port = serverState.port;
  const url = `http://localhost:${port}/api/screenshots/${filename}?token=${token}`;

  if (typeof context.emit === "function") {
    context.emit({
      type: "image_sent",
      path: filePath,
      buffer: buffer,
      caption: caption || "🖥️ 电脑屏幕截图"
    });
  }

  return JSON.stringify({
    ok: true,
    path: filePath,
    url: url,
    message: "Screenshot successfully captured and sent."
  });
}

async function sendImage(context, relativePath, caption = "") {
  const workspace = context.workspace;
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(workspace, relativePath);

  let buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch (error) {
    throw new Error(`Failed to read file at ${relativePath}: ${error.message}`);
  }

  const ext = path.extname(absolutePath) || ".png";
  const filename = `image_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
  const screenshotDir = path.join(app.getPath("userData"), "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, filename);
  await fs.writeFile(filePath, buffer);

  const serverState = getWebServerState();
  const token = serverState.token;
  const port = serverState.port;
  const url = `http://localhost:${port}/api/screenshots/${filename}?token=${token}`;

  if (typeof context.emit === "function") {
    context.emit({
      type: "image_sent",
      path: absolutePath,
      buffer: buffer,
      caption: caption || `图片附件: ${path.basename(relativePath)}`
    });
  }

  return JSON.stringify({
    ok: true,
    path: absolutePath,
    url: url,
    message: "Image successfully read and sent."
  });
}

async function manageSkills(context, args) {
  const { action, id, title, description, type, prompt, code, interval_minutes, enabled } = args;
  const { loadPersistedSkills, savePersistedSkills } = await import("./persistence.js");
  const { syncSkillsScheduler } = await import("./skills-scheduler.js");
  const vm = await import("node:vm");

  const skills = await loadPersistedSkills().catch(() => []);

  if (action === "list") {
    return JSON.stringify({ ok: true, skills });
  }

  if (action === "create") {
    if (!title) {
      throw new Error("Title is required to create a skill.");
    }
    if (!type || !["prompt", "code"].includes(type)) {
      throw new Error("Type must be 'prompt' or 'code'.");
    }
    if (type === "prompt" && !prompt) {
      throw new Error("Prompt is required for 'prompt' type skill.");
    }
    if (type === "code") {
      if (!code) {
        throw new Error("Code is required for 'code' type skill.");
      }
      try {
        new vm.Script(code);
      } catch (err) {
        throw new Error(`JavaScript syntax error in code: ${err.message}`);
      }
    }

    const skillId = id || `skill_${Date.now()}`;
    if (skills.some(s => s.id === skillId)) {
      throw new Error(`Skill with ID '${skillId}' already exists.`);
    }

    const newSkill = {
      id: skillId,
      title,
      description: description || "",
      enabled: enabled !== false,
      type,
      prompt: type === "prompt" ? prompt : "",
      code: type === "code" ? code : "",
      intervalMinutes: Math.max(0, Number(interval_minutes) || 0),
      runAt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    skills.push(newSkill);
    await savePersistedSkills(skills);
    void syncSkillsScheduler();

    return JSON.stringify({ ok: true, message: "Skill created successfully", skill: newSkill });
  }

  if (action === "toggle") {
    if (!id) {
      throw new Error("ID is required to toggle a skill.");
    }
    const idx = skills.findIndex(s => s.id === id);
    if (idx === -1) {
      throw new Error(`Skill with ID '${id}' not found.`);
    }

    const targetSkill = skills[idx];
    const nextEnabled = enabled !== undefined ? Boolean(enabled) : !targetSkill.enabled;
    targetSkill.enabled = nextEnabled;
    targetSkill.updatedAt = Date.now();
    if (nextEnabled) {
      targetSkill.runAt = 0;
    }

    await savePersistedSkills(skills);
    void syncSkillsScheduler();

    return JSON.stringify({ ok: true, message: `Skill ${nextEnabled ? "enabled" : "disabled"} successfully`, skill: targetSkill });
  }

  if (action === "delete") {
    if (!id) {
      throw new Error("ID is required to delete a skill.");
    }
    const idx = skills.findIndex(s => s.id === id);
    if (idx === -1) {
      throw new Error(`Skill with ID '${id}' not found.`);
    }

    const deletedSkill = skills.splice(idx, 1)[0];
    await savePersistedSkills(skills);
    void syncSkillsScheduler();

    return JSON.stringify({ ok: true, message: "Skill deleted successfully", skill: deletedSkill });
  }

  throw new Error(`Unknown action: ${action}`);
}

export const __test__ = {
  isAutoAllowedCommand,
  isDangerousCommand
};
