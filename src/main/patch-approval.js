import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { normalizeLanguage, t } from "./i18n.js";
import {
  normalizeWorkspacePath as normalizeSharedWorkspacePath,
  resolveInsideWorkspace as resolveSharedInsideWorkspace
} from "../shared/pathSecurity.js";
import { loadPersistedApprovalScopesSync, savePersistedApprovalScopesSync } from "./persistence.js";

const execFileAsync = promisify(execFile);
const pendingPatches = new Map();
const autoApprovalScopes = new Map(Object.entries(loadPersistedApprovalScopesSync()));

export async function proposePatch(context, patch, summary = "") {
  const workspace = context.workspace;
  const patchText = ensureTrailingNewline(stripMarkdownFence(String(patch ?? "")));
  if (!patchText.trim()) throw localizedError(context.language, "tools.emptyPatch");
  const allowUnsafePaths = Boolean(context.fullAccessAutoApproval);
  validatePatchPaths(workspace, patchText, context.language, { allowUnsafePaths });
  const resolvedWorkspace = path.resolve(workspace);

  if (isAutoApprovalEnabled("patch", context)) {
    const result = await applyPatchText({
      id: randomUUID(),
      workspace: resolvedWorkspace,
      patch: patchText,
      summary: String(summary || "Proposed patch"),
      language: context.language,
      allowUnsafePaths
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
    allowUnsafePaths,
    createdAt: Date.now()
  });

  return JSON.stringify({
    ok: true,
    pending: true,
    patchId,
    summary: String(summary || "Proposed patch"),
    patch: patchText,
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

  const result = await applyPatchRecord(pending);
  pendingPatches.delete(patchId);
  return result;
}

export function discardPendingPatch(patchId) {
  const existed = pendingPatches.delete(patchId);
  return { ok: existed, patchId };
}

async function applyPatchText(pending) {
  const patchPaths = validatePatchPaths(pending.workspace, pending.patch, pending.language, {
    allowUnsafePaths: Boolean(pending.allowUnsafePaths)
  });
  const tempPath = path.join(os.tmpdir(), `agent-window-${pending.id}.diff`);

  try {
    await fs.writeFile(tempPath, pending.patch, "utf8");
    const strategy = await applyPatchWithStrategies(pending.workspace, tempPath, pending.language, {
      allowUnsafePaths: Boolean(pending.allowUnsafePaths),
      patchPaths,
      patchText: pending.patch
    });
    return {
      ok: true,
      patchId: pending.id,
      summary: pending.summary,
      strategy
    };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function applyPatchRecord(pending) {
  return applyPatchText({
    id: pending.id || pending.patchId || randomUUID(),
    workspace: pending.workspace,
    patch: pending.patch,
    summary: pending.summary || "Proposed patch",
    language: normalizeLanguage(pending.language),
    allowUnsafePaths: Boolean(pending.allowUnsafePaths)
  });
}

export function resolveInsideWorkspace(workspace, targetPath, language) {
  return resolveSharedInsideWorkspace(workspace, targetPath, pathSecurityOptions(language));
}

export function normalizeWorkspacePath(filePath, language) {
  return normalizeSharedWorkspacePath(filePath, pathSecurityOptions(language));
}

export function buildWholeFilePatch(filePath, previousContent, nextContent) {
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

export function validatePatchPaths(workspace, patchText, language, options = {}) {
  const paths = extractPatchPaths(patchText, language, options);
  if (paths.length === 0) {
    throw localizedError(language, "tools.invalidPatch");
  }

  if (options.allowUnsafePaths) return paths;

  for (const filePath of paths) {
    resolveInsideWorkspace(workspace, filePath, language);
  }

  return paths;
}

export function extractPatchPaths(patchText, language = "zh", options = {}) {
  const paths = new Set();
  for (const line of patchText.split(/\r?\n/)) {
    const gitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitMatch) {
      addPatchPath(paths, gitMatch[1], language, options);
      addPatchPath(paths, gitMatch[2], language, options);
      continue;
    }

    const fileMatch = line.match(/^(---|\+\+\+) (.+)$/);
    if (fileMatch) {
      addPatchPath(paths, normalizeDiffPath(fileMatch[2]), language, options);
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

function addPatchPath(paths, filePath, language, options = {}) {
  const normalized = normalizeDiffPath(filePath).replaceAll("\\", "/");
  if (!normalized) return;
  if (!options.allowUnsafePaths && (normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || normalized.startsWith("../"))) {
    throw localizedError(language, "tools.unsafePatchPath", { path: filePath });
  }
  paths.add(normalized);
}

async function applyPatchWithStrategies(workspace, tempPath, language, options = {}) {
  const strategies = buildGitApplyStrategies(options);
  let lastError = null;
  for (const strategy of strategies) {
    try {
      await runGitApply(workspace, [...strategy.checkArgs, tempPath], language);
      await runGitApply(workspace, [...strategy.applyArgs, tempPath], language);
      return strategy.label;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    await applyUnifiedDiffManually(workspace, options.patchText || await fs.readFile(tempPath, "utf8"), language, options);
    return "manual unified diff fallback";
  } catch (manualError) {
    if (lastError) {
      lastError.stderr = [lastError.stderr, `Manual fallback failed: ${manualError.message}`].filter(Boolean).join("\n").trim();
      throw lastError;
    }
    throw manualError;
  }
}

function buildGitApplyStrategies(options = {}) {
  const base = ["apply", "--recount", "--whitespace=nowarn"];
  if (!options.allowUnsafePaths) {
    return [{
      label: "git apply --recount",
      checkArgs: ["apply", "--check", "--recount", "--whitespace=nowarn"],
      applyArgs: base
    }];
  }

  const unsafeBase = ["apply", "--unsafe-paths", "--recount", "--whitespace=nowarn"];
  const strategies = [{
    label: "git apply --unsafe-paths --recount",
    checkArgs: ["apply", "--check", "--unsafe-paths", "--recount", "--whitespace=nowarn"],
    applyArgs: unsafeBase
  }];

  if ((options.patchPaths || []).some((filePath) => path.isAbsolute(filePath))) {
    strategies.push({
      label: "git apply --unsafe-paths -p0 --recount",
      checkArgs: ["apply", "--check", "--unsafe-paths", "-p0", "--recount", "--whitespace=nowarn"],
      applyArgs: ["apply", "--unsafe-paths", "-p0", "--recount", "--whitespace=nowarn"]
    });
  }

  return strategies;
}

async function runGitApply(workspace, args, language) {
  try {
    await execFileAsync("git", args, {
      cwd: path.resolve(workspace || process.cwd()),
      windowsHide: true,
      maxBuffer: 2_000_000
    });
  } catch (error) {
    const wrapped = localizedError(language, "tools.gitApplyFailed");
    wrapped.code = error?.code;
    wrapped.stdout = error?.stdout;
    wrapped.stderr = error?.stderr;
    throw wrapped;
  }
}

async function applyUnifiedDiffManually(workspace, patchText, language, options = {}) {
  const files = parseUnifiedDiffFiles(patchText, language);
  if (files.length === 0) throw localizedError(language, "tools.invalidPatch");

  const plannedChanges = [];
  for (const filePatch of files) {
    const targetPath = filePatch.newPath || filePatch.oldPath;
    if (!targetPath) throw localizedError(language, "tools.invalidPatch");
    const absolute = resolvePatchTargetPath(workspace, targetPath, language, options);
    const previousContent = await fs.readFile(absolute, "utf8").catch((error) => {
      if (error?.code === "ENOENT" && filePatch.oldPath === "") return "";
      throw error;
    });
    const nextContent = applyHunksToContent(previousContent, filePatch.hunks, language, targetPath);
    plannedChanges.push({
      absolute,
      nextContent,
      deleteFile: filePatch.newPath === ""
    });
  }

  for (const change of plannedChanges) {
    if (change.deleteFile) {
      await fs.rm(change.absolute, { force: true });
    } else {
      await fs.mkdir(path.dirname(change.absolute), { recursive: true });
      await fs.writeFile(change.absolute, change.nextContent, "utf8");
    }
  }
}

function parseUnifiedDiffFiles(patchText, language) {
  const lines = String(patchText || "").split(/\r?\n/);
  const files = [];
  let current = null;
  let currentHunk = null;

  function finishHunk() {
    if (currentHunk && current) current.hunks.push(currentHunk);
    currentHunk = null;
  }

  function finishFile() {
    finishHunk();
    if (current) files.push(current);
    current = null;
  }

  for (const line of lines) {
    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      finishFile();
      current = {
        oldPath: normalizeDiffPath(diffMatch[1]),
        newPath: normalizeDiffPath(diffMatch[2]),
        hunks: []
      };
      continue;
    }

    const oldMatch = line.match(/^--- (.+)$/);
    if (oldMatch) {
      if (!current) current = { oldPath: "", newPath: "", hunks: [] };
      current.oldPath = normalizeDiffPath(oldMatch[1]);
      continue;
    }

    const newMatch = line.match(/^\+\+\+ (.+)$/);
    if (newMatch) {
      if (!current) current = { oldPath: "", newPath: "", hunks: [] };
      current.newPath = normalizeDiffPath(newMatch[1]);
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (!current) throw localizedError(language, "tools.invalidPatch");
      finishHunk();
      currentHunk = {
        oldStart: Number(hunkMatch[1]),
        oldCount: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
        newStart: Number(hunkMatch[3]),
        newCount: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
        lines: []
      };
      continue;
    }

    if (currentHunk) {
      if (line.startsWith("\\ No newline at end of file")) continue;
      if (/^[ +\-]/.test(line)) currentHunk.lines.push(line);
    }
  }

  finishFile();
  return files.filter((file) => (file.oldPath || file.newPath) && file.hunks.length > 0);
}

function applyHunksToContent(content, hunks, language, filePath) {
  let lines = splitDiffLines(content);
  let offset = 0;

  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((line) => line.startsWith(" ") || line.startsWith("-"))
      .map((line) => line.slice(1));
    const newLines = hunk.lines
      .filter((line) => line.startsWith(" ") || line.startsWith("+"))
      .map((line) => line.slice(1));
    const expectedIndex = Math.max(0, hunk.oldStart - 1 + offset);
    const index = findBestHunkIndex(lines, oldLines, expectedIndex);
    if (index < 0) {
      throw localizedError(language, "tools.manualPatchHunkFailed", { path: filePath, line: hunk.oldStart });
    }
    lines = [
      ...lines.slice(0, index),
      ...newLines,
      ...lines.slice(index + oldLines.length)
    ];
    offset += newLines.length - oldLines.length;
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function findBestHunkIndex(lines, oldLines, expectedIndex) {
  if (oldLines.length === 0) return Math.min(Math.max(expectedIndex, 0), lines.length);
  if (sequenceMatchesAt(lines, oldLines, expectedIndex)) return expectedIndex;

  const searchRadius = Math.max(200, oldLines.length * 4);
  for (let distance = 1; distance <= searchRadius; distance += 1) {
    const before = expectedIndex - distance;
    if (before >= 0 && sequenceMatchesAt(lines, oldLines, before)) return before;
    const after = expectedIndex + distance;
    if (after <= lines.length && sequenceMatchesAt(lines, oldLines, after)) return after;
  }

  for (let index = 0; index <= lines.length - oldLines.length; index += 1) {
    if (sequenceMatchesAt(lines, oldLines, index)) return index;
  }
  return -1;
}

function sequenceMatchesAt(lines, expectedLines, index) {
  if (index < 0 || index + expectedLines.length > lines.length) return false;
  for (let offset = 0; offset < expectedLines.length; offset += 1) {
    if (lines[index + offset] !== expectedLines[offset]) return false;
  }
  return true;
}

function resolvePatchTargetPath(workspace, filePath, language, options = {}) {
  if (options.allowUnsafePaths) {
    return path.resolve(workspace || process.cwd(), filePath);
  }
  return resolveInsideWorkspace(workspace, filePath, language);
}

export function normalizeApprovalPayload(payload, kind) {
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

export function setCommandAutoApproval(payload) {
  const context = normalizeApprovalPayload(payload, "command");
  return setScopedAutoApproval(context);
}

export function setPatchAutoApproval(payload) {
  const context = normalizeApprovalPayload(payload, "patch");
  return setScopedAutoApproval(context);
}

export function setFullAccessAutoApproval(payload) {
  const context = normalizeApprovalPayload(payload, "full_access");
  return setScopedAutoApproval(context);
}

export function localizedError(language, key, values = {}) {
  const error = new Error(t(language, key, values));
  error.language = normalizeLanguage(language);
  return error;
}

function pathSecurityOptions(language) {
  const normalized = normalizeLanguage(language);
  return {
    language: normalized,
    message: (key, values) => t(normalized, `tools.${key}`, values)
  };
}

function permissionScopeKey(context) {
  const workspace = normalizeScopeWorkspace(context.workspace || process.cwd());
  const session = String(context.sessionId || "workspace");
  return `${workspace}::${session}`;
}

function normalizeScopeWorkspace(workspace) {
  const resolved = path.resolve(workspace || process.cwd());
  let realPath = resolved;
  try {
    realPath = fsSync.realpathSync.native(resolved);
  } catch {
    realPath = resolved;
  }
  return process.platform === "win32" ? realPath.toLowerCase() : realPath;
}

export function getAutoApprovalState(context) {
  const key = permissionScopeKey(context);
  const now = Date.now();
  const state = autoApprovalScopes.get(key) || {};
  const commandAutoApproval = Boolean(state.commandEnabled) || Number(state.commandExpiresAt || 0) > now;
  const patchAutoApproval = Boolean(state.patchEnabled) || Number(state.patchExpiresAt || 0) > now;
  if (!commandAutoApproval && !patchAutoApproval && autoApprovalScopes.has(key)) {
    autoApprovalScopes.delete(key);
    savePersistedApprovalScopesSync(Object.fromEntries(autoApprovalScopes.entries()));
  }
  return {
    ok: true,
    scope: {
      workspace: normalizeScopeWorkspace(context.workspace || process.cwd()),
      sessionId: String(context.sessionId || "")
    },
    commandAutoApproval,
    patchAutoApproval,
    fullAccessAutoApproval: commandAutoApproval && patchAutoApproval,
    autoApproveFutureCommands: commandAutoApproval,
    commandAutoApprovalExpiresAt: null,
    patchAutoApprovalExpiresAt: null,
    ttlMs: null
  };
}

export function setScopedAutoApproval(context) {
  const key = permissionScopeKey(context);
  const current = autoApprovalScopes.get(key) || {};
  const next = { ...current };
  if (context.kind === "command") {
    next.commandEnabled = Boolean(context.enabled);
    next.commandExpiresAt = 0;
  }
  if (context.kind === "patch") {
    next.patchEnabled = Boolean(context.enabled);
    next.patchExpiresAt = 0;
  }
  if (context.kind === "full_access") {
    next.commandEnabled = Boolean(context.enabled);
    next.commandExpiresAt = 0;
    next.patchEnabled = Boolean(context.enabled);
    next.patchExpiresAt = 0;
  }
  autoApprovalScopes.set(key, next);
  savePersistedApprovalScopesSync(Object.fromEntries(autoApprovalScopes.entries()));
  return getAutoApprovalState(context);
}

export function isAutoApprovalEnabled(kind, context) {
  if (context?.fullAccessAutoApproval) return true;
  const state = getAutoApprovalState(context);
  return kind === "command" ? state.commandAutoApproval : state.patchAutoApproval;
}

export const __test__ = {
  addPatchPath,
  buildWholeFilePatch,
  extractPatchPaths,
  normalizeWorkspacePath,
  resolveInsideWorkspace,
  validatePatchPaths,
  permissionScopeKey,
  normalizeScopeWorkspace,
  setScopedAutoApproval,
  getAutoApprovalState
};
