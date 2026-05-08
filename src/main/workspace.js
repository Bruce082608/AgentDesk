import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveInsideWorkspace } from "../shared/pathSecurity.js";
import { searchWorkspaceTextWithRg } from "../shared/ripgrep.js";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MAX_TREE_ITEMS = 700;
const MAX_READ_BYTES = 180_000;

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

  const tree = await getSearchableWorkspaceFiles(workspace);
  const results = [];
  for (const item of tree) {
    if (results.length >= limit) break;
    if (item.type !== "file") continue;
    try {
      const file = await readWorkspaceFile(workspace, item.path);
      const lines = file.content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes(needle)) {
          results.push({ file: item.path, line: index + 1, text: lines[index].slice(0, 240) });
          if (results.length >= limit) break;
        }
      }
    } catch {
      continue;
    }
  }

  return { results, truncated: results.length >= limit, engine: "fallback" };
}

async function getSearchableWorkspaceFiles(workspace) {
  const root = resolveInsideWorkspace(workspace, ".");
  const files = [];

  async function walk(current, depth) {
    if (files.length >= MAX_TREE_ITEMS || depth > 8) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        files.push({ path: path.relative(root, absolute).replaceAll("\\", "/") });
      }
      if (files.length >= MAX_TREE_ITEMS) break;
    }
  }

  await walk(root, 0);
  return files;
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

export const __test__ = {
  draftCommitMessage,
  resolveInsideWorkspace
};
