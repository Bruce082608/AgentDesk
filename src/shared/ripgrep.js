import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveInsideWorkspace } from "./pathSecurity.js";

const execFileAsync = promisify(execFile);
export const RIPGREP_COMMAND = process.platform === "win32" ? "rg.exe" : "rg";

export async function searchWorkspaceTextWithRg({
  workspace,
  query,
  maxResults = 50,
  pathOptions = {}
}) {
  const limit = Math.min(Number(maxResults) || 50, 100);
  let stdout = "";

  try {
    ({ stdout } = await execFileAsync(
      RIPGREP_COMMAND,
      [
        "--line-number",
        "--no-heading",
        "--fixed-strings",
        "--color=never",
        "--glob",
        "!{.git,node_modules,dist,build,.next,.vite,coverage}/**",
        String(query ?? ""),
        "."
      ],
      {
        cwd: resolveInsideWorkspace(workspace, ".", pathOptions),
        windowsHide: true,
        maxBuffer: 1_000_000
      }
    ));
  } catch (error) {
    if (error?.code === 1) return { results: [], truncated: false, engine: RIPGREP_COMMAND };
    throw error;
  }

  const results = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line || results.length >= limit) break;
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    results.push({
      file: match[1].replaceAll("\\", "/"),
      line: Number(match[2]),
      text: match[3].slice(0, 240)
    });
  }

  return { results, truncated: results.length >= limit, engine: RIPGREP_COMMAND };
}
