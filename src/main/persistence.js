import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";

const STATE_FILE_NAME = "agent-state.json";
const APPROVAL_SCOPE_FILE_NAME = "agent-approval-scopes.json";
const MAX_SESSIONS = 50;
const MAX_EVENTS = 5000;
const MAX_CONTINUATIONS = 100;
const FALLBACK_STATE_DIRECTORY = path.join(os.tmpdir(), `agentdesk-user-data-${process.pid}`);

let stateCache = null;
let writeQueue = Promise.resolve();

export function getStatePath() {
  return path.join(getStateDirectory(), STATE_FILE_NAME);
}

export async function loadPersistedState() {
  return cloneState(await readState());
}

export async function loadPersistedSessions() {
  const state = await readState();
  return clone(state.sessions);
}

export async function savePersistedSessions(sessions = []) {
  const state = await readState();
  state.sessions = normalizeSessions(sessions);
  await writeState(state);
  return { ok: true, count: state.sessions.length, path: getStatePath() };
}

export async function loadPersistedActivityEvents() {
  const state = await readState();
  return clone(state.events);
}

export async function savePersistedActivityEvents(events = []) {
  const state = await readState();
  state.events = normalizeEvents(events);
  await writeState(state);
  return { ok: true, count: state.events.length, path: getStatePath() };
}

export async function upsertAgentContinuation(continuation) {
  const state = await readState();
  const sanitized = normalizeContinuation(continuation);
  const next = state.continuations.filter((item) => item.id !== sanitized.id);
  next.unshift(sanitized);
  state.continuations = next.slice(0, MAX_CONTINUATIONS);
  await writeState(state);
  return sanitized;
}

export async function getAgentContinuation(id) {
  const state = await readState();
  const continuation = state.continuations.find((item) => item.id === id);
  return continuation ? clone(continuation) : null;
}

export async function deleteAgentContinuation(id) {
  const state = await readState();
  const before = state.continuations.length;
  state.continuations = state.continuations.filter((item) => item.id !== id);
  await writeState(state);
  return { ok: before !== state.continuations.length, id };
}

export function loadPersistedApprovalScopesSync() {
  return readApprovalScopesSync();
}

export function savePersistedApprovalScopesSync(scopes = {}) {
  writeApprovalScopesSync(scopes);
}

export async function listPendingApprovals(filter = {}) {
  const state = await readState();
  const sessionId = String(filter.sessionId || "");
  return state.continuations
    .filter((continuation) => !sessionId || continuation.sessionId === sessionId)
    .map((continuation) => ({
      ...clone(continuation.approval),
      continuationId: continuation.id,
      sessionId: continuation.sessionId,
      workspace: continuation.workspace,
      requestId: continuation.requestId,
      createdAt: continuation.createdAt
    }))
    .filter((approval) => approval.kind && approval.id);
}

async function readState() {
  if (stateCache) return stateCache;
  const statePath = getStatePath();
  try {
    const raw = await fs.readFile(statePath, "utf8");
    stateCache = normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      stateCache = normalizeState({});
      await writeState(stateCache);
      return stateCache;
    }
    stateCache = normalizeState({});
  }
  return stateCache;
}

async function writeState(state) {
  stateCache = normalizeState(state);
  const snapshot = cloneState(stateCache);
  writeQueue = writeQueue.then(async () => {
    const statePath = getStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, statePath);
  });
  await writeQueue;
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    sessions: normalizeSessions(state.sessions),
    events: normalizeEvents(state.events),
    continuations: normalizeContinuations(state.continuations),
    approvalScopes: normalizeApprovalScopes(state.approvalScopes)
  };
}

function normalizeSessions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((session) => session && typeof session === "object" && typeof session.id === "string")
    .slice(0, MAX_SESSIONS)
    .map((session) => ({
      ...session,
      id: String(session.id),
      title: String(session.title || "Untitled chat"),
      titleEdited: Boolean(session.titleEdited),
      workspace: String(session.workspace || ""),
      messages: Array.isArray(session.messages) ? session.messages : [],
      tokenUsage: normalizeTokenUsage(session.tokenUsage),
      createdAt: Number(session.createdAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now()
    }));
}

function normalizeTokenUsage(value) {
  const usage = value && typeof value === "object" ? value : {};
  const promptTokens = Number(usage.promptTokens) || 0;
  const completionTokens = Number(usage.completionTokens) || 0;
  const totalTokens = Number(usage.totalTokens) || promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    requests: Number(usage.requests) || 0
  };
}

function normalizeEvents(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((event) => event && typeof event === "object" && typeof event.id === "string")
    .slice(-MAX_EVENTS)
    .map((event) => ({
      id: String(event.id),
      title: String(event.title || ""),
      body: String(event.body || ""),
      kind: ["status", "tool", "error", "model", "patch"].includes(event.kind) ? event.kind : "status",
      createdAt: Number(event.createdAt) || Date.now()
    }));
}

function normalizeContinuations(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((continuation) => continuation && typeof continuation === "object" && typeof continuation.id === "string")
    .slice(0, MAX_CONTINUATIONS)
    .map(normalizeContinuation);
}

function normalizeApprovalScopes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const scopes = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== "object") continue;
    scopes[String(key)] = {
      commandEnabled: Boolean(item.commandEnabled),
      patchEnabled: Boolean(item.patchEnabled),
      commandExpiresAt: Number(item.commandExpiresAt) || 0,
      patchExpiresAt: Number(item.patchExpiresAt) || 0
    };
  }
  return scopes;
}

function normalizeContinuation(continuation) {
  const providerConfig = { ...(continuation.providerConfig || {}) };
  if (Object.prototype.hasOwnProperty.call(providerConfig, "apiKey")) {
    providerConfig.apiKey = "";
  }
  return {
    id: String(continuation.id),
    kind: String(continuation.kind || ""),
    requestId: String(continuation.requestId || ""),
    sessionId: String(continuation.sessionId || ""),
    workspace: String(continuation.workspace || ""),
    language: continuation.language === "en" ? "en" : "zh",
    providerConfig,
    permissionMode: continuation.permissionMode === "full" ? "full" : "default",
    attachments: Array.isArray(continuation.attachments) ? continuation.attachments : [],
    messages: Array.isArray(continuation.messages) ? continuation.messages : [],
    pendingToolCall: continuation.pendingToolCall || null,
    remainingToolCalls: Array.isArray(continuation.remainingToolCalls) ? continuation.remainingToolCalls : [],
    step: Math.max(0, Math.floor(Number(continuation.step) || 0)),
    maxAgentSteps: Math.max(1, Math.floor(Number(continuation.maxAgentSteps) || 64)),
    approval: continuation.approval && typeof continuation.approval === "object" ? continuation.approval : {},
    createdAt: Number(continuation.createdAt) || Date.now()
  };
}

function cloneState(state) {
  return normalizeState(clone(state));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function readApprovalScopesSync() {
  try {
    const raw = fsSync.readFileSync(getApprovalScopesPath(), "utf8");
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeApprovalScopes(parsed);
  } catch {
    return {};
  }
}

function writeApprovalScopesSync(scopes) {
  const statePath = getApprovalScopesPath();
  fsSync.mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${randomUUID()}.tmp`;
  fsSync.writeFileSync(tempPath, `${JSON.stringify(normalizeApprovalScopes(scopes), null, 2)}\n`, "utf8");
  fsSync.renameSync(tempPath, statePath);
}

function getApprovalScopesPath() {
  return path.join(getStateDirectory(), APPROVAL_SCOPE_FILE_NAME);
}

function getStateDirectory() {
  if (process.env.AGENTDESK_USER_DATA_DIR) {
    return process.env.AGENTDESK_USER_DATA_DIR;
  }
  try {
    return app.getPath("userData");
  } catch {
    return FALLBACK_STATE_DIRECTORY;
  }
}
