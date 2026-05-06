import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __test__ } from "./workspace.js";

describe("workspace path safety", () => {
  const workspace = path.join(os.tmpdir(), "agent-window-test-workspace");

  it("resolves paths inside the workspace", () => {
    expect(__test__.resolveInsideWorkspace(workspace, "src/App.tsx")).toBe(path.join(workspace, "src/App.tsx"));
  });

  it("rejects paths outside the workspace", () => {
    expect(() => __test__.resolveInsideWorkspace(workspace, "../outside.txt")).toThrow(/路径越界/);
  });
});
