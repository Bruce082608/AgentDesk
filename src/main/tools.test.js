import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __test__, executeToolCall } from "./tools.js";

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
    expect(commandState.commandAutoApprovalExpiresAt).toBeNull();
    expect(commandState.ttlMs).toBeNull();

    const otherSession = __test__.getAutoApprovalState({ workspace, sessionId: "s2" });
    expect(otherSession.commandAutoApproval).toBe(false);

    const patchState = __test__.setScopedAutoApproval({ workspace, sessionId: "s1", kind: "patch", enabled: true });
    expect(patchState.commandAutoApproval).toBe(true);
    expect(patchState.patchAutoApproval).toBe(true);
    expect(patchState.patchAutoApprovalExpiresAt).toBeNull();
  });

  it("normalizes auto-approval workspace scope paths", () => {
    const normalized = __test__.normalizeScopeWorkspace(workspace);
    expect(path.isAbsolute(normalized)).toBe(true);
    if (process.platform === "win32") {
      expect(normalized).toBe(normalized.toLowerCase());
    }
  });

  it("toggles full access as command and patch approval together", () => {
    const context = { workspace, sessionId: "full-access", kind: "full_access", enabled: true };
    const enabled = __test__.setScopedAutoApproval(context);
    expect(enabled.commandAutoApproval).toBe(true);
    expect(enabled.patchAutoApproval).toBe(true);
    expect(enabled.fullAccessAutoApproval).toBe(true);

    const disabled = __test__.setScopedAutoApproval({ ...context, enabled: false });
    expect(disabled.commandAutoApproval).toBe(false);
    expect(disabled.patchAutoApproval).toBe(false);
    expect(disabled.fullAccessAutoApproval).toBe(false);
  });
});

describe("tool execution permissions", () => {
  it("persists normalized pending patches for approval resume", async () => {
    const patch = [
      "```diff",
      "diff --git a/example.txt b/example.txt",
      "--- a/example.txt",
      "+++ b/example.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "```"
    ].join("\n");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({ patch, summary: "Update example" })
      }
    }, {
      workspace,
      sessionId: "patch-normalization",
      language: "zh"
    }));

    expect(result.pending).toBe(true);
    expect(result.patch).toContain("diff --git a/example.txt b/example.txt");
    expect(result.patch).not.toContain("```");
  });

  it("runs non-allowlisted commands when full access is supplied on the request", async () => {
    await fs.mkdir(workspace, { recursive: true });
    const result = JSON.parse(await executeToolCall({
      function: {
        name: "run_command",
        arguments: JSON.stringify({ command: "node -e \"console.log('full-access-ok')\"" })
      }
    }, {
      workspace,
      sessionId: "request-full-access",
      language: "zh",
      fullAccessAutoApproval: true
    }));

    expect(result.pending).toBeUndefined();
    expect(result.stdout).toContain("full-access-ok");
  });

  it("allows read-only access to exact files attached from outside the workspace", async () => {
    const externalFile = path.join(os.tmpdir(), `agent-window-external-${Date.now()}.txt`);
    await fs.writeFile(externalFile, "external attachment content", "utf8");

    const allowed = JSON.parse(await executeToolCall({
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: externalFile })
      }
    }, {
      workspace,
      language: "zh",
      attachments: [{ path: externalFile }]
    }));

    const blocked = JSON.parse(await executeToolCall({
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: externalFile })
      }
    }, {
      workspace,
      language: "zh",
      attachments: []
    }));

    expect(allowed.result).toBe("external attachment content");
    expect(blocked.ok).toBe(false);
    expect(blocked.errorType).toBe("path_security");

    await fs.rm(externalFile, { force: true });
  });

  it("allows attached PDFs from outside the workspace through read_file", async () => {
    const externalPdf = path.join(os.tmpdir(), `agent-window-external-${Date.now()}.pdf`);
    await fs.writeFile(externalPdf, createTinyPdf("External PDF content"), "ascii");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: externalPdf })
      }
    }, {
      workspace,
      language: "zh",
      attachments: [{ path: externalPdf }]
    }));

    expect(result.result).toContain("PDF | 1 pages");
    expect(result.result).toContain("External PDF content");

    await fs.rm(externalPdf, { force: true });
  });
});

function createTinyPdf(text) {
  const escaped = text.replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 18 Tf 50 80 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}
