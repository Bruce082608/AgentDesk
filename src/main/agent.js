import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { completeChat, normalizeProviderConfig, streamWithTools } from "./providers.js";
import { toolDefinitions } from "./tools.js";
import { getAutoApprovalState } from "./patch-approval.js";
import { normalizeLanguage, t } from "./i18n.js";
import { getInputBudgetTokens } from "../shared/contextBudget.js";
import { deleteAgentContinuation, getAgentContinuation } from "./persistence.js";

// Import from split agent modules
import {
  buildAttachmentMessage,
  buildMessages,
  buildStreamContinuationMessage,
  throwIfAborted,
  formatTokens,
  getEffectiveMaxOutputTokens,
  normalizeToolCalls,
  buildCompressionCacheKey,
  getSummaryCompressionBudgets
} from "./agent/agent-context.js";

import {
  processToolCalls,
  executeRuntimeToolCall,
  handleToolExecution,
  isParallelSafeToolCall,
  pauseForApproval,
  buildPendingApproval,
  emitPendingApprovalEvent,
  emitToolDomainEvents,
  isPendingApprovalTool,
  createToolCounters,
  resolveContinuationDecision,
  buildResumeResponse,
  buildToolRecoveryMessage,
  recoveryGuidanceForError,
  isRuntimeFullAccess,
  hydrateContinuationProviderConfig,
  commandApprovalReason,
  parseToolArguments,
  parseToolResult
} from "./agent/agent-tools.js";

const DEFAULT_MAX_AGENT_STEPS = 64;
const MAX_STREAM_RECOVERY_ATTEMPTS = 2;

export async function runAgentTurn(payload, emit) {
  const workspace = payload.workspace || process.cwd();
  const providerConfig = payload.providerConfig ?? {};
  const userInput = String(payload.input ?? "").trim();
  const priorMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const normalizedProviderConfig = normalizeProviderConfig(providerConfig);
  const language = normalizeLanguage(payload.language);
  const permissions = getAutoApprovalState({
    workspace,
    sessionId: payload.sessionId || ""
  });
  const fullAccess = payload.permissionMode === "full" || permissions.fullAccessAutoApproval;
  const contextTokens = normalizedProviderConfig.contextTokens;
  const maxOutputTokens = normalizedProviderConfig.maxTokens;
  const inputBudgetTokens = getInputBudgetTokens(contextTokens, maxOutputTokens);
  const maxAgentSteps = getMaxAgentSteps(providerConfig.maxAgentSteps);
  const signal = payload.signal;

  if (!userInput) throw new Error(t(language, "agent.emptyInput"));
  if (!workspace) throw new Error(t(language, "agent.missingWorkspace"));

  let hasDreaminaCli = false;
  let dreaminaPath = "dreamina";
  try {
    const localBinPath = path.join(os.homedir(), ".local", "bin", "dreamina");
    await fs.access(localBinPath);
    hasDreaminaCli = true;
    dreaminaPath = localBinPath;
  } catch {
    if (providerConfig.jimengToken) {
      hasDreaminaCli = true;
    }
  }

  const jimengInstruction = hasDreaminaCli
    ? `You have the Jimeng (即梦) CLI bound to this environment. Path to CLI: "${dreaminaPath}". 
When the user asks for image or video generation, you can use this CLI tool.
Authentication details:
${providerConfig.jimengToken ? `- User's Cookie/API Token: "${providerConfig.jimengToken}". You can use it if running custom scripts.` : ""}
- Official CLI Authentication: The CLI uses OAuth Device Flow ("dreamina login"). If the CLI reports "未检测到有效登录态", you should run "${dreaminaPath} login" (or "relogin" to force a fresh login) to print the OAuth scan code and link, then display them clearly to the user, wait/poll for completion, and confirm success to the user.
Guidelines for running tasks:
1. Always run "${dreaminaPath} <subcommand> -h" to see correct flags before submitting tasks.
2. Check user credit first via "${dreaminaPath} user_credit" if appropriate.
3. For text-to-image, use "${dreaminaPath} text2image --prompt=\"...\"".
4. For async tasks, query status using "${dreaminaPath} query_result --submit_id=<id>".`
    : "";

  const systemMessage = {
    role: "system",
    content: [
      "You are a local coding agent running inside a desktop demo app.",
      "You can inspect and edit files through the provided tools.",
      "You also have limited desktop-level tools (clipboard, display info, notifications, take_screenshot, send_image, background tasks). Use them only when requested.",
      "When the user requests a screenshot or requests to send an image, you MUST call the take_screenshot or send_image tool to capture/deliver the image. Do NOT claim you have captured or sent it without actually calling the corresponding tool.",
      "When you generate, edit, or save any image or video file, you MUST include a standard Markdown image link in your message using its absolute file path, e.g. `![alt text](C:/absolute/path/to/media.png)` or `![alt text](/absolute/path/to/media.mp4)`. This allows the user to preview and interact with the image or video directly in the chat dialog.",
      "Before doing substantive work, call update_plan with 2-5 concrete steps. Keep it updated. Keep changes small and explain them.",
      jimengInstruction,
      fullAccess
        ? "Permission mode: FULL ACCESS. Shell commands, file writes/deletes, and patches are approved automatically. File tools can use absolute paths, home paths (~), and paths outside the workspace. Do not ask for user approval."
        : "Permission mode: DEFAULT. Side-effecting commands, file writes/deletes, and patches require user approval. read_file only accepts workspace-relative paths and exact attached absolute paths.",
      "For frontend changes, prefer start_command for the dev server and browser_page to validate the UI.",
      "When waiting for a long-running process (such as video/image generation, queue positions, compilation) to finish, you MUST call the wait tool to pause execution for a reasonable duration (e.g., 60-300 seconds) instead of polling rapidly in an active loop or trying to run sleep in shell commands.",
      "Error recovery: when a tool fails, reflect on the likely cause, choose a different recovery action, and avoid repeating the identical failing call.",
      normalizedProviderConfig.thinkingMode === "enabled"
        ? "Before calling any tools, explain your step-by-step reasoning in reasoning/thinking tokens to think through the problem thoroughly."
        : ""
    ].filter(Boolean).join("\n")
  };

  const attachmentMessage = buildAttachmentMessage(attachments, normalizedProviderConfig.supportsVision);
  const { messages, compressed } = await buildMessages({
    systemMessage,
    attachmentMessage,
    priorMessages,
    userInput,
    contextTokens,
    providerConfig,
    language,
    signal,
    emit,
    sessionId: payload.sessionId || ""
  });

  emit({
    type: "status",
    message: compressed
      ? t(language, "agent.sendCompressed", { context: formatTokens(contextTokens), input: formatTokens(inputBudgetTokens) })
      : t(language, "agent.sendNormal", { context: formatTokens(contextTokens), input: formatTokens(inputBudgetTokens) })
  });

  await runAgentLoop({
    workspace,
    providerConfig,
    language,
    requestId: payload.requestId || "",
    sessionId: payload.sessionId || "",
    attachments,
    permissionMode: payload.permissionMode,
    maxAgentSteps,
    messages,
    signal,
    startStep: 0
  }, emit);
}

export async function resumeAgentContinuation(payload, emit) {
  const continuationId = String(payload.continuationId || payload.approvalId || payload.commandId || payload.patchId || payload.questionId || "");
  if (!continuationId) throw new Error("Missing continuation id.");
  const continuation = await getAgentContinuation(continuationId);
  if (!continuation) throw new Error("Pending approval does not exist or was already handled.");

  const language = normalizeLanguage(payload.language || continuation.language);
  const providerConfig = await hydrateContinuationProviderConfig(continuation.providerConfig);
  const runtime = {
    ...continuation,
    requestId: payload.requestId || continuation.requestId || "",
    language,
    providerConfig,
    signal: payload.signal,
    messages: Array.isArray(continuation.messages) ? continuation.messages : [],
    attachments: Array.isArray(continuation.attachments) ? continuation.attachments : [],
    startStep: Math.min((Number(continuation.step) || 0) + 1, Math.max(1, Number(continuation.maxAgentSteps) || DEFAULT_MAX_AGENT_STEPS))
  };
  const pendingToolCall = continuation.pendingToolCall;
  const toolName = pendingToolCall?.function?.name || continuation.approval?.toolName || continuation.kind || "tool";
  const toolCallId = pendingToolCall?.id || "";
  if (!toolCallId) throw new Error("Pending approval is missing the original tool_call id.");

  const resumeResult = await resolveContinuationDecision(continuation, payload, language);
  const parsed = parseToolResult(resumeResult.result);
  const response = buildResumeResponse(continuation, resumeResult);

  if (parsed?.ok === false) {
    emit({ type: "tool_error", name: toolName, message: parsed.error || "Tool failed.", toolCallId, result: resumeResult.result });
  } else {
    emit({ type: "tool_result", name: toolName, result: resumeResult.result, toolCallId });
  }

  runtime.messages.push({
    role: "tool",
    tool_call_id: toolCallId,
    name: toolName,
    content: resumeResult.result
  });

  if (resumeResult.domainEvent) emit(resumeResult.domainEvent);
  await deleteAgentContinuation(continuationId);

  if (parsed?.ok === false) {
    runtime.messages.push(buildToolRecoveryMessage(toolName, pendingToolCall.function?.arguments || "{}", parsed, 1, 1));
  }

  if (Array.isArray(continuation.remainingToolCalls) && continuation.remainingToolCalls.length > 0) {
    const toolProcessing = await processToolCalls({
      runtime,
      emit,
      toolCalls: continuation.remainingToolCalls,
      step: Number(continuation.step) || 0,
      toolFailures: new Map(),
      counters: createToolCounters()
    });
    if (toolProcessing.paused) return response;
  }

  await runAgentLoop(runtime, emit);
  return response;
}

async function runAgentLoop(runtime, emit) {
  const toolFailures = new Map();
  let lastFailedToolName = "";
  let consecutiveFailedToolCount = 0;
  let streamRecoveryAttempts = 0;
  const messages = runtime.messages;
  const maxAgentSteps = runtime.maxAgentSteps;
  const language = runtime.language;
  const signal = runtime.signal;

  for (let step = runtime.startStep || 0; step < maxAgentSteps; step += 1) {
    throwIfAborted(signal, language);
    if (step > 0) {
      emit({ type: "status", message: t(language, "agent.toolLoop", { step: step + 1, max: maxAgentSteps }) });
    }
    const { message, usage, provider, finishReason, interrupted, streamError } = await streamWithTools({
      config: runtime.providerConfig,
      messages,
      tools: toolDefinitions,
      signal,
      onDelta: (delta) => {
        if (delta.type === "content") emit({ type: "stream_delta", text: delta.text });
        if (delta.type === "reasoning") emit({ type: "reasoning_delta", text: delta.text });
        if (delta.type === "tool_call_delta") emit({ type: "tool_call_delta", name: delta.name || "", text: delta.text });
      }
    });

    emit({
      type: "model",
      message: message.content || "",
      provider: provider.label,
      model: provider.model,
      finishReason,
      reasoning: message.reasoning_content || "",
      usage,
      tool_calls: normalizeToolCalls(message.tool_calls)
    });

    messages.push(message);

    if (interrupted) {
      streamRecoveryAttempts += 1;
      const reason = streamError ? t(language, "agent.streamReason", { reason: streamError }) : "";
      const recoveryMessage = streamRecoveryAttempts <= MAX_STREAM_RECOVERY_ATTEMPTS
        ? t(language, "agent.streamRecovery", { attempt: streamRecoveryAttempts, max: MAX_STREAM_RECOVERY_ATTEMPTS, reason })
        : t(language, "agent.streamRecoveryExhausted", { reason });
      emit({
        type: "stream_recovery",
        message: recoveryMessage,
        attempt: streamRecoveryAttempts,
        maxAttempts: MAX_STREAM_RECOVERY_ATTEMPTS,
        recovering: streamRecoveryAttempts <= MAX_STREAM_RECOVERY_ATTEMPTS
      });

      if (streamRecoveryAttempts <= MAX_STREAM_RECOVERY_ATTEMPTS) {
        messages.push(buildStreamContinuationMessage(message, streamError));
        continue;
      }
      return;
    }

    streamRecoveryAttempts = 0;

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (!String(message.content || "").trim()) {
        emit({
          type: "model",
          message: t(language, "agent.emptyModelResponse", { finishReason: finishReason ?? "unknown" }),
          provider: provider.label,
          model: provider.model,
          finishReason,
          usage
        });
      }
      return;
    }

    const toolProcessing = await processToolCalls({
      runtime,
      emit,
      toolCalls,
      step,
      toolFailures,
      counters: {
        get lastFailedToolName() {
          return lastFailedToolName;
        },
        set lastFailedToolName(value) {
          lastFailedToolName = value;
        },
        get consecutiveFailedToolCount() {
          return consecutiveFailedToolCount;
        },
        set consecutiveFailedToolCount(value) {
          consecutiveFailedToolCount = value;
        }
      }
    });

    if (toolProcessing.paused) {
      return;
    }
  }

  throw new Error(t(language, "agent.maxSteps", { max: maxAgentSteps }));
}

function getMaxAgentSteps(configuredValue) {
  const rawValue = configuredValue ?? process.env.AGENT_MAX_STEPS;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_AGENT_STEPS;
  return Math.min(Math.max(Math.floor(parsed), 8), 256);
}

export function getEffectiveContextTokens(config) {
  return normalizeProviderConfig(config).contextTokens;
}

export const __test__ = {
  buildCompressionCacheKey,
  getSummaryCompressionBudgets,
  isParallelSafeToolCall,
  buildMessages
};
