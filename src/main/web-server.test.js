import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startWebServer, stopWebServer } from "./web-server.js";
import { runAgentTurn, resumeAgentContinuation } from "./agent.js";
import { savePersistedSessions, loadPersistedSkills, savePersistedSkills } from "./persistence.js";
import { getAutoApprovalState } from "./patch-approval.js";

// Mock Electron
vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/mock/app/path",
    getPath: () => path.join(os.tmpdir(), "agentdesk-web-server-test-user-data")
  }
}));

// Mock all imported modules to isolate the web server
vi.mock("./agent.js", () => ({
  runAgentTurn: vi.fn(),
  resumeAgentContinuation: vi.fn()
}));

vi.mock("./workspace.js", () => ({
  getWorkspaceTree: vi.fn().mockResolvedValue({ items: [] }),
  readWorkspaceFile: vi.fn().mockResolvedValue({ content: "mock-content" }),
  searchWorkspaceFiles: vi.fn().mockResolvedValue({ results: [] }),
  getGitSummary: vi.fn().mockResolvedValue({ branch: "main", changedFiles: [] }),
  getGitDiff: vi.fn().mockResolvedValue({ diff: "mock-diff" })
}));

vi.mock("./persistence.js", () => ({
  loadPersistedSessions: vi.fn().mockResolvedValue([{ id: "1" }]),
  savePersistedSessions: vi.fn().mockResolvedValue({ ok: true }),
  loadPersistedActivityEvents: vi.fn().mockResolvedValue([]),
  savePersistedActivityEvents: vi.fn().mockResolvedValue({ ok: true }),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  loadPersistedSkills: vi.fn().mockResolvedValue([]),
  savePersistedSkills: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock("./config.js", () => ({
  loadAppConfig: vi.fn().mockResolvedValue({ model: "deepseek" }),
  saveAppConfig: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock("../shared/tokenCounter.js", () => ({
  countAgentRequestTokens: vi.fn().mockReturnValue(42)
}));

vi.mock("./attachments.js", () => ({
  readAttachmentFiles: vi.fn().mockResolvedValue([])
}));

vi.mock("./providers.js", () => ({
  testProviderConnection: vi.fn().mockResolvedValue({ ok: true }),
  getProviderBalance: vi.fn().mockResolvedValue({ is_available: true, balance_infos: [] })
}));

vi.mock("./tools.js", () => ({
  setCommandAutoApproval: vi.fn().mockResolvedValue({ ok: true }),
  setPatchAutoApproval: vi.fn().mockResolvedValue({ ok: true }),
  setFullAccessAutoApproval: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock("./patch-approval.js", () => ({
  getAutoApprovalState: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock("./git-updates.js", () => ({
  checkGitUpdate: vi.fn().mockResolvedValue({ updateAvailable: false }),
  applyGitUpdate: vi.fn().mockResolvedValue({ success: true })
}));

describe("web-server", () => {
  let authToken = "";

  beforeAll(() => {
    const state = startWebServer();
    authToken = state.token;
  });

  afterAll(() => {
    stopWebServer();
  });

  it("should restrict access without token", async () => {
    const resUnauthorized = await fetch("http://localhost:5179/api/sessions");
    expect(resUnauthorized.status).toBe(401);
    const jsonUnauthorized = await resUnauthorized.json();
    expect(jsonUnauthorized.error).toBe("Unauthorized");
  });

  it("should allow access with token query parameter", async () => {
    const resAuthorizedQuery = await fetch(`http://localhost:5179/api/sessions?token=${authToken}`);
    expect(resAuthorizedQuery.status).toBe(200);
    const jsonSessionsQuery = await resAuthorizedQuery.json();
    expect(jsonSessionsQuery).toEqual([{ id: "1" }]);
  });

  it("should allow access with token header", async () => {
    const resAuthorizedHeader = await fetch("http://localhost:5179/api/sessions", {
      headers: { "X-API-Token": authToken }
    });
    expect(resAuthorizedHeader.status).toBe(200);
    const jsonSessionsHeader = await resAuthorizedHeader.json();
    expect(jsonSessionsHeader).toEqual([{ id: "1" }]);
  });

  it("should handle config GET and POST routes", async () => {
    // GET
    const resGet = await fetch("http://localhost:5179/api/config", {
      headers: { "X-API-Token": authToken }
    });
    expect(resGet.status).toBe(200);
    const jsonGet = await resGet.json();
    expect(jsonGet.config.model).toBe("deepseek");

    // POST
    const resPost = await fetch("http://localhost:5179/api/config", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "custom-model" })
    });
    expect(resPost.status).toBe(200);
    const jsonPost = await resPost.json();
    expect(jsonPost.ok).toBe(true);
  });

  it("should handle git summary and diff routes", async () => {
    // Git Summary
    const resSummary = await fetch("http://localhost:5179/api/git/summary", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ workspace: "/mock/workspace" })
    });
    expect(resSummary.status).toBe(200);
    const jsonSummary = await resSummary.json();
    expect(jsonSummary.branch).toBe("main");

    // Git Diff
    const resDiff = await fetch("http://localhost:5179/api/git/diff", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ workspace: "/mock/workspace" })
    });
    expect(resDiff.status).toBe(200);
    const jsonDiff = await resDiff.json();
    expect(jsonDiff.diff).toBe("mock-diff");
  });

  it("rejects malformed Web API payloads with 400 before services run", async () => {
    const res = await fetch("http://localhost:5179/api/file/read", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ workspace: "/mock/workspace", path: "" })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Invalid IPC payload/);
  });

  it("rejects non-array persisted collections instead of silently clearing them", async () => {
    const res = await fetch("http://localhost:5179/api/sessions", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: "not-an-array" })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/sessions must be an array/);
    expect(savePersistedSessions).not.toHaveBeenCalled();
  });

  it("validates agent send payloads before starting an agent turn", async () => {
    const res = await fetch("http://localhost:5179/api/agent/send", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ requestId: "req-1", input: "hello" })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/workspace must be a non-empty string/);
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it("validates resume payloads before continuing an agent turn", async () => {
    const res = await fetch("http://localhost:5179/api/agent/resume", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ requestId: "req-2", kind: "patch", decision: "approved" })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/continuationId must be a non-empty string/);
    expect(resumeAgentContinuation).not.toHaveBeenCalled();
  });

  it("validates permission payloads before reading approval state", async () => {
    const res = await fetch("http://localhost:5179/api/permissions/state", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: true, workspace: "" })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/workspace must be a non-empty string/);
    expect(getAutoApprovalState).not.toHaveBeenCalled();
  });

  it("handles skills routes with persistence mocks wired", async () => {
    const resGet = await fetch("http://localhost:5179/api/skills", {
      headers: { "X-API-Token": authToken }
    });
    expect(resGet.status).toBe(200);
    expect(await resGet.json()).toEqual([]);
    expect(loadPersistedSkills).toHaveBeenCalled();

    const resPost = await fetch("http://localhost:5179/api/skills", {
      method: "POST",
      headers: {
        "X-API-Token": authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([])
    });
    expect(resPost.status).toBe(200);
    expect(savePersistedSkills).toHaveBeenCalledWith([]);
  });

  it("serves media only from allowed local roots", async () => {
    const mediaPath = path.join(os.tmpdir(), `agentdesk-web-media-${Date.now()}.txt`);
    await fs.writeFile(mediaPath, "media-ok", "utf8");

    try {
      const res = await fetch(`http://localhost:5179/api/media?token=${authToken}&path=${encodeURIComponent(mediaPath)}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("media-ok");
    } finally {
      await fs.rm(mediaPath, { force: true });
    }
  });

  it("blocks media reads outside allowed roots", async () => {
    const res = await fetch(`http://localhost:5179/api/media?token=${authToken}&path=${encodeURIComponent("/etc/passwd")}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("does not serve directories through the media route", async () => {
    const res = await fetch(`http://localhost:5179/api/media?token=${authToken}&path=${encodeURIComponent(os.tmpdir())}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});
