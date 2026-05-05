import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);
const MAX_TREE_FILES = 700;
const MAX_READ_BYTES = 180_000;

export async function getWorkspaceTree(workspace) {
  const root = resolveInsideWorkspace(workspace, ".");
  const items = [];

  async function walk(current, depth) {
    if (items.length >= MAX_TREE_FILES || depth > 5) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (items.length >= MAX_TREE_FILES) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      items.push({
        path: relative,
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        depth
      });
      if (entry.isDirectory()) await walk(absolute, depth + 1);
    }
  }

  await walk(root, 0);
  return { items, truncated: items.length >= MAX_TREE_FILES };
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

  const rgResult = await searchWithRg(workspace, needle, limit).catch(() => null);
  if (rgResult) return rgResult;

  const tree = await getWorkspaceTree(workspace);
  const results = [];
  for (const item of tree.items) {
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

async function searchWithRg(workspace, needle, limit) {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(
      "rg",
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
        cwd: resolveInsideWorkspace(workspace, "."),
        windowsHide: true,
        maxBuffer: 1_000_000
      }
    ));
  } catch (error) {
    if (error?.code === 1) return { results: [], truncated: false, engine: "rg" };
    throw error;
  }

  const results = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line || results.length >= limit) break;
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    results.push({ file: match[1].replaceAll("\\", "/"), line: Number(match[2]), text: match[3].slice(0, 240) });
  }

  return { results, truncated: results.length >= limit, engine: "rg" };
}

function draftCommitMessage(changedFiles) {
  if (changedFiles.length === 0) return "chore: no local changes";
  const hasSource = changedFiles.some((file) => /\.(ts|tsx|js|jsx|css|json|md)$/.test(file.path));
  const verb = hasSource ? "update" : "adjust";
  if (changedFiles.length === 1) return `chore: ${verb} ${changedFiles[0].path}`;
  return `chore: ${verb} ${changedFiles.length} files`;
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
