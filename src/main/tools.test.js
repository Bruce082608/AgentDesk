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

  it("falls back to context matching when git apply cannot use stale hunk line numbers", async () => {
    const testWorkspace = path.join(os.tmpdir(), `agent-window-manual-patch-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.writeFile(path.join(testWorkspace, "target.txt"), "prefix\nold\nsuffix\n", "utf8");
    const patch = [
      "diff --git a/target.txt b/target.txt",
      "--- a/target.txt",
      "+++ b/target.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      ""
    ].join("\n");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({ patch, summary: "Patch with stale line number" })
      }
    }, {
      workspace: testWorkspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));

    expect(result.applied).toBe(true);
    expect(result.strategy).toBe("manual unified diff fallback");
    await expect(fs.readFile(path.join(testWorkspace, "target.txt"), "utf8")).resolves.toBe("prefix\nnew\nsuffix\n");

    await fs.rm(testWorkspace, { recursive: true, force: true });
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
  it("returns a compact workspace map", async () => {
    const testWorkspace = path.join(os.tmpdir(), `agent-window-map-${Date.now()}`);
    await fs.mkdir(path.join(testWorkspace, "src"), { recursive: true });
    await fs.writeFile(path.join(testWorkspace, "package.json"), JSON.stringify({
      name: "map-test",
      scripts: {
        dev: "vite",
        test: "vitest run",
        build: "vite build"
      },
      dependencies: { react: "latest" },
      devDependencies: { vite: "latest", vitest: "latest", typescript: "latest" }
    }), "utf8");
    await fs.writeFile(path.join(testWorkspace, "src", "main.tsx"), "console.log('entry');\n", "utf8");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "workspace_map",
        arguments: JSON.stringify({ include_files: true })
      }
    }, {
      workspace: testWorkspace,
      language: "zh"
    }));

    expect(result.package.name).toBe("map-test");
    expect(result.frameworks).toEqual(expect.arrayContaining(["React", "Vite", "TypeScript", "Vitest"]));
    expect(result.entryFiles).toContain("src/main.tsx");
    expect(result.suggestedCommands).toEqual(expect.arrayContaining(["npm test", "npm run build", "npm run dev"]));

    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  it("reads multiple files and line ranges efficiently", async () => {
    const testWorkspace = path.join(os.tmpdir(), `agent-window-read-tools-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.writeFile(path.join(testWorkspace, "a.txt"), "alpha\nbeta\ngamma\n", "utf8");
    await fs.writeFile(path.join(testWorkspace, "b.txt"), "one\ntwo\nthree\nfour\n", "utf8");

    const batch = JSON.parse(await executeToolCall({
      function: {
        name: "read_files",
        arguments: JSON.stringify({ paths: ["a.txt", "b.txt"], max_chars: 1000 })
      }
    }, {
      workspace: testWorkspace,
      language: "zh"
    }));

    const range = JSON.parse(await executeToolCall({
      function: {
        name: "read_file_range",
        arguments: JSON.stringify({ path: "b.txt", start_line: 2, end_line: 3 })
      }
    }, {
      workspace: testWorkspace,
      language: "zh"
    }));

    expect(batch.files).toHaveLength(2);
    expect(batch.files[0].content).toContain("alpha");
    expect(range.content).toBe("two\nthree");
    expect(range.startLine).toBe(2);
    expect(range.endLine).toBe(3);

    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  it("paginates large tool results and reads follow-up chunks", async () => {
    const testWorkspace = path.join(os.tmpdir(), `agent-window-result-pages-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.writeFile(path.join(testWorkspace, "large.txt"), `${"x".repeat(80_000)}\n`, "utf8");

    const first = JSON.parse(await executeToolCall({
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: "large.txt" })
      }
    }, {
      workspace: testWorkspace,
      language: "zh"
    }));

    expect(first.paginated).toBe(true);
    expect(first.result_id).toBeTruthy();
    expect(first.hasMore).toBe(true);

    const second = JSON.parse(await executeToolCall({
      function: {
        name: "read_result_chunk",
        arguments: JSON.stringify({ result_id: first.result_id, offset: first.nextOffset, max_chars: 5000 })
      }
    }, {
      workspace: testWorkspace,
      language: "zh"
    }));

    expect(second.sourceTool).toBe("read_file");
    expect(second.offset).toBe(first.nextOffset);
    expect(second.chunk.length).toBeGreaterThan(0);

    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  it("replaces exact text immediately in full access mode", async () => {
    const testWorkspace = path.join(os.tmpdir(), `agent-window-replace-text-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    const target = path.join(testWorkspace, "replace.txt");
    await fs.writeFile(target, "hello old world\n", "utf8");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "replace_text",
        arguments: JSON.stringify({ path: "replace.txt", old_text: "old", new_text: "new" })
      }
    }, {
      workspace: testWorkspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));

    expect(result.written).toBe(true);
    expect(result.replacements).toBe(1);
    await expect(fs.readFile(target, "utf8")).resolves.toBe("hello new world\n");

    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  it("queues exact text replacement as a patch in default mode", async () => {
    const testWorkspace = path.join(os.tmpdir(), `agent-window-replace-patch-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.writeFile(path.join(testWorkspace, "replace.txt"), "before\n", "utf8");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "replace_text",
        arguments: JSON.stringify({ path: "replace.txt", old_text: "before", new_text: "after" })
      }
    }, {
      workspace: testWorkspace,
      sessionId: `replace-patch-${Date.now()}`,
      language: "zh"
    }));

    expect(result.pending).toBe(true);
    expect(result.patch).toContain("-before");
    expect(result.patch).toContain("+after");

    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  it("rejects ambiguous exact text replacements", async () => {
    const testWorkspace = path.join(os.tmpdir(), `agent-window-replace-ambiguous-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.writeFile(path.join(testWorkspace, "replace.txt"), "same same\n", "utf8");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "replace_text",
        arguments: JSON.stringify({ path: "replace.txt", old_text: "same", new_text: "other" })
      }
    }, {
      workspace: testWorkspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("匹配了 2 次");
    await expect(fs.readFile(path.join(testWorkspace, "replace.txt"), "utf8")).resolves.toBe("same same\n");

    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

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

  it("adds specific recovery guidance for missing commands", async () => {
    await fs.mkdir(workspace, { recursive: true });
    const result = JSON.parse(await executeToolCall({
      function: {
        name: "run_command",
        arguments: JSON.stringify({ command: "definitely-not-a-real-agentdesk-command" })
      }
    }, {
      workspace,
      sessionId: "missing-command",
      language: "zh",
      fullAccessAutoApproval: true
    }));

    expect(result.ok).toBe(false);
    expect(result.diagnosis).toContain("命令");
    expect(result.suggestedNextSteps.join("\n")).toContain("package.json");
  });

  it("opens a local Playwright browser page and reports diagnostics when available", async () => {
    const html = encodeURIComponent("<!doctype html><title>Browser Tool</title><button id='go' onclick=\"document.body.dataset.clicked='yes'\">Go</button>");
    const opened = JSON.parse(await executeToolCall({
      function: {
        name: "browser_page",
        arguments: JSON.stringify({ action: "open", url: `data:text/html,${html}` })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));

    if (opened.ok === false) {
      expect(opened.suggestedNextSteps.join("\n")).toMatch(/playwright|浏览器|dev server/i);
      return;
    }

    expect(opened.title).toBe("Browser Tool");
    const clicked = JSON.parse(await executeToolCall({
      function: {
        name: "browser_page",
        arguments: JSON.stringify({
          action: "click",
          session_id: opened.sessionId,
          selector: "#go",
          script: "document.body.dataset.clicked"
        })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));
    expect(clicked.consoleErrors).toEqual([]);

    const evaluated = JSON.parse(await executeToolCall({
      function: {
        name: "browser_page",
        arguments: JSON.stringify({
          action: "evaluate",
          session_id: opened.sessionId,
          script: "document.body.dataset.clicked"
        })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));
    expect(evaluated.evaluation).toBe("yes");

    await executeToolCall({
      function: {
        name: "browser_page",
        arguments: JSON.stringify({ action: "close", session_id: opened.sessionId })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true
    });
  });

  it("starts and reads background command sessions", async () => {
    await fs.mkdir(workspace, { recursive: true });
    const started = JSON.parse(await executeToolCall({
      function: {
        name: "start_command",
        arguments: JSON.stringify({ command: "node -e \"setTimeout(() => console.log('session-ready'), 50)\"" })
      }
    }, {
      workspace,
      sessionId: "background-command",
      language: "zh",
      fullAccessAutoApproval: true
    }));

    let output = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      output = JSON.parse(await executeToolCall({
        function: {
          name: "read_command_output",
          arguments: JSON.stringify({ session_id: started.sessionId })
        }
      }, {
        workspace,
        language: "zh"
      }));
      if (String(output.output || "").includes("session-ready")) break;
    }

    expect(started.sessionId).toBeTruthy();
    expect(output.output).toContain("session-ready");
    if (output.running) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      output = JSON.parse(await executeToolCall({
        function: {
          name: "read_command_output",
          arguments: JSON.stringify({ session_id: started.sessionId })
        }
      }, {
        workspace,
        language: "zh"
      }));
    }
    expect(output.running).toBe(false);
  });

  it("stops background command sessions", async () => {
    await fs.mkdir(workspace, { recursive: true });
    const started = JSON.parse(await executeToolCall({
      function: {
        name: "start_command",
        arguments: JSON.stringify({ command: "node -e \"setInterval(() => console.log('tick'), 50)\"" })
      }
    }, {
      workspace,
      sessionId: "background-command-stop",
      language: "zh",
      fullAccessAutoApproval: true
    }));

    const stopped = JSON.parse(await executeToolCall({
      function: {
        name: "stop_command",
        arguments: JSON.stringify({ session_id: started.sessionId })
      }
    }, {
      workspace,
      language: "zh"
    }));

    expect(stopped.stopped).toBe(true);
    expect(stopped.sessionId).toBe(started.sessionId);
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

  it("allows full access file tools to operate outside the workspace", async () => {
    await fs.mkdir(workspace, { recursive: true });
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-window-full-access-"));
    const externalFile = path.join(externalDir, "outside.txt");

    const writeResult = JSON.parse(await executeToolCall({
      function: {
        name: "write_file",
        arguments: JSON.stringify({ path: externalFile, content: "outside workspace" })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));

    const readResult = JSON.parse(await executeToolCall({
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: externalFile })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true,
      attachments: []
    }));

    const listResult = JSON.parse(await executeToolCall({
      function: {
        name: "list_files",
        arguments: JSON.stringify({ directory: externalDir })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));

    const deleteResult = JSON.parse(await executeToolCall({
      function: {
        name: "delete_file",
        arguments: JSON.stringify({ path: externalFile })
      }
    }, {
      workspace,
      language: "zh",
      fullAccessAutoApproval: true
    }));

    expect(writeResult.written).toBe(true);
    expect(readResult.result).toBe("outside workspace");
    expect(listResult.files).toContain(externalFile);
    expect(deleteResult.deleted).toBe(true);
    await expect(fs.stat(externalFile)).rejects.toMatchObject({ code: "ENOENT" });

    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("applies full access patches outside the workspace", async () => {
    await fs.mkdir(workspace, { recursive: true });
    const externalFile = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-window-patch-access-")));
    const targetFile = path.join(externalFile, "target.txt");
    await fs.writeFile(targetFile, "old\n", "utf8");
    const patch = [
      `--- ${targetFile}`,
      `+++ ${targetFile}`,
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n");

    const result = JSON.parse(await executeToolCall({
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({ patch, summary: "Patch outside workspace" })
      }
    }, {
      workspace,
      sessionId: "full-access-patch-outside",
      language: "zh",
      fullAccessAutoApproval: true
    }));

    expect(result.applied).toBe(true);
    await expect(fs.readFile(targetFile, "utf8")).resolves.toMatch(/^new\r?\n$/);

    await fs.rm(externalFile, { recursive: true, force: true });
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
