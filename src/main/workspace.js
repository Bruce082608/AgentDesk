import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { resolveInsideWorkspace } from "../shared/pathSecurity.js";
import { searchWorkspaceTextWithRg } from "../shared/ripgrep.js";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MAX_TREE_ITEMS = 700;
const MAX_READ_BYTES = 180_000;
const MAX_INDEX_FILES = 2500;
const MAX_INDEX_DEPTH = 8;
const workspaceIndexCache = new Map();

export async function getWorkspaceTree(workspace, directory = "") {
  const root = resolveInsideWorkspace(workspace, ".");
  const currentDirectory = resolveInsideWorkspace(workspace, directory || ".");
  const baseDepth = directory ? String(directory).split(/[\\/]/).filter(Boolean).length : 0;
  const items = [];
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (items.length >= MAX_TREE_ITEMS) break;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(currentDirectory, entry.name);
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    const isDirectory = entry.isDirectory();
    items.push({
      path: relative,
      name: entry.name,
      type: isDirectory ? "directory" : "file",
      depth: baseDepth,
      loaded: false,
      hasChildren: isDirectory ? await directoryHasVisibleEntries(absolute) : false
    });
  }

  return { directory: directory || "", items, truncated: items.length >= MAX_TREE_ITEMS };
}

export async function readWorkspaceFile(workspace, filePath) {
  const absolute = resolveInsideWorkspace(workspace, filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`${filePath} 不是文件。`);
  if (stat.size > MAX_READ_BYTES) throw new Error(`${filePath} 太大，无法预览。`);
  return { path: filePath, content: await fs.readFile(absolute, "utf8") };
}

export async function searchWorkspaceFiles(workspace, query, maxResults = 50) {
  const needle = String(query ?? "").trim();
  if (!needle) return { results: [], truncated: false, engine: "none" };
  const limit = Math.min(Number(maxResults) || 50, 100);

  const rgResult = await searchWorkspaceTextWithRg({ workspace, query: needle, maxResults: limit }).catch(() => null);
  if (rgResult) return rgResult;

  const index = await getWorkspaceSearchIndex(workspace);
  if (!index.files.length) return { results: [], truncated: false, engine: "index-empty" };

  const results = [];
  for (const file of index.files) {
    if (results.length >= limit) break;
    const content = await readIndexedFile(workspace, file.path, file.signature).catch(() => null);
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    for (let indexLine = 0; indexLine < lines.length; indexLine += 1) {
      if (lines[indexLine].includes(needle)) {
        results.push({ file: file.path, line: indexLine + 1, text: lines[indexLine].slice(0, 240) });
        if (results.length >= limit) break;
      }
    }
  }

  return { results, truncated: results.length >= limit, engine: "indexed-fallback" };
}

async function getWorkspaceSearchIndex(workspace) {
  const root = resolveInsideWorkspace(workspace, ".");
  const snapshot = await buildWorkspaceSnapshot(root);
  const cacheKey = normalizeWorkspaceKey(root);
  const cached = workspaceIndexCache.get(cacheKey);
  if (cached && cached.snapshot === snapshot) return cached.index;

  const index = await buildWorkspaceIndex(root);
  workspaceIndexCache.set(cacheKey, { snapshot, index });
  if (workspaceIndexCache.size > 20) {
    const oldest = workspaceIndexCache.keys().next().value;
    if (oldest) workspaceIndexCache.delete(oldest);
  }
  return index;
}

async function buildWorkspaceSnapshot(root) {
  const stat = await fs.stat(root);
  const files = [];

  async function walk(current, depth) {
    if (files.length >= MAX_INDEX_FILES || depth > MAX_INDEX_DEPTH) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        const fileStat = await fs.stat(absolute).catch(() => null);
        if (fileStat) {
          files.push(`${path.relative(root, absolute).replaceAll("\\", "/")}:${fileStat.size}:${fileStat.mtimeMs}`);
        }
      }
    }
  }

  await walk(root, 0);
  return createHash("sha1").update([stat.mtimeMs, stat.size, ...files].join("|")).digest("hex");
}

async function buildWorkspaceIndex(root) {
  const files = [];

  async function walk(current, depth) {
    if (files.length >= MAX_INDEX_FILES || depth > MAX_INDEX_DEPTH) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolute).catch(() => null);
        if (!stat) continue;
        files.push({
          path: path.relative(root, absolute).replaceAll("\\", "/"),
          signature: `${stat.size}:${stat.mtimeMs}`
        });
      }
    }
  }

  await walk(root, 0);
  return { files };
}

async function readIndexedFile(workspace, filePath, signature) {
  const absolute = resolveInsideWorkspace(workspace, filePath);
  const stat = await fs.stat(absolute);
  const nextSignature = `${stat.size}:${stat.mtimeMs}`;
  if (signature && signature !== nextSignature) return null;
  return fs.readFile(absolute, "utf8");
}

async function directoryHasVisibleEntries(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.some((entry) => !(entry.isDirectory() && SKIP_DIRS.has(entry.name)));
  } catch {
    return false;
  }
}

export async function getGitSummary(workspace) {
  const branch = await runGit(workspace, ["branch", "--show-current"]).catch(() => "");
  const status = await runGit(workspace, ["status", "--short"]).catch(() => "");
  const changedFiles = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim() || "?", path: line.slice(3).trim() }));

  return {
    branch: branch.trim() || "(detached)",
    changedFiles,
    commitDraft: draftCommitMessage(changedFiles)
  };
}

export async function getGitDiff(workspace) {
  const diff = await runGit(workspace, ["diff", "--", "."]);
  return { diff };
}

async function runGit(workspace, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: resolveInsideWorkspace(workspace, "."),
    windowsHide: true,
    maxBuffer: 2_000_000
  });
  return stdout;
}

function draftCommitMessage(changedFiles) {
  if (changedFiles.length === 0) return "chore: no local changes";
  const hasSource = changedFiles.some((file) => /\.(ts|tsx|js|jsx|css|json|md)$/.test(file.path));
  const verb = hasSource ? "update" : "adjust";
  if (changedFiles.length === 1) return `chore: ${verb} ${changedFiles[0].path}`;
  return `chore: ${verb} ${changedFiles.length} files`;
}

function normalizeWorkspaceKey(workspace) {
  return workspace.toLowerCase().replaceAll("\\", "/");
}

export const __test__ = {
  draftCommitMessage,
  resolveInsideWorkspace
};
