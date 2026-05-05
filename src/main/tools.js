import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MAX_FILE_BYTES = 120_000;
const pendingPatches = new Map();
const pendingCommands = new Map();

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
      name: "apply_patch",
      description: "Propose a unified diff patch for user review. The patch is not applied until the user approves it in the UI.",
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
      name: "run_command",
      description: "Run a PowerShell command in the workspace and return stdout/stderr. Destructive commands are blocked.",
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

export async function executeToolCall(toolCall, workspace) {
  const name = toolCall.function?.name;
  const args = parseToolArgs(toolCall.function?.arguments);

  switch (name) {
    case "list_files":
      return listFiles(workspace, args.directory || "", args.max_files || 120);
    case "read_file":
      return readFile(workspace, args.path);
    case "apply_patch":
      return proposePatch(workspace, args.patch, args.summary);
    case "search_files":
      return searchFiles(workspace, args.query, args.max_results || 50);
    case "run_command":
      return runCommand(workspace, args.command, args.timeout_ms || 30_000);
    case "update_plan":
      return JSON.stringify({ ok: true, items: Array.isArray(args.items) ? args.items : [] });
    default:
      throw new Error(`未知工具：${name}`);
  }
}

function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`工具参数不是合法 JSON：${raw}`);
  }
}

async function listFiles(workspace, directory, maxFiles) {
  const root = resolveInsideWorkspace(workspace, directory || ".");
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

async function readFile(workspace, filePath) {
  const absolute = resolveInsideWorkspace(workspace, filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`${filePath} 不是文件。`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${filePath} 太大（${stat.size} bytes），demo 限制为 ${MAX_FILE_BYTES} bytes。`);
  }
  return await fs.readFile(absolute, "utf8");
}

async function searchFiles(workspace, query, maxResults) {
  const needle = String(query ?? "");
  if (!needle) throw new Error("query 不能为空。");
  const filesJson = await listFiles(workspace, ".", 400);
  const files = JSON.parse(filesJson).files;
  const results = [];
  const limit = Math.min(Number(maxResults) || 50, 100);

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const content = await readFile(workspace, file);
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

async function proposePatch(workspace, patch, summary = "") {
  const patchText = ensureTrailingNewline(stripMarkdownFence(String(patch ?? "")));
  if (!patchText.trim()) throw new Error("patch 不能为空。");
  validatePatchPaths(workspace, patchText);

  const patchId = randomUUID();
  pendingPatches.set(patchId, {
    id: patchId,
    workspace: path.resolve(workspace),
    patch: patchText,
    summary: String(summary || "Proposed patch"),
    createdAt: Date.now()
  });

  return JSON.stringify({
    ok: true,
    pending: true,
    patchId,
    summary: String(summary || "Proposed patch"),
    message: "Patch queued for user review. It has not been applied yet."
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

export async function applyPendingPatch(patchId) {
  const pending = pendingPatches.get(patchId);
  if (!pending) throw new Error("待应用 patch 不存在或已处理。");

  validatePatchPaths(pending.workspace, pending.patch);
  const tempPath = path.join(os.tmpdir(), `agent-window-${patchId}.diff`);

  try {
    await fs.writeFile(tempPath, pending.patch, "utf8");
    await execFileAsync("git", ["apply", "--check", "--whitespace=nowarn", tempPath], {
      cwd: pending.workspace,
      windowsHide: true,
      maxBuffer: 1_000_000
    });
    await execFileAsync("git", ["apply", "--whitespace=nowarn", tempPath], {
      cwd: pending.workspace,
      windowsHide: true,
      maxBuffer: 1_000_000
    });
    pendingPatches.delete(patchId);
    return { ok: true, patchId, summary: pending.summary };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export function discardPendingPatch(patchId) {
  const existed = pendingPatches.delete(patchId);
  return { ok: existed, patchId };
}

async function runCommand(workspace, command, timeoutMs) {
  const commandText = String(command ?? "").trim();
  if (!commandText) throw new Error("command 不能为空。");
  if (isDangerousCommand(commandText)) {
    throw new Error("命令被安全策略拦截。这个 demo 默认阻止删除、重置、关机、格式化等高风险命令。");
  }
  if (!isAutoAllowedCommand(commandText)) {
    const commandId = randomUUID();
    pendingCommands.set(commandId, {
      id: commandId,
      workspace: path.resolve(workspace),
      command: commandText,
      timeoutMs,
      createdAt: Date.now()
    });
    return JSON.stringify({
      ok: true,
      pending: true,
      commandId,
      command: commandText,
      message: "Command queued for user approval. It has not been executed yet."
    });
  }

  return executeCommand(workspace, commandText, timeoutMs);
}

async function executeCommand(workspace, commandText, timeoutMs) {
  const timeout = Math.min(Math.max(Number(timeoutMs) || 30_000, 1_000), 120_000);
  const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", commandText], {
    cwd: workspace,
    timeout,
    windowsHide: true,
    maxBuffer: 1_000_000
  });

  return JSON.stringify({ stdout, stderr }, null, 2);
}

export async function approvePendingCommand(commandId) {
  const pending = pendingCommands.get(commandId);
  if (!pending) throw new Error("待确认命令不存在或已处理。");
  pendingCommands.delete(commandId);
  const result = await executeCommand(pending.workspace, pending.command, pending.timeoutMs);
  return { ok: true, commandId, command: pending.command, result };
}

export function discardPendingCommand(commandId) {
  const existed = pendingCommands.delete(commandId);
  return { ok: existed, commandId };
}

function resolveInsideWorkspace(workspace, targetPath) {
  if (!workspace) throw new Error("请先选择 workspace。");
  const absoluteWorkspace = path.resolve(workspace);
  const absoluteTarget = path.resolve(absoluteWorkspace, String(targetPath || "."));
  const relative = path.relative(absoluteWorkspace, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径越界：${targetPath}`);
  }
  return absoluteTarget;
}

function validatePatchPaths(workspace, patchText) {
  const paths = extractPatchPaths(patchText);
  if (paths.length === 0) {
    throw new Error("patch 不是可识别的 unified diff。请包含 diff --git 或 ---/+++ 文件头。");
  }

  for (const filePath of paths) {
    resolveInsideWorkspace(workspace, filePath);
  }
}

function extractPatchPaths(patchText) {
  const paths = new Set();
  for (const line of patchText.split(/\r?\n/)) {
    const gitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitMatch) {
      addPatchPath(paths, gitMatch[1]);
      addPatchPath(paths, gitMatch[2]);
      continue;
    }

    const fileMatch = line.match(/^(---|\+\+\+) (.+)$/);
    if (fileMatch) {
      addPatchPath(paths, normalizeDiffPath(fileMatch[2]));
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

function addPatchPath(paths, filePath) {
  const normalized = normalizeDiffPath(filePath).replaceAll("\\", "/");
  if (!normalized) return;
  if (normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`patch 路径不安全：${filePath}`);
  }
  paths.add(normalized);
}

function isDangerousCommand(command) {
  const lowered = command.toLowerCase();
  return [
    /\bremove-item\b/,
    /(^|[;&|\s])rm\s+/,
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
  return [
    /^git\s+(status|diff|branch|log|show)(\s|$)/,
    /^npm\s+run\s+typecheck(\s|$)/,
    /^npm\s+run\s+build(\s|$)/,
    /^npm\s+test(\s|$)/,
    /^node\s+--check(\s|$)/,
    /^get-childitem(\s|$)/,
    /^dir(\s|$)/,
    /^ls(\s|$)/,
    /^get-content(\s|$)/,
    /^type\s+/,
    /^select-string(\s|$)/,
    /^findstr(\s|$)/
  ].some((pattern) => pattern.test(lowered));
}
