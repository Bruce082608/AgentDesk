import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeLanguage, t } from "../i18n.js";
import { getAutoApprovalState, setScopedAutoApproval, localizedError } from "../patch-approval.js";
import { resolveCommandCwd } from "./file-tools.js";

const execFileAsync = promisify(execFile);
const MAX_COMMAND_SESSION_BUFFER = 500_000;
const MAX_COMMAND_SESSIONS = 20;

export const pendingCommands = new Map();
export const commandSessions = new Map();

export async function runCommand(context, command, timeoutMs) {
  const workspace = context.workspace;
  const commandText = String(command ?? "").trim();
  if (!commandText) throw localizedError(context.language, "tools.emptyCommand");
  const timeout = normalizeCommandTimeout(timeoutMs);
  const shell = getShellInvocation(commandText);
  const cwd = path.resolve(workspace);
  const highRisk = isDangerousCommand(commandText);
  const { isAutoApprovalEnabled } = await import("../patch-approval.js");
  if (!isAutoApprovalEnabled("command", context) && (highRisk || !isAutoAllowedCommand(commandText))) {
    const commandId = randomUUID();
    pendingCommands.set(commandId, {
      id: commandId,
      mode: "run",
      workspace: cwd,
      requestId: context.requestId,
      sessionId: context.sessionId,
      command: commandText,
      highRisk,
      timeoutMs: timeout,
      cwd,
      shell: formatShellLabel(shell.file),
      inheritedEnv: true,
      language: context.language,
      createdAt: Date.now()
    });
    return JSON.stringify({
      ok: true,
      pending: true,
      commandId,
      mode: "run",
      command: commandText,
      cwd,
      timeoutMs: timeout,
      shell: formatShellLabel(shell.file),
      inheritedEnv: true,
      highRisk,
      risk: highRisk ? "high" : "normal",
      riskReason: commandApprovalReason(highRisk, context.language),
      message: t(context.language, "tools.commandQueued")
    });
  }

  return executeCommand(workspace, commandText, timeout);
}

export async function startCommand(context, command, cwdInput = "") {
  const commandText = String(command ?? "").trim();
  if (!commandText) throw localizedError(context.language, "tools.emptyCommand");
  const cwd = resolveCommandCwd(context, cwdInput);
  const shell = getShellInvocation(commandText);
  const highRisk = isDangerousCommand(commandText);
  const { isAutoApprovalEnabled } = await import("../patch-approval.js");
  if (!isAutoApprovalEnabled("command", context) && (highRisk || !isAutoAllowedCommand(commandText))) {
    const commandId = randomUUID();
    pendingCommands.set(commandId, {
      id: commandId,
      mode: "start",
      workspace: context.workspace,
      requestId: context.requestId,
      sessionId: context.sessionId,
      command: commandText,
      highRisk,
      cwd,
      shell: formatShellLabel(shell.file),
      inheritedEnv: true,
      language: context.language,
      createdAt: Date.now()
    });
    return JSON.stringify({
      ok: true,
      pending: true,
      commandId,
      mode: "start",
      command: commandText,
      cwd,
      shell: formatShellLabel(shell.file),
      inheritedEnv: true,
      highRisk,
      risk: highRisk ? "high" : "normal",
      riskReason: commandApprovalReason(highRisk, context.language),
      message: t(context.language, "tools.commandQueued")
    });
  }

  return startCommandSession({
    command: commandText,
    cwd,
    shellLabel: formatShellLabel(shell.file)
  });
}

export async function executeCommand(workspace, commandText, timeoutMs) {
  const timeout = normalizeCommandTimeout(timeoutMs);
  const { file, args } = getShellInvocation(commandText);
  const cwd = path.resolve(workspace);
  const { stdout, stderr } = await execFileAsync(file, args, {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: 1_000_000
  });

  return JSON.stringify({ stdout, stderr, cwd, timeoutMs: timeout, shell: formatShellLabel(file), inheritedEnv: true }, null, 2);
}

export function normalizeCommandTimeout(timeoutMs) {
  return Math.min(Math.max(Number(timeoutMs) || 30_000, 1_000), 120_000);
}

export function getShellInvocation(commandText) {
  if (process.env.AGENT_SHELL) {
    return process.platform === "win32"
      ? { file: process.env.AGENT_SHELL, args: ["-NoProfile", "-Command", commandText] }
      : { file: process.env.AGENT_SHELL, args: ["-lc", commandText] };
  }
  if (process.platform === "win32") {
    return { file: "powershell.exe", args: ["-NoProfile", "-Command", commandText] };
  }
  return { file: "/bin/bash", args: ["-lc", commandText] };
}

export function formatShellLabel(file) {
  return path.basename(String(file || "shell"));
}

export function commandApprovalReason(highRisk, language) {
  return highRisk
    ? t(language, "tools.commandPendingHighRisk")
    : t(language, "tools.commandPendingNormal");
}

export async function approvePendingCommand(commandId, options = {}) {
  const language = normalizeLanguage(options.language);
  const pending = pendingCommands.get(commandId);
  if (!pending) throw localizedError(language, "tools.pendingCommandMissing");
  pendingCommands.delete(commandId);
  return executeCommandRecord(pending, options);
}

export async function executeCommandRecord(pending, options = {}) {
  let permissionState = getAutoApprovalState(pending);
  if (options.allowFuture) {
    permissionState = setScopedAutoApproval({
      ...pending,
      kind: "command",
      enabled: true
    });
  }
  const result = pending.mode === "start"
    ? await startCommandSession({
      command: pending.command,
      cwd: pending.cwd || pending.workspace,
      shellLabel: pending.shell
    })
    : await executeCommand(pending.workspace, pending.command, pending.timeoutMs);
  return {
    ok: true,
    commandId: pending.id || pending.commandId,
    command: pending.command,
    mode: pending.mode || "run",
    result,
    cwd: pending.cwd,
    timeoutMs: pending.timeoutMs,
    shell: pending.shell,
    inheritedEnv: pending.inheritedEnv,
    highRisk: Boolean(pending.highRisk),
    autoApproveFutureCommands: permissionState.commandAutoApproval,
    commandAutoApproval: permissionState.commandAutoApproval,
    patchAutoApproval: permissionState.patchAutoApproval,
    fullAccessAutoApproval: permissionState.fullAccessAutoApproval,
    commandAutoApprovalExpiresAt: permissionState.commandAutoApprovalExpiresAt,
    patchAutoApprovalExpiresAt: permissionState.patchAutoApprovalExpiresAt
  };
}

export function discardPendingCommand(commandId) {
  const existed = pendingCommands.delete(commandId);
  return { ok: existed, commandId };
}

export async function startCommandSession({ command, cwd, shellLabel = "" }) {
  pruneCommandSessions();
  const { file, args } = getShellInvocation(command);
  const sessionId = randomUUID();
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const child = spawn(file, args, {
    cwd: resolvedCwd,
    windowsHide: true,
    env: process.env
  });
  const session = {
    id: sessionId,
    process: child,
    command,
    cwd: resolvedCwd,
    shell: shellLabel || formatShellLabel(file),
    pid: child.pid || null,
    output: "",
    outputStartOffset: 0,
    totalOutputChars: 0,
    exitCode: null,
    signal: "",
    running: true,
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
  commandSessions.set(sessionId, session);

  const append = (stream, chunk) => appendCommandOutput(session, stream, chunk);
  child.stdout?.on("data", (chunk) => append("stdout", chunk));
  child.stderr?.on("data", (chunk) => append("stderr", chunk));
  child.on("error", (error) => append("error", `${error.message}\n`));
  child.on("exit", (code, signal) => {
    session.exitCode = code;
    session.signal = signal || "";
    session.running = false;
    session.updatedAt = Date.now();
  });

  return JSON.stringify({
    sessionId,
    command,
    cwd: session.cwd,
    shell: session.shell,
    pid: session.pid,
    running: true,
    outputOffset: session.totalOutputChars,
    startedAt: session.startedAt
  }, null, 2);
}

export function appendCommandOutput(session, stream, chunk) {
  const text = `[${stream}] ${Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)}`;
  session.output += text;
  session.totalOutputChars += text.length;
  session.updatedAt = Date.now();
  if (session.output.length > MAX_COMMAND_SESSION_BUFFER) {
    const overflow = session.output.length - MAX_COMMAND_SESSION_BUFFER;
    session.output = session.output.slice(overflow);
    session.outputStartOffset += overflow;
  }
}

export function readCommandOutput(sessionId, outputOffset, maxChars, language) {
  const id = String(sessionId || "");
  const session = commandSessions.get(id);
  if (!session) throw localizedError(language, "tools.commandSessionMissing", { id });
  const limit = Math.min(Math.max(Number(maxChars) || 20_000, 1_000), 100_000);
  const requestedOffset = Math.max(Number(outputOffset) || 0, 0);
  const effectiveOffset = Math.max(requestedOffset, session.outputStartOffset);
  const localOffset = Math.max(0, effectiveOffset - session.outputStartOffset);
  const output = session.output.slice(localOffset, localOffset + limit);
  const nextOffset = effectiveOffset + output.length;
  return JSON.stringify({
    sessionId: id,
    command: session.command,
    cwd: session.cwd,
    shell: session.shell,
    pid: session.pid,
    running: session.running,
    exitCode: session.exitCode,
    signal: session.signal,
    output,
    outputOffset: nextOffset,
    outputStartOffset: session.outputStartOffset,
    totalOutputChars: session.totalOutputChars,
    truncatedBefore: requestedOffset < session.outputStartOffset,
    hasMore: nextOffset < session.outputStartOffset + session.output.length,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt
  }, null, 2);
}

export function stopCommand(sessionId, language) {
  const id = String(sessionId || "");
  const session = commandSessions.get(id);
  if (!session) throw localizedError(language, "tools.commandSessionMissing", { id });
  if (session.running) {
    session.process.kill("SIGTERM");
    setTimeout(() => {
      if (session.running) session.process.kill("SIGKILL");
    }, 1500).unref?.();
  }
  return JSON.stringify({
    sessionId: id,
    command: session.command,
    running: session.running,
    stopped: true,
    exitCode: session.exitCode,
    signal: session.signal,
    outputOffset: session.totalOutputChars
  }, null, 2);
}

export function pruneCommandSessions() {
  if (commandSessions.size < MAX_COMMAND_SESSIONS) return;
  const finished = [...commandSessions.values()]
    .filter((session) => !session.running)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  while (commandSessions.size >= MAX_COMMAND_SESSIONS && finished.length > 0) {
    commandSessions.delete(finished.shift().id);
  }
}

export function isDangerousCommand(command) {
  const lowered = command.toLowerCase();
  return [
    /\bremove-item\b/,
    /(^|[;&|\s])rm\s+/,
    /(^|[;&|\s])sudo\s+/,
    /(^|[;&|\s])chmod\s+(-r\s+)?777\b/,
    /(^|[;&|\s])del\s+/,
    /(^|[;&|\s])erase\s+/,
    /(^|[;&|\s])rmdir\s+/,
    /(^|[;&|\s])format\s+/,
    /\bshutdown\b/,
    /\brestart-computer\b/,
    /\bstop-computer\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\b/,
    /\bgit\s+checkout\s+--\b/
  ].some((pattern) => pattern.test(lowered));
}

export function isAutoAllowedCommand(command) {
  const lowered = command.trim().toLowerCase();
  if (/[;&|`<>]/.test(lowered)) return false;
  return [
    /^git\s+(status|diff|branch|log|show)(\s+[^\n]*)?$/,
    /^npm\s+run\s+typecheck(\s|$)/,
    /^npm\s+run\s+build(\s|$)/,
    /^npm\s+test(\s|$)/,
    /^node\s+--check(\s|$)/,
    /^pwd$/,
    /^cat\s+/,
    /^rg(\.exe)?\s+/,
    /^get-childitem(\s|$)/,
    /^dir(\s|$)/,
    /^ls(\s|$)/,
    /^get-content(\s|$)/,
    /^type\s+/,
    /^select-string(\s|$)/,
    /^findstr(\s|$)/
  ].some((pattern) => pattern.test(lowered));
}
