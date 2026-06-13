import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { searchWorkspaceTextWithRg } from "../../shared/ripgrep.js";
import { resolveInsideWorkspace, localizedError } from "../patch-approval.js";
import { listFiles, readFile, pathSecurityOptions } from "./file-tools.js";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage"]);

export async function searchFiles(workspace, query, maxResults, language) {
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

export async function workspaceMap(context, args = {}) {
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
    "src/main.ts",
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

export function objectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(value).map((key) => [key, true]));
}

export async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function detectFrameworks(dependencies, root) {
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

export async function findExistingWorkspaceFiles(root, candidates) {
  const found = [];
  for (const candidate of candidates) {
    const absolute = path.join(root, candidate);
    const stat = await fs.stat(absolute).catch(() => null);
    if (stat?.isFile()) found.push(candidate);
  }
  return found;
}

export async function listTopLevelDirectories(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function sampleWorkspaceFiles(root, maxFiles) {
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

export async function getWorkspaceGitMap(root) {
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

export async function runGitCommand(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1_000_000
  });
  return stdout;
}

export function suggestWorkspaceCommands(scripts) {
  const names = new Set(Object.keys(scripts || {}));
  const commands = [];
  for (const name of ["test", "typecheck", "lint", "build", "dev"]) {
    if (names.has(name)) commands.push(`npm run ${name}`);
  }
  if (names.has("test")) commands.unshift("npm test");
  return [...new Set(commands)];
}
