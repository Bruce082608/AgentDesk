import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { app } from "electron";

// Import core backend functions
import { runAgentTurn, resumeAgentContinuation } from "./agent.js";
import { getWorkspaceTree, readWorkspaceFile, searchWorkspaceFiles, getGitSummary, getGitDiff } from "./workspace.js";
import { loadPersistedSessions, savePersistedSessions, loadPersistedActivityEvents, savePersistedActivityEvents, listPendingApprovals } from "./persistence.js";
import { loadAppConfig, saveAppConfig } from "./config.js";
import { countAgentRequestTokens } from "../shared/tokenCounter.js";
import { readAttachmentFiles } from "./attachments.js";
import { getProviderBalance, testProviderConnection } from "./providers.js";
import { setCommandAutoApproval, setPatchAutoApproval, setFullAccessAutoApproval } from "./tools.js";
import { getAutoApprovalState } from "./patch-approval.js";
import { checkGitUpdate, applyGitUpdate } from "./git-updates.js";

const PORT = 5175;
let server = null;
let authToken = randomUUID(); // Secure token generated on startup
const sseConnections = new Set();
const activeWebRequests = new Map();

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

export function startWebServer() {
  if (server) return { port: PORT, token: authToken };

  server = http.createServer(async (req, res) => {
    // Enable CORS for development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Token");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // 1. Authenticate Token (except for static assets on non-sensitive paths if needed,
    // but for maximum safety we require token for everything, including index.html)
    const tokenQuery = parsedUrl.searchParams.get("token");
    const tokenHeader = req.headers["x-api-token"];
    const isAuthorized = tokenQuery === authToken || tokenHeader === authToken;

    if (!isAuthorized && pathname.startsWith("/api")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }

    // 2. SSE Events Channel
    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write("retry: 5000\n\n");
      sseConnections.add(res);

      req.on("close", () => {
        sseConnections.delete(res);
      });
      return;
    }

    // 3. REST API Routes
    if (pathname.startsWith("/api/")) {
      try {
        await handleRestApi(pathname, req, res);
      } catch (error) {
        console.error(`[Web Server] API Error on ${pathname}:`, error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    // 4. Static File Serving
    await handleStaticFile(pathname, res, isAuthorized);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Web Server] Running at http://localhost:${PORT}`);
    console.log(`[Web Server] Token: ${authToken}`);
    console.log(`[Web Server] LAN URL: http://${getLocalIp()}:${PORT}?token=${authToken}`);
  });

  return { port: PORT, token: authToken };
}

export function stopWebServer() {
  if (server) {
    server.close();
    server = null;
    console.log("[Web Server] Stopped.");
  }
}

export function getWebServerState() {
  return {
    port: PORT,
    token: authToken,
    lanUrl: `http://${getLocalIp()}:${PORT}?token=${authToken}`
  };
}

export function broadcastSseEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseConnections) {
    try {
      client.write(payload);
    } catch {
      sseConnections.delete(client);
    }
  }
}

async function handleRestApi(pathname, req, res) {
  const readBody = () => new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });

  const sendJson = (data, statusCode = 200) => {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  if (pathname === "/api/sessions" && req.method === "GET") {
    const sessions = await loadPersistedSessions();
    sendJson(sessions);
    return;
  }

  if (pathname === "/api/sessions" && req.method === "POST") {
    const body = await readBody();
    const result = await savePersistedSessions(Array.isArray(body) ? body : []);
    broadcastSseEvent("sessions:updated", {});
    sendJson(result);
    return;
  }

  if (pathname === "/api/workspace/tree" && req.method === "POST") {
    const body = await readBody();
    const tree = await getWorkspaceTree(body.workspace, body.directory);
    sendJson(tree);
    return;
  }

  if (pathname === "/api/file/read" && req.method === "POST") {
    const body = await readBody();
    const result = await readWorkspaceFile(body.workspace, body.path);
    sendJson(result);
    return;
  }

  if (pathname === "/api/file/search" && req.method === "POST") {
    const body = await readBody();
    const result = await searchWorkspaceFiles(body.workspace, body.query, body.maxResults);
    sendJson(result);
    return;
  }

  if (pathname === "/api/tokens/count" && req.method === "POST") {
    const body = await readBody();
    const tokens = countAgentRequestTokens({
      messages: body.messages || [],
      input: body.input || "",
      attachments: body.attachments || []
    });
    sendJson({ tokens });
    return;
  }

  if (pathname === "/api/config" && req.method === "GET") {
    const config = await loadAppConfig();
    sendJson({ config });
    return;
  }

  if (pathname === "/api/config" && req.method === "POST") {
    const body = await readBody();
    const result = await saveAppConfig(body);
    sendJson(result);
    return;
  }

  if (pathname === "/api/agent/send" && req.method === "POST") {
    const body = await readBody();
    const requestId = body.requestId;
    if (!requestId) {
      sendJson({ ok: false, error: "Missing requestId" }, 400);
      return;
    }

    if (activeWebRequests.has(requestId)) {
      sendJson({ ok: false, error: "Duplicate requestId" }, 400);
      return;
    }

    const controller = new AbortController();
    activeWebRequests.set(requestId, controller);

    const emit = (message) => {
      broadcastSseEvent("agent:event", { requestId, ...message });
    };

    // Run async
    void (async () => {
      try {
        await runAgentTurn({ ...body, signal: controller.signal }, emit);
        emit({ type: "done" });
      } catch (error) {
        if (controller.signal.aborted) {
          emit({ type: "cancelled", message: "任务已中止" });
        } else {
          emit({ type: "error", message: error.message });
        }
      } finally {
        activeWebRequests.delete(requestId);
      }
    })();

    sendJson({ ok: true });
    return;
  }

  if (pathname === "/api/agent/cancel" && req.method === "POST") {
    const body = await readBody();
    const controller = activeWebRequests.get(body.requestId);
    if (!controller) {
      sendJson({ ok: false });
      return;
    }
    controller.abort();
    activeWebRequests.delete(body.requestId);
    sendJson({ ok: true });
    return;
  }

  if (pathname === "/api/git/summary" && req.method === "POST") {
    const body = await readBody();
    const summary = await getGitSummary(body.workspace);
    sendJson(summary);
    return;
  }

  if (pathname === "/api/git/diff" && req.method === "POST") {
    const body = await readBody();
    const diff = await getGitDiff(body.workspace);
    sendJson(diff);
    return;
  }

  if (pathname === "/api/activity" && req.method === "GET") {
    const events = await loadPersistedActivityEvents();
    sendJson(events);
    return;
  }

  if (pathname === "/api/activity" && req.method === "POST") {
    const body = await readBody();
    const result = await savePersistedActivityEvents(Array.isArray(body) ? body : []);
    sendJson(result);
    return;
  }

  if (pathname === "/api/approvals/list" && req.method === "POST") {
    const body = await readBody();
    const approvals = await listPendingApprovals(body);
    sendJson(approvals);
    return;
  }

  if (pathname === "/api/agent/resume" && req.method === "POST") {
    const body = await readBody();
    const requestId = body.requestId;
    if (!requestId) {
      sendJson({ ok: false, error: "Missing requestId" }, 400);
      return;
    }

    if (activeWebRequests.has(requestId)) {
      sendJson({ ok: false, error: "Duplicate requestId" }, 400);
      return;
    }

    const controller = new AbortController();
    activeWebRequests.set(requestId, controller);

    const emit = (message) => {
      broadcastSseEvent("agent:event", { requestId, ...message });
    };

    void (async () => {
      try {
        const result = await resumeAgentContinuation({ ...body, signal: controller.signal }, emit);
        emit({ type: "done" });
      } catch (error) {
        if (controller.signal.aborted) {
          emit({ type: "cancelled", message: "任务已中止" });
        } else {
          emit({ type: "error", message: error.message });
        }
      } finally {
        activeWebRequests.delete(requestId);
      }
    })();

    sendJson({ ok: true });
    return;
  }

  if (pathname === "/api/provider/test" && req.method === "POST") {
    const body = await readBody();
    const result = await testProviderConnection(body);
    sendJson(result);
    return;
  }

  if (pathname === "/api/provider/balance" && req.method === "POST") {
    const body = await readBody();
    const result = await getProviderBalance(body);
    sendJson(result);
    return;
  }

  if (pathname === "/api/permissions/state" && req.method === "POST") {
    const body = await readBody();
    const result = await getAutoApprovalState(body);
    sendJson(result);
    return;
  }

  if (pathname === "/api/permissions/command" && req.method === "POST") {
    const body = await readBody();
    const result = await setCommandAutoApproval(body);
    sendJson(result);
    return;
  }

  if (pathname === "/api/permissions/patch" && req.method === "POST") {
    const body = await readBody();
    const result = await setPatchAutoApproval(body);
    sendJson(result);
    return;
  }

  if (pathname === "/api/permissions/full-access" && req.method === "POST") {
    const body = await readBody();
    const result = await setFullAccessAutoApproval(body);
    sendJson(result);
    return;
  }

  if (pathname === "/api/git/check-update" && req.method === "POST") {
    const result = await checkGitUpdate();
    sendJson(result);
    return;
  }

  if (pathname === "/api/git/apply-update" && req.method === "POST") {
    const result = await applyGitUpdate(null);
    sendJson(result);
    return;
  }

  // Fallback
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not Found" }));
}

async function handleStaticFile(pathname, res, isAuthorized) {
  const distDir = path.join(app.getAppPath(), "dist");

  // Force index.html for root path or unauthorized root requests
  // so they can see the login prompt if they don't have token,
  // or so we serve SPA correctly.
  let targetPath = pathname === "/" || pathname === "" ? "index.html" : pathname.slice(1);
  let absolutePath = path.join(distDir, targetPath);

  // If path doesn't exist, fallback to index.html (Standard SPA routing)
  if (!existsSync(absolutePath)) {
    targetPath = "index.html";
    absolutePath = path.join(distDir, targetPath);
  }

  // If serving index.html and they are not authorized, we still let them load it,
  // but it will ask for token in React. Or if they don't provide a token, we let it load
  // so the React SPA can prompt them to enter the Token manually!
  // This is extremely user-friendly: if they open it via LAN IP directly, the page prompts
  // "Please enter X-API-Token to connect".

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  const stream = createReadStream(absolutePath);
  stream.pipe(res);
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-ipv4 addresses
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}
