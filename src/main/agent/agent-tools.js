import { randomUUID } from "node:crypto";
import { getAutoApprovalState, applyPatchRecord, discardPendingPatch } from "../patch-approval.js";
import { executeToolCall, discardPendingCommand, executeCommandRecord } from "../tools.js";
import { upsertAgentContinuation } from "../persistence.js";
import { loadAppConfig } from "../config.js";
import { normalizeLanguage, t } from "../i18n.js";
import { normalizeToolCalls, throwIfAborted } from "./agent-context.js";

const PARALLEL_SAFE_TOOL_NAMES = new Set([
  "list_files",
  "read_file",
  "read_files",
  "read_file_range",
  "search_files",
  "web_search",
  "workspace_map",
  "read_command_output",
  "read_result_chunk",
  "system_window_info"
]);

export async function processToolCalls({
  runtime,
  emit,
  toolCalls,
  step,
  toolFailures,
  counters
}) {
  const recoveryMessages = [];
  const language = runtime.language;

  for (let index = 0; index < toolCalls.length;) {
    throwIfAborted(runtime.signal, language);

    if (isParallelSafeToolCall(toolCalls[index])) {
      const batch = [];
      while (index < toolCalls.length && isParallelSafeToolCall(toolCalls[index])) {
        const toolCall = toolCalls[index];
        const name = toolCall.function?.name ?? "unknown";
        const rawArgs = toolCall.function?.arguments ?? "{}";
        emit({ type: "tool_start", name, args: rawArgs, toolCallId: toolCall.id });
        batch.push({ toolCall, index });
        index += 1;
      }

      const executions = await Promise.all(batch.map(({ toolCall }) => executeRuntimeToolCall(toolCall, runtime, language, emit)));
      for (let batchIndex = 0; batchIndex < executions.length; batchIndex += 1) {
        const execution = executions[batchIndex];
        const nextToolIndex = batch[batchIndex].index + 1;
        const handled = await handleToolExecution({
          runtime,
          emit,
          toolCalls,
          step,
          toolFailures,
          counters,
          recoveryMessages,
          execution,
          nextToolIndex
        });
        if (handled.paused) return { paused: true };
      }
      continue;
    }

    const toolCall = toolCalls[index];
    const name = toolCall.function?.name ?? "unknown";
    const rawArgs = toolCall.function?.arguments ?? "{}";
    emit({ type: "tool_start", name, args: rawArgs, toolCallId: toolCall.id });
    const execution = await executeRuntimeToolCall(toolCall, runtime, language, emit);
    const handled = await handleToolExecution({
      runtime,
      emit,
      toolCalls,
      step,
      toolFailures,
      counters,
      recoveryMessages,
      execution,
      nextToolIndex: index + 1
    });
    if (handled.paused) return { paused: true };
    index += 1;
  }

  if (recoveryMessages.length > 0) {
    runtime.messages.push(...recoveryMessages);
    emit({
      type: "status",
      message: t(language, "agent.toolFailuresRecorded")
    });
  }

  return { paused: false };
}

export async function executeRuntimeToolCall(toolCall, runtime, language, emit) {
  const name = toolCall.function?.name ?? "unknown";
  const rawArgs = toolCall.function?.arguments ?? "{}";
  let result = "";
  let parsed = null;
  try {
    result = await executeToolCall(toolCall, {
      workspace: runtime.workspace,
      requestId: runtime.requestId || "",
      sessionId: runtime.sessionId || "",
      language,
      fullAccessAutoApproval: isRuntimeFullAccess(runtime),
      attachments: runtime.attachments,
      emit
    });
    parsed = parseToolResult(result);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    parsed = {
      ok: false,
      tool: name,
      error: messageText,
      errorType: "unexpected_tool_runner_error",
      detail: "",
      recoverable: true
    };
    result = JSON.stringify(parsed, null, 2);
  }

  return { toolCall, name, rawArgs, result, parsed };
}

export async function handleToolExecution({
  runtime,
  emit,
  toolCalls,
  step,
  toolFailures,
  counters,
  recoveryMessages,
  execution,
  nextToolIndex
}) {
  const language = runtime.language;
  const { toolCall, name, rawArgs, result, parsed } = execution;

  if (isPendingApprovalTool(name, parsed)) {
    await pauseForApproval({
      runtime,
      emit,
      toolCall,
      rawArgs,
      parsed,
      toolCalls,
      nextToolIndex,
      step
    });
    emit({ type: "status", message: t(language, "agent.waitingUser") });
    return { paused: true };
  }

  if (parsed?.ok === false) {
    const failureKey = `${name}:${rawArgs}`;
    const failureCount = (toolFailures.get(failureKey) || 0) + 1;
    toolFailures.set(failureKey, failureCount);
    if (counters.lastFailedToolName === name) {
      counters.consecutiveFailedToolCount += 1;
    } else {
      counters.lastFailedToolName = name;
      counters.consecutiveFailedToolCount = 1;
    }

    emit({ type: "tool_error", name, message: parsed.error || "Tool failed.", toolCallId: toolCall.id, result });
    runtime.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      name,
      content: result
    });
    recoveryMessages.push(buildToolRecoveryMessage(name, rawArgs, parsed, failureCount, counters.consecutiveFailedToolCount));

    if (counters.consecutiveFailedToolCount >= 3) {
      emit({
        type: "status",
        message: t(language, "agent.repeatedToolFailure", { name, count: counters.consecutiveFailedToolCount })
      });
    }
    return { paused: false };
  }

  counters.lastFailedToolName = "";
  counters.consecutiveFailedToolCount = 0;
  emit({ type: "tool_result", name, result, toolCallId: toolCall.id });
  runtime.messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    name,
    content: result
  });

  emitToolDomainEvents({ emit, name, parsed, rawArgs, language });
  return { paused: false };
}

export function isParallelSafeToolCall(toolCall) {
  const name = toolCall?.function?.name ?? "";
  return PARALLEL_SAFE_TOOL_NAMES.has(name);
}

export async function pauseForApproval({
  runtime,
  emit,
  toolCall,
  rawArgs,
  parsed,
  toolCalls,
  nextToolIndex,
  step
}) {
  const approval = buildPendingApproval(toolCall.function?.name || "unknown", rawArgs, parsed, runtime.language);
  const continuation = {
    id: approval.id,
    kind: approval.kind,
    requestId: runtime.requestId || "",
    sessionId: runtime.sessionId || "",
    workspace: runtime.workspace,
    language: runtime.language,
    providerConfig: runtime.providerConfig,
    permissionMode: runtime.permissionMode,
    attachments: runtime.attachments,
    messages: runtime.messages,
    pendingToolCall: normalizeToolCalls([toolCall])[0],
    remainingToolCalls: normalizeToolCalls(toolCalls.slice(nextToolIndex)),
    step,
    maxAgentSteps: runtime.maxAgentSteps,
    approval,
    createdAt: Date.now()
  };
  await upsertAgentContinuation(continuation);
  emitPendingApprovalEvent(emit, approval, runtime.language);
}

export function buildPendingApproval(name, rawArgs, parsed, language) {
  if (name === "run_command" || name === "start_command") {
    return {
      kind: "command",
      id: parsed.commandId,
      toolName: name,
      mode: parsed.mode || (name === "start_command" ? "start" : "run"),
      command: parsed.command,
      reason: parsed.riskReason || commandApprovalReason(parsed.highRisk, language),
      cwd: parsed.cwd || "",
      timeoutMs: parsed.timeoutMs || null,
      shell: parsed.shell || "",
      inheritedEnv: parsed.inheritedEnv !== false,
      highRisk: Boolean(parsed.highRisk)
    };
  }

  if (name === "ask_user") {
    return {
      kind: "question",
      id: randomUUID(),
      question: parsed.question,
      context: parsed.context || "",
      options: Array.isArray(parsed.options) ? parsed.options : []
    };
  }

  const args = parseToolArguments(rawArgs);
  return {
    kind: "patch",
    id: parsed.patchId,
    summary: parsed.summary || "Proposed patch",
    patch: parsed.patch || (name === "apply_patch" ? args.patch || "" : ""),
    toolName: name
  };
}

export function emitPendingApprovalEvent(emit, approval, language) {
  if (approval.kind === "command") {
    emit({
      type: "command_pending",
      commandId: approval.id,
      command: approval.command,
      cwd: approval.cwd || "",
      timeoutMs: approval.timeoutMs || null,
      shell: approval.shell || "",
      inheritedEnv: approval.inheritedEnv !== false,
      highRisk: Boolean(approval.highRisk),
      reason: approval.reason || commandApprovalReason(approval.highRisk, language)
    });
    return;
  }

  if (approval.kind === "question") {
    emit({
      type: "ask_user_pending",
      questionId: approval.id,
      question: approval.question,
      context: approval.context || "",
      options: Array.isArray(approval.options) ? approval.options : []
    });
    return;
  }

  emit({
    type: "patch_proposed",
    patchId: approval.id,
    summary: approval.summary,
    patch: approval.patch || ""
  });
}

export function emitToolDomainEvents({ emit, name, parsed, rawArgs, language }) {
  try {
    if (name === "update_plan") {
      emit({ type: "plan_update", items: parsed.items ?? [] });
    }
    if (name === "apply_patch" && parsed.applied) {
      emit({
        type: "patch_applied",
        patchId: parsed.patchId,
        summary: parsed.summary,
        strategy: parsed.strategy
      });
    }
    if (name === "write_file" || name === "delete_file" || name === "replace_text") {
      if (parsed.written || parsed.deleted) {
        emit({
          type: "patch_applied",
          patchId: parsed.path,
          summary: name === "replace_text" ? `Updated ${parsed.path}` : parsed.written ? `Wrote ${parsed.path}` : `Deleted ${parsed.path}`,
          strategy: name
        });
      }
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    emit({
      type: "status",
      message: t(language, "agent.toolEventFailed", { name, message: messageText })
    });
  }
}

export function isPendingApprovalTool(name, parsed) {
  return Boolean(
    parsed?.pending &&
    ["run_command", "start_command", "apply_patch", "write_file", "delete_file", "replace_text", "ask_user"].includes(name)
  );
}

export function isRuntimeFullAccess(runtime) {
  const permissions = getAutoApprovalState({
    workspace: runtime.workspace,
    sessionId: runtime.sessionId || ""
  });
  return runtime.permissionMode === "full" || permissions.fullAccessAutoApproval;
}

export function createToolCounters() {
  const state = {
    lastFailedToolName: "",
    consecutiveFailedToolCount: 0
  };
  return {
    get lastFailedToolName() {
      return state.lastFailedToolName;
    },
    set lastFailedToolName(value) {
      state.lastFailedToolName = value;
    },
    get consecutiveFailedToolCount() {
      return state.consecutiveFailedToolCount;
    },
    set consecutiveFailedToolCount(value) {
      state.consecutiveFailedToolCount = value;
    }
  };
}

export async function hydrateContinuationProviderConfig(providerConfig = {}) {
  const saved = await loadAppConfig().catch(() => ({}));
  return {
    ...saved,
    ...providerConfig,
    apiKey: providerConfig.apiKey || saved.apiKey || ""
  };
}

export async function resolveContinuationDecision(continuation, payload, language) {
  const approval = continuation.approval || {};
  const decision = payload.decision === "discarded" || payload.decision === "dismissed" ? payload.decision : "approved";
  const toolName = continuation.pendingToolCall?.function?.name || approval.toolName || approval.kind || "tool";

  if (decision !== "approved") {
    if (approval.kind === "command") discardPendingCommand(approval.id);
    if (approval.kind === "patch") discardPendingPatch(approval.id);
    return {
      result: JSON.stringify({
        ok: true,
        tool: toolName,
        approved: false,
        discarded: true,
        message: decision === "dismissed" ? "The user dismissed this request." : "The user rejected this request."
      }, null, 2)
    };
  }

  if (approval.kind === "command") {
    const commandRecord = {
      ...approval,
      id: approval.id,
      workspace: continuation.workspace,
      requestId: continuation.requestId,
      sessionId: continuation.sessionId,
      language
    };
    try {
      discardPendingCommand(approval.id);
      const commandResult = await executeCommandRecord(commandRecord, { allowFuture: Boolean(payload.allowFuture), language });
      const output = parseToolResult(commandResult.result);
      return {
        result: JSON.stringify({ ok: true, tool: commandRecord.toolName || "run_command", ...output }, null, 2),
        state: commandResult
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: JSON.stringify({
          ok: false,
          tool: "run_command",
          error: message,
          detail: [error?.stdout, error?.stderr].filter(Boolean).join("\n").trim(),
          errorType: "command_failed",
          recoverable: true
        }, null, 2)
      };
    }
  }

  if (approval.kind === "patch") {
    try {
      const patchResult = await applyPatchRecord({
        id: approval.id,
        workspace: continuation.workspace,
        patch: approval.patch,
        summary: approval.summary,
        language
      });
      discardPendingPatch(approval.id);
      return {
        result: JSON.stringify({
          ok: true,
          tool: toolName,
          applied: true,
          patchId: patchResult.patchId,
          summary: patchResult.summary,
          strategy: patchResult.strategy
        }, null, 2),
        state: patchResult,
        domainEvent: {
          type: "patch_applied",
          patchId: patchResult.patchId,
          summary: patchResult.summary,
          strategy: patchResult.strategy
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: JSON.stringify({
          ok: false,
          tool: toolName,
          error: message,
          errorType: "command_failed",
          recoverable: true
        }, null, 2)
      };
    }
  }

  if (approval.kind === "question") {
    return {
      result: JSON.stringify({
        ok: true,
        tool: "ask_user",
        question: approval.question,
        answer: String(payload.answer || payload.option || "")
      }, null, 2)
    };
  }

  return {
    result: JSON.stringify({
      ok: false,
      tool: toolName,
      error: "Unknown pending approval type.",
      errorType: "invalid_arguments",
      recoverable: true
    }, null, 2)
  };
}

export function buildResumeResponse(continuation, resumeResult) {
  const state = resumeResult.state || {};
  return {
    ok: true,
    kind: continuation.kind,
    continuationId: continuation.id,
    commandAutoApproval: typeof state.commandAutoApproval === "boolean" ? state.commandAutoApproval : undefined,
    patchAutoApproval: typeof state.patchAutoApproval === "boolean" ? state.patchAutoApproval : undefined,
    fullAccessAutoApproval: typeof state.fullAccessAutoApproval === "boolean" ? state.fullAccessAutoApproval : undefined,
    autoApproveFutureCommands: typeof state.autoApproveFutureCommands === "boolean" ? state.autoApproveFutureCommands : undefined,
    commandAutoApprovalExpiresAt: typeof state.commandAutoApprovalExpiresAt === "number" ? state.commandAutoApprovalExpiresAt : null,
    patchAutoApprovalExpiresAt: typeof state.patchAutoApprovalExpiresAt === "number" ? state.patchAutoApprovalExpiresAt : null,
    summary: state.summary || undefined,
    strategy: state.strategy || undefined
  };
}

export function buildToolRecoveryMessage(toolName, rawArgs, parsed, sameCallFailureCount, consecutiveToolFailureCount) {
  return {
    role: "system",
    content: [
      "Tool error recovery instruction:",
      `Tool: ${toolName}`,
      `Error type: ${parsed.errorType || "unknown"}`,
      `Error: ${parsed.error || "unknown"}`,
      parsed.detail ? `Detail: ${String(parsed.detail).slice(0, 2000)}` : "",
      `Same call failure count: ${sameCallFailureCount}`,
      `Consecutive failures for this tool: ${consecutiveToolFailureCount}`,
      `Arguments: ${String(rawArgs || "{}").slice(0, 2000)}`,
      recoveryGuidanceForError(parsed.errorType),
      consecutiveToolFailureCount >= 2
        ? "Do not call the same tool again until you have changed the arguments, inspected the relevant state with a different tool, or asked the user for clarification."
        : "Before the next tool call, briefly reason about the likely cause and choose a safer alternate action."
    ].filter(Boolean).join("\n")
  };
}

export function recoveryGuidanceForError(errorType) {
  switch (errorType) {
    case "file_not_found":
      return "Recovery: list the parent directory or search for the file before reading, writing, deleting, or patching it.";
    case "permission_denied":
      return "Recovery: avoid privileged operations; ask the user for approval or choose a workspace-local alternative.";
    case "invalid_arguments":
      return "Recovery: fix the JSON/tool arguments schema before retrying. Do not repeat malformed arguments.";
    case "path_security":
      return "Recovery: in default permission mode, keep paths relative to the workspace and remove absolute paths or parent-directory traversal. In full access mode, retry with a concrete absolute path.";
    case "timeout":
      return "Recovery: retry with a smaller scope, a narrower command, or a shorter output.";
    case "network":
      return "Recovery: retry once with backoff, use cached/local context if available, or ask the user to check connectivity.";
    case "command_failed":
      return "Recovery: inspect stderr/stdout, then adjust the command or run a read-only diagnostic command first.";
    default:
      return "Recovery: inspect the error detail and change strategy rather than repeating the same call.";
  }
}

export function commandApprovalReason(highRisk, language) {
  return highRisk
    ? t(language, "tools.commandPendingHighRisk")
    : t(language, "tools.commandPendingNormal");
}

export function parseToolArguments(rawArgs) {
  try {
    return rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return {};
  }
}

export function parseToolResult(result) {
  try {
    return result ? JSON.parse(result) : { ok: false, error: "Tool returned an empty result.", errorType: "empty_result" };
  } catch {
    return { ok: true, result: String(result ?? "") };
  }
}
