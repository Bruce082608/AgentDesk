import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getStateDirectory } from "./persistence.js";

const TASK_FILE_NAME = "agent-background-tasks.json";
const MAX_TASKS = 100;
const MAX_TIMER_DELAY = 2_147_483_647;
const MIN_INTERVAL_MS = 60_000;

let taskCache = null;
let writeQueue = Promise.resolve();
let timers = new Map();
let notifyTaskDue = null;

export function configureBackgroundTasks({ notify } = {}) {
  notifyTaskDue = typeof notify === "function" ? notify : notifyTaskDue;
  void restoreBackgroundTimers();
}

export async function handleBackgroundTaskTool(args = {}, context = {}) {
  const action = String(args.action || "list").trim();
  if (action === "list") {
    const tasks = await listBackgroundTasks({ includeCompleted: Boolean(args.include_completed) });
    return JSON.stringify({ ok: true, tasks }, null, 2);
  }
  if (action === "schedule") {
    const task = await scheduleBackgroundTask({
      title: args.title,
      body: args.body,
      runAt: args.run_at,
      delayMinutes: args.delay_minutes,
      intervalMinutes: args.interval_minutes,
      workspace: context.workspace,
      sessionId: context.sessionId,
      requestId: context.requestId
    });
    return JSON.stringify({ ok: true, task }, null, 2);
  }
  if (action === "cancel") {
    const result = await cancelBackgroundTask(String(args.id || ""));
    return JSON.stringify(result, null, 2);
  }
  throw new Error("background_task action must be one of: list, schedule, cancel.");
}

export async function listBackgroundTasks({ includeCompleted = false } = {}) {
  const state = await readTasks();
  return state.tasks
    .filter((task) => includeCompleted || task.status === "scheduled")
    .sort((a, b) => a.runAt - b.runAt)
    .map(cloneTask);
}

export async function scheduleBackgroundTask(input) {
  const title = String(input.title || "").trim() || "AgentDesk background task";
  const body = String(input.body || "").trim();
  const runAt = normalizeRunAt(input);
  const intervalMs = normalizeIntervalMs(input.intervalMinutes);
  const now = Date.now();
  const task = {
    id: randomUUID(),
    title: title.slice(0, 120),
    body: body.slice(0, 2000),
    runAt,
    intervalMs,
    status: "scheduled",
    workspace: String(input.workspace || ""),
    sessionId: String(input.sessionId || ""),
    requestId: String(input.requestId || ""),
    createdAt: now,
    updatedAt: now,
    lastRunAt: 0,
    runs: 0
  };
  const state = await readTasks();
  state.tasks = [task, ...state.tasks].slice(0, MAX_TASKS);
  await writeTasks(state);
  scheduleTimer(task);
  return cloneTask(task);
}

export async function cancelBackgroundTask(id) {
  const taskId = String(id || "").trim();
  if (!taskId) throw new Error("background_task cancel requires an id.");
  const state = await readTasks();
  let cancelled = null;
  state.tasks = state.tasks.map((task) => {
    if (task.id !== taskId || task.status !== "scheduled") return task;
    cancelled = { ...task, status: "cancelled", updatedAt: Date.now() };
    return cancelled;
  });
  clearTaskTimer(taskId);
  await writeTasks(state);
  return { ok: Boolean(cancelled), task: cancelled ? cloneTask(cancelled) : null };
}

export async function runDueBackgroundTasks(now = Date.now()) {
  const state = await readTasks();
  let changed = false;
  for (const task of state.tasks) {
    if (task.status !== "scheduled" || task.runAt > now) continue;
    await emitTaskNotification(task);
    task.lastRunAt = now;
    task.runs = (Number(task.runs) || 0) + 1;
    task.updatedAt = now;
    if (task.intervalMs > 0) {
      task.runAt = now + task.intervalMs;
      scheduleTimer(task);
    } else {
      task.status = "completed";
      clearTaskTimer(task.id);
    }
    changed = true;
  }
  if (changed) await writeTasks(state);
  return { ok: true, changed };
}

async function restoreBackgroundTimers() {
  const tasks = await listBackgroundTasks({ includeCompleted: false }).catch(() => []);
  for (const task of tasks) scheduleTimer(task);
  await runDueBackgroundTasks().catch(() => {});
}

function scheduleTimer(task) {
  clearTaskTimer(task.id);
  if (task.status !== "scheduled") return;
  const delay = Math.max(0, Math.min(MAX_TIMER_DELAY, Number(task.runAt) - Date.now()));
  const timer = setTimeout(() => {
    void runDueBackgroundTasks().catch(() => {});
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
  timers.set(task.id, timer);
}

function clearTaskTimer(id) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

async function emitTaskNotification(task) {
  if (!notifyTaskDue) return;
  await Promise.resolve(notifyTaskDue({
    title: task.title,
    body: task.body || "Background task is due."
  })).catch(() => {});
}

async function readTasks() {
  if (taskCache) return taskCache;
  try {
    const raw = await fs.readFile(getTasksPath(), "utf8");
    taskCache = normalizeTaskState(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      taskCache = normalizeTaskState({});
      await writeTasks(taskCache);
      return taskCache;
    }
    taskCache = normalizeTaskState({});
  }
  return taskCache;
}

async function writeTasks(state) {
  taskCache = normalizeTaskState(state);
  const snapshot = normalizeTaskState(taskCache);
  writeQueue = writeQueue.then(async () => {
    const taskPath = getTasksPath();
    await fs.mkdir(path.dirname(taskPath), { recursive: true });
    const tempPath = `${taskPath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, taskPath);
  });
  await writeQueue;
}

function normalizeTaskState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    tasks: normalizeTasks(state.tasks)
  };
}

function normalizeTasks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((task) => task && typeof task === "object" && typeof task.id === "string")
    .slice(0, MAX_TASKS)
    .map((task) => ({
      id: String(task.id),
      title: String(task.title || "AgentDesk background task").slice(0, 120),
      body: String(task.body || "").slice(0, 2000),
      runAt: Number(task.runAt) || Date.now(),
      intervalMs: Math.max(0, Number(task.intervalMs) || 0),
      status: ["scheduled", "completed", "cancelled"].includes(task.status) ? task.status : "scheduled",
      workspace: String(task.workspace || ""),
      sessionId: String(task.sessionId || ""),
      requestId: String(task.requestId || ""),
      createdAt: Number(task.createdAt) || Date.now(),
      updatedAt: Number(task.updatedAt) || Date.now(),
      lastRunAt: Number(task.lastRunAt) || 0,
      runs: Math.max(0, Math.floor(Number(task.runs) || 0))
    }));
}

function normalizeRunAt(input) {
  if (input.runAt || input.run_at) {
    const parsed = Date.parse(String(input.runAt || input.run_at));
    if (!Number.isNaN(parsed)) return parsed;
  }
  const delayMinutes = Number(input.delayMinutes ?? input.delay_minutes ?? 0);
  if (Number.isFinite(delayMinutes) && delayMinutes > 0) {
    return Date.now() + Math.ceil(delayMinutes * 60_000);
  }
  return Date.now() + 60_000;
}

function normalizeIntervalMs(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.max(MIN_INTERVAL_MS, Math.ceil(minutes * 60_000));
}

function getTasksPath() {
  return path.join(getStateDirectory(), TASK_FILE_NAME);
}

function cloneTask(task) {
  return JSON.parse(JSON.stringify(task));
}
