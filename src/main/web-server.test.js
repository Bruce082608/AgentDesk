import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { startWebServer, stopWebServer } from "./web-server.js";

// Mock Electron
vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/mock/app/path"
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
  listPendingApprovals: vi.fn().mockResolvedValue([])
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
});
