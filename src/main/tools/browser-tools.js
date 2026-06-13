import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { localizedError } from "../patch-approval.js";
import { resolveMutableFilePath, expandHomePath, isFullAccess } from "./file-tools.js";
import { resolveInsideWorkspace } from "../patch-approval.js";

const MAX_BROWSER_SESSIONS = 8;
export const browserSessions = new Map();

export async function browserPage(context, args = {}) {
  const action = String(args.action || (args.url ? "open" : "screenshot")).toLowerCase();
  if (action === "open") return openBrowserPage(context, args);
  if (action === "close") return closeBrowserPage(args.session_id, context.language);

  const session = getBrowserSession(args.session_id, context.language);
  if (action === "click") {
    const selector = String(args.selector || "").trim();
    if (!selector) throw localizedError(context.language, "tools.emptySelector");
    await session.page.click(selector, { timeout: 10_000 });
  } else if (action === "type") {
    const selector = String(args.selector || "").trim();
    if (!selector) throw localizedError(context.language, "tools.emptySelector");
    const text = String(args.text ?? "");
    if (args.clear === false) {
      await session.page.type(selector, text, { timeout: 10_000 });
    } else {
      await session.page.fill(selector, text, { timeout: 10_000 });
    }
  } else if (action === "evaluate") {
    const script = String(args.script || "").trim();
    if (!script) throw localizedError(context.language, "tools.emptyScript");
    session.lastEvaluation = await session.page.evaluate((source) => {
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${source});`)();
    }, script);
  } else if (action !== "screenshot") {
    throw localizedError(context.language, "tools.invalidBrowserAction", { action });
  }

  await waitAfterBrowserAction(session.page, args.wait_ms);
  const screenshotPath = args.screenshot || action === "screenshot"
    ? await saveBrowserScreenshot(context, session.page, args.screenshot_path, args.full_page !== false)
    : "";
  return browserSnapshot(session, { screenshotPath, action });
}

export async function openBrowserPage(context, args = {}) {
  pruneBrowserSessions();
  const chromium = await loadPlaywrightChromium(context.language);
  const browser = await chromium.launch({ headless: args.headless !== false });
  const viewport = {
    width: Math.min(Math.max(Number(args.viewport_width) || 1280, 320), 3840),
    height: Math.min(Math.max(Number(args.viewport_height) || 800, 240), 2160)
  };
  const page = await browser.newPage({ viewport });
  const session = {
    id: randomUUID(),
    browser,
    page,
    consoleMessages: [],
    pageErrors: [],
    lastEvaluation: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  attachBrowserDiagnostics(session);
  browserSessions.set(session.id, session);

  const url = await normalizeBrowserUrl(context, args.url);
  const waitUntil = ["load", "domcontentloaded", "networkidle", "commit"].includes(args.wait_until)
    ? args.wait_until
    : "networkidle";
  await page.goto(url, { waitUntil, timeout: 30_000 });
  await waitAfterBrowserAction(page, args.wait_ms);
  const screenshotPath = args.screenshot
    ? await saveBrowserScreenshot(context, page, args.screenshot_path, args.full_page !== false)
    : "";
  return browserSnapshot(session, { screenshotPath, action: "open" });
}

export async function loadPlaywrightChromium(language) {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch (error) {
    throw localizedError(language, "tools.browserUnavailable", { message: error?.message || String(error) });
  }
}

export function attachBrowserDiagnostics(session) {
  session.page.on("console", (message) => {
    const entry = {
      type: message.type(),
      text: message.text(),
      location: message.location()
    };
    session.consoleMessages.push(entry);
    session.consoleMessages = session.consoleMessages.slice(-80);
    session.updatedAt = Date.now();
  });
  session.page.on("pageerror", (error) => {
    session.pageErrors.push(error?.stack || error?.message || String(error));
    session.pageErrors = session.pageErrors.slice(-40);
    session.updatedAt = Date.now();
  });
}

export async function normalizeBrowserUrl(context, rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) throw localizedError(context.language, "tools.emptyUrl");
  if (/^https?:\/\//i.test(value) || /^file:\/\//i.test(value) || /^data:/i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;

  const absolute = isFullAccess(context)
    ? path.resolve(expandHomePath(value))
    : resolveInsideWorkspace(context.workspace, value, context.language);
  const stat = await fs.stat(absolute).catch(() => null);
  if (stat?.isFile()) return pathToFileURL(absolute).href;
  return `http://${value}`;
}

export async function waitAfterBrowserAction(page, waitMs) {
  const delay = Math.min(Math.max(Number(waitMs) || 250, 0), 10_000);
  if (delay > 0) await page.waitForTimeout(delay);
}

export async function saveBrowserScreenshot(context, page, requestedPath, fullPage) {
  const { absolute, displayPath } = resolveBrowserScreenshotPath(context, requestedPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await page.screenshot({ path: absolute, fullPage });
  return displayPath;
}

export function resolveBrowserScreenshotPath(context, requestedPath) {
  const cleaned = String(requestedPath || "").trim();
  if (cleaned) return resolveMutableFilePath(context, cleaned);
  const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  return {
    absolute: path.join(path.resolve(context.workspace), ".agentdesk", "browser-screenshots", filename),
    displayPath: `.agentdesk/browser-screenshots/${filename}`
  };
}

export function getBrowserSession(sessionId, language) {
  const id = String(sessionId || "").trim();
  const session = browserSessions.get(id);
  if (!session) throw localizedError(language, "tools.browserSessionMissing", { id });
  session.updatedAt = Date.now();
  return session;
}

export async function closeBrowserPage(sessionId, language) {
  const session = getBrowserSession(sessionId, language);
  browserSessions.delete(session.id);
  await session.browser.close();
  return JSON.stringify({
    sessionId: session.id,
    closed: true,
    consoleErrors: collectConsoleErrors(session),
    pageErrors: session.pageErrors
  }, null, 2);
}

export async function browserSnapshot(session, extra = {}) {
  const title = await session.page.title().catch(() => "");
  const url = session.page.url();
  const bodyText = await session.page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
  return JSON.stringify({
    sessionId: session.id,
    action: extra.action || "",
    url,
    title,
    screenshotPath: extra.screenshotPath || "",
    consoleErrors: collectConsoleErrors(session),
    pageErrors: session.pageErrors,
    evaluation: session.lastEvaluation,
    textExcerpt: bodyText.replace(/\s+/g, " ").trim().slice(0, 4000),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }, null, 2);
}

export function collectConsoleErrors(session) {
  return session.consoleMessages
    .filter((entry) => entry.type === "error" || entry.type === "warning")
    .slice(-40);
}

export function pruneBrowserSessions() {
  if (browserSessions.size < MAX_BROWSER_SESSIONS) return;
  const oldest = [...browserSessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  while (browserSessions.size >= MAX_BROWSER_SESSIONS && oldest.length > 0) {
    const session = oldest.shift();
    browserSessions.delete(session.id);
    session.browser.close().catch(() => {});
  }
}
