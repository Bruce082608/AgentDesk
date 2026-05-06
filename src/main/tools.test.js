import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __test__ } from "./tools.js";

const workspace = path.join(os.tmpdir(), "agent-window-test-workspace");

describe("tools path safety", () => {
  it("normalizes safe workspace-relative paths", () => {
    expect(__test__.normalizeWorkspacePath("src/main.ts")).toBe("src/main.ts");
    expect(__test__.normalizeWorkspacePath("src\\main.ts")).toBe("src/main.ts");
  });

  it("rejects absolute and parent traversal paths", () => {
    expect(() => __test__.normalizeWorkspacePath("../secret.txt")).toThrow(/路径不安全/);
    expect(() => __test__.normalizeWorkspacePath("/etc/passwd")).toThrow(/路径不安全/);
    expect(() => __test__.resolveInsideWorkspace(workspace, "../secret.txt")).toThrow(/路径越界/);
  });
});

describe("tools command classification", () => {
  it("allows read-only diagnostic commands", () => {
    expect(__test__.isAutoAllowedCommand("git status --short")).toBe(true);
    expect(__test__.isAutoAllowedCommand("npm run typecheck")).toBe(true);
    expect(__test__.isAutoAllowedCommand("rg TODO src")).toBe(true);
  });

  it("flags destructive commands as dangerous", () => {
    expect(__test__.isDangerousCommand("rm -rf dist")).toBe(true);
    expect(__test__.isDangerousCommand("git reset --hard HEAD")).toBe(true);
    expect(__test__.isDangerousCommand("sudo chmod 777 file")).toBe(true);
  });

  it("does not auto-allow chained shell commands", () => {
    expect(__test__.isAutoAllowedCommand("git status && rm -rf dist")).toBe(false);
  });
});

describe("tools patch path validation", () => {
  it("extracts and validates normal diff paths", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      ""
    ].join("\n");
    expect(__test__.extractPatchPaths(patch)).toEqual(["src/a.ts"]);
    expect(() => __test__.validatePatchPaths(workspace, patch)).not.toThrow();
  });

  it("rejects unsafe patch paths", () => {
    const patch = [
      "diff --git a/../secret.txt b/../secret.txt",
      "--- a/../secret.txt",
      "+++ b/../secret.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      ""
    ].join("\n");
    expect(() => __test__.validatePatchPaths(workspace, patch)).toThrow(/路径不安全/);
  });
});

describe("tools scoped auto approval", () => {
  it("scopes command and patch approvals independently by workspace and session", () => {
    const context = { workspace, sessionId: "s1", kind: "command", enabled: true };
    const commandState = __test__.setScopedAutoApproval(context);
    expect(commandState.commandAutoApproval).toBe(true);
    expect(commandState.patchAutoApproval).toBe(false);

    const otherSession = __test__.getAutoApprovalState({ workspace, sessionId: "s2" });
    expect(otherSession.commandAutoApproval).toBe(false);

    const patchState = __test__.setScopedAutoApproval({ workspace, sessionId: "s1", kind: "patch", enabled: true });
    expect(patchState.commandAutoApproval).toBe(true);
    expect(patchState.patchAutoApproval).toBe(true);
  });
});
