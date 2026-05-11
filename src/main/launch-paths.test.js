import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { classifyLaunchPaths, extractLaunchPaths } from "./launch-paths.js";

describe("launch path handling", () => {
  it("extracts packaged and development file arguments", () => {
    expect(extractLaunchPaths(["AgentDesk", "/tmp/work/file.txt"], { isPackaged: true, cwd: "/tmp/work" })).toEqual([
      path.normalize("/tmp/work/file.txt")
    ]);
    expect(extractLaunchPaths(["electron", ".", "file.txt"], { isPackaged: false, cwd: "/tmp/work" })).toEqual([
      path.resolve("/tmp/work/file.txt")
    ]);
  });

  it("classifies files, directories, and workspace hints", async () => {
    const root = path.join(os.tmpdir(), `agentdesk-launch-${Date.now()}`);
    const file = path.join(root, "note.txt");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(file, "hello", "utf8");

    const result = await classifyLaunchPaths([file]);
    expect(result.files).toEqual([file]);
    expect(result.directories).toEqual([]);
    expect(result.workspaceHint).toBe(root);

    await fs.rm(root, { recursive: true, force: true });
  });
});
