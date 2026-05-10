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

const execFileAsync = promisify(execFile);
const pendingPatches = new Map();
const autoApprovalScopes = new Map();

export async function proposePatch(context, patch, summary = "") {
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

export function validatePatchPaths(workspace, patchText, language) {
  const paths = extractPatchPaths(patchText, language);
  if (paths.length === 0) {
    throw localizedError(language, "tools.invalidPatch");
  }

  for (const filePath of paths) {
    resolveInsideWorkspace(workspace, filePath, language);
  }
}

export function extractPatchPaths(patchText, language = "zh") {
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
  return getAutoApprovalState(context);
}

export function isAutoApprovalEnabled(kind, context) {
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
