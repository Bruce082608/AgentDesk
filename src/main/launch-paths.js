import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function extractLaunchPaths(argv, { isPackaged = false, cwd = process.cwd() } = {}) {
  const args = Array.isArray(argv) ? argv.slice(isPackaged ? 1 : 2) : [];
  const candidates = args
    .map(normalizeLaunchArg)
    .filter((arg) => arg && !arg.startsWith("-"))
    .map((arg) => path.isAbsolute(arg) ? path.normalize(arg) : path.resolve(cwd, arg));
  return [...new Set(candidates)];
}

export async function classifyLaunchPaths(paths) {
  const files = [];
  const directories = [];
  const missing = [];

  for (const item of [...new Set((paths || []).map((value) => String(value || "").trim()).filter(Boolean))]) {
    try {
      const absolute = path.resolve(item);
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) {
        directories.push(absolute);
      } else if (stat.isFile()) {
        files.push(absolute);
      }
    } catch {
      missing.push(item);
    }
  }

  return {
    paths: [...directories, ...files],
    directories,
    files,
    missing,
    workspaceHint: directories[0] || (files[0] ? path.dirname(files[0]) : "")
  };
}

function normalizeLaunchArg(value) {
  let arg = String(value || "").trim();
  if (!arg) return "";
  if ((arg.startsWith("\"") && arg.endsWith("\"")) || (arg.startsWith("'") && arg.endsWith("'"))) {
    arg = arg.slice(1, -1);
  }
  if (arg.startsWith("file://")) {
    try {
      return fileURLToPath(arg);
    } catch {
      return "";
    }
  }
  return arg;
}
