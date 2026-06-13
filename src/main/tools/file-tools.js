import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { normalizeLanguage, t } from "../i18n.js";
import { extractPdfText, isPdfExtension, looksBinaryBuffer } from "../../shared/pdfReader.js";
import {
  buildWholeFilePatch,
  isAutoApprovalEnabled,
  localizedError,
  normalizeWorkspacePath,
  proposePatch,
  resolveInsideWorkspace
} from "../patch-approval.js";

const MAX_FILE_BYTES = 120_000;
const MAX_RANGE_FILE_BYTES = 2_000_000;
const MAX_READ_FILES = 20;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);

export async function listFiles(context, directory, maxFiles) {
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

export async function readFile(context, filePath) {
  const language = context.language;
  const absolute = resolveReadableFilePath(context, filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw localizedError(language, "tools.notFile", { path: filePath });

  if (isPdfExtension(filePath)) {
    const result = await extractPdfText(absolute);
    if (result.error) {
      throw localizedError(language, "tools.pdfError", {
        path: filePath,
        message: result.error
      });
    }
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

  if (stat.size > MAX_FILE_BYTES) {
    throw localizedError(language, "tools.fileTooLarge", {
      path: filePath,
      size: stat.size,
      limit: MAX_FILE_BYTES
    });
  }

  const buffer = await fs.readFile(absolute);
  if (looksBinaryBuffer(buffer)) {
    throw localizedError(language, "tools.binaryFile", { path: filePath });
  }

  return buffer.toString("utf8");
}

export async function readFiles(context, paths, maxChars, perFileMaxChars) {
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
      const message = error instanceof Error ? error.message : String(error);
      const code = typeof error?.code === "string" ? error.code : "";
      const detail = [error?.stderr, error?.stdout].filter(Boolean).join("\n").trim();
      const lower = `${code} ${message} ${detail}`.toLowerCase();
      let type = "unknown";
      if (code === "ENOENT" || /no such file|not found|不存在|找不到/.test(lower)) type = "file_not_found";
      else if (code === "EACCES" || code === "EPERM" || /permission denied|operation not permitted|权限/.test(lower)) type = "permission_denied";
      else if (/路径越界|路径不安全|unsafe|outside workspace/.test(lower)) type = "path_security";

      files.push({
        path: filePath,
        ok: false,
        error: message,
        errorType: type,
        detail
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

export async function readFileRange(context, filePath, startLine, endLine) {
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

export function formatToolBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function writeFile(context, filePath, content, summary = "") {
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

export async function deleteFile(context, filePath, summary = "") {
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

export async function replaceText(context, args = {}) {
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

// Path Resolution and Security helpers

export function resolveReadableFilePath(context, filePath) {
  const requestedPath = String(filePath ?? "");
  if (isFullAccess(context)) return resolveAnyPath(context, requestedPath);
  if (path.isAbsolute(requestedPath)) {
    const absolute = path.resolve(requestedPath);
    if (isAttachedPathAllowed(absolute, context.attachments)) return absolute;
  }
  return resolveInsideWorkspace(context.workspace, requestedPath, context.language);
}

export function resolveDirectoryPath(context, directory) {
  const requestedPath = String(directory ?? "").trim();
  if (isFullAccess(context)) return resolveAnyPath(context, requestedPath || ".");
  return resolveInsideWorkspace(context.workspace, requestedPath || ".", context.language);
}

export function resolveCommandCwd(context, cwdInput = "") {
  const requestedPath = String(cwdInput ?? "").trim();
  if (!requestedPath) return path.resolve(context.workspace || process.cwd());
  if (isFullAccess(context)) return resolveAnyPath(context, requestedPath);
  return resolveInsideWorkspace(context.workspace, requestedPath, context.language);
}

export function resolveMutableFilePath(context, filePath) {
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

export function resolveAnyPath(context, filePath) {
  const requestedPath = requireToolPath(filePath, context.language);
  return path.resolve(context.workspace || process.cwd(), expandHomePath(requestedPath));
}

export function requireToolPath(filePath, language) {
  const requestedPath = String(filePath ?? "").trim();
  if (!requestedPath) throw localizedError(language, "tools.emptyPath");
  return requestedPath;
}

export function expandHomePath(filePath) {
  const value = String(filePath ?? "");
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function formatFullAccessDisplayPath(requestedPath, absolute) {
  if (path.isAbsolute(expandHomePath(requestedPath))) return absolute;
  return requestedPath.replaceAll("\\", "/");
}

export function isOutsideWorkspace(workspaceRoot, targetPath) {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

export function isFullAccess(context) {
  return Boolean(context?.fullAccessAutoApproval);
}

export function isAttachedPathAllowed(absolutePath, attachmentPaths) {
  const comparable = normalizeComparablePath(absolutePath);
  return attachmentPaths.includes(comparable);
}

export function normalizeComparablePath(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function pathSecurityOptions(language) {
  const normalized = normalizeLanguage(language);
  return {
    language: normalized,
    message: (key, values) => t(normalized, `tools.${key}`, values)
  };
}

export function normalizeAttachmentPaths(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((file) => typeof file?.path === "string" ? normalizeComparablePath(file.path) : "")
    .filter(Boolean);
}

export function normalizeToolContext(context) {
  if (typeof context === "string") {
    return { workspace: context, requestId: "", sessionId: "", language: "zh", fullAccessAutoApproval: false, attachments: [], emit: undefined };
  }
  return {
    workspace: context?.workspace || process.cwd(),
    requestId: String(context?.requestId || ""),
    sessionId: String(context?.sessionId || ""),
    language: normalizeLanguage(context?.language),
    fullAccessAutoApproval: Boolean(context?.fullAccessAutoApproval),
    attachments: normalizeAttachmentPaths(context?.attachments),
    emit: typeof context?.emit === "function" ? context.emit : undefined
  };
}
