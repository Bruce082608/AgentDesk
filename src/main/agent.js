import { completeChat, normalizeProviderConfig, streamWithTools } from "./providers.js";
import { executeToolCall, toolDefinitions } from "./tools.js";
import { getDynamicSafetyMarginTokens, getInputBudgetTokens } from "../shared/contextBudget.js";
import { countChatMessageTokens, countChatMessagesTokens, countTextTokens } from "../shared/tokenCounter.js";

const DEFAULT_MAX_AGENT_STEPS = 64;
const RECENT_HISTORY_RATIO_AFTER_SUMMARY = 0.45;
const MAX_STREAM_RECOVERY_ATTEMPTS = 2;
const SUMMARY_TOKEN_RATIO = 0.08;
const SUMMARY_TRANSCRIPT_RATIO = 0.8;

export async function runAgentTurn(payload, emit) {
  const workspace = payload.workspace || process.cwd();
  const providerConfig = payload.providerConfig ?? {};
  const userInput = String(payload.input ?? "").trim();
  const priorMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const normalizedProviderConfig = normalizeProviderConfig(providerConfig);
  const contextTokens = normalizedProviderConfig.contextTokens;
  const maxOutputTokens = normalizedProviderConfig.maxTokens;
  const inputBudgetTokens = getInputBudgetTokens(contextTokens, maxOutputTokens);
  const maxAgentSteps = getMaxAgentSteps(providerConfig.maxAgentSteps);
  const signal = payload.signal;

  if (!userInput) throw new Error("消息不能为空。");
  if (!workspace) throw new Error("请先选择 workspace。");

  const systemMessage = {
    role: "system",
    content: [
      "You are a local coding agent running inside a desktop demo app.",
      "You can inspect and edit files through the provided tools.",
      "You may create, overwrite, or delete files with write_file/delete_file when that is clearer than a patch.",
      "If you need a missing decision or clarification from the user, call ask_user with one concise question and 2-6 clear options, then stop and wait for the user's selected option.",
      "CRITICAL - Patch Accuracy Rules:",
      "• Before generating a patch, always use read_file to get the LATEST content of the target file.",
      "• If you already read the file earlier in this conversation but a patch was applied since then, re-read the file.",
      "• Every line of context in your diff (lines starting with a space) MUST exactly match the file content.",
      "• The hunk header (@@ -a,b +c,d @@) line numbers must be correct relative to the current file.",
      "• Generate the patch using diff --git format with proper a/ and b/ path prefixes.",
      "Keep changes small and explain what you changed.",
      "Before doing substantive work, call update_plan with 2-5 concrete steps. Keep it updated as work progresses.",
      "When editing files, call apply_patch with a unified diff. The user must approve the patch before it is applied.",
      "When you need project context, list files before reading.",
      "When the user needs current or online information, use web_search and cite the returned URLs in your answer.",
      "Use PowerShell commands on Windows, and POSIX shell commands on macOS/Linux.",
      "High-risk operations such as deleting files are allowed only through tools and will require user approval before execution.",
      "Error recovery: when a tool fails, explicitly reflect on the likely cause, choose a different recovery action, and avoid repeating the same failing call with identical arguments."
    ].join("\n")
  };

  const attachmentMessage = buildAttachmentMessage(attachments);
  const { messages, compressed } = await buildMessages({
    systemMessage,
    attachmentMessage,
    priorMessages,
    userInput,
    contextTokens,
    providerConfig,
    signal,
    emit
  });

  emit({
    type: "status",
    message: compressed
      ? `发送给模型，上下文窗口 ${contextTokens.toLocaleString("en-US")} tokens；可用输入预算 ${inputBudgetTokens.toLocaleString("en-US")} tokens；已注入早期对话摘要。`
      : `发送给模型，上下文窗口 ${contextTokens.toLocaleString("en-US")} tokens；可用输入预算 ${inputBudgetTokens.toLocaleString("en-US")} tokens...`
  });
  const toolFailures = new Map();
  let lastFailedToolName = "";
  let consecutiveFailedToolCount = 0;
  let streamRecoveryAttempts = 0;

  for (let step = 0; step < maxAgentSteps; step += 1) {
    throwIfAborted(signal);
    if (step > 0) {
      emit({ type: "status", message: `继续执行工具循环 ${step + 1}/${maxAgentSteps}...` });
    }
    const { message, usage, provider, finishReason, interrupted, streamError } = await streamWithTools({
      config: providerConfig,
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
      emit({
        type: "status",
        message: streamRecoveryAttempts <= MAX_STREAM_RECOVERY_ATTEMPTS
          ? `模型流式连接中断，已保留当前输出并尝试从断点继续 (${streamRecoveryAttempts}/${MAX_STREAM_RECOVERY_ATTEMPTS})。${streamError ? `原因：${streamError}` : ""}`
          : `模型流式连接中断，已保留当前输出；自动续接次数已用尽。${streamError ? `原因：${streamError}` : ""}`
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
          message: `模型本轮没有返回正文。finish_reason=${finishReason ?? "unknown"}。请查看右侧 Activity 的接口用量或错误信息。`,
          provider: provider.label,
          model: provider.model,
          finishReason,
          usage
        });
      }
      return;
    }

    const recoveryMessages = [];
    let shouldWaitForUserAnswer = false;

    for (const toolCall of toolCalls) {
      throwIfAborted(signal);
      const name = toolCall.function?.name ?? "unknown";
      const rawArgs = toolCall.function?.arguments ?? "{}";
      emit({ type: "tool_start", name, args: rawArgs });

      let result = "";
      let parsed = null;
      try {
        result = await executeToolCall(toolCall, {
          workspace,
          requestId: payload.requestId || "",
          sessionId: payload.sessionId || ""
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

      if (parsed?.ok === false) {
        const failureKey = `${name}:${rawArgs}`;
        const failureCount = (toolFailures.get(failureKey) || 0) + 1;
        toolFailures.set(failureKey, failureCount);
        if (lastFailedToolName === name) {
          consecutiveFailedToolCount += 1;
        } else {
          lastFailedToolName = name;
          consecutiveFailedToolCount = 1;
        }

        emit({ type: "tool_error", name, message: parsed.error || "Tool failed.", toolCallId: toolCall.id, result });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
        recoveryMessages.push(buildToolRecoveryMessage(name, rawArgs, parsed, failureCount, consecutiveFailedToolCount));

        if (consecutiveFailedToolCount >= 3) {
          emit({
            type: "status",
            message: `工具 ${name} 已连续失败 ${consecutiveFailedToolCount} 次，已把 stderr/stdout 写入上下文；下一轮必须换策略，而不是中断。`
          });
        }
        continue;
      }

      lastFailedToolName = "";
      consecutiveFailedToolCount = 0;
      emit({ type: "tool_result", name, result, toolCallId: toolCall.id });
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result
      });

      try {
        if (name === "update_plan") {
          emit({ type: "plan_update", items: parsed.items ?? [] });
        }
        if (name === "apply_patch") {
          if (parsed.applied) {
            emit({
              type: "patch_applied",
              patchId: parsed.patchId,
              summary: parsed.summary,
              strategy: parsed.strategy
            });
          } else {
            emit({
              type: "patch_proposed",
              patchId: parsed.patchId,
              summary: parsed.summary,
              patch: parseToolArguments(rawArgs).patch ?? ""
            });
          }
        }
        if (name === "write_file" || name === "delete_file") {
          if (parsed.pending) {
            emit({
              type: "patch_proposed",
              patchId: parsed.patchId,
              summary: parsed.summary,
              patch: parsed.patch || ""
            });
          } else if (parsed.written || parsed.deleted) {
            emit({
              type: "patch_applied",
              patchId: parsed.path,
              summary: parsed.written ? `Wrote ${parsed.path}` : `Deleted ${parsed.path}`,
              strategy: name
            });
          }
        }
        if (name === "run_command") {
          if (parsed.pending) {
            emit({
              type: "command_pending",
              commandId: parsed.commandId,
              command: parsed.command,
              highRisk: Boolean(parsed.highRisk),
              reason: parsed.highRisk
                ? "这个命令属于高危操作，可能删除文件、重置 Git、修改权限或影响系统，需要确认后执行。"
                : "这个命令可能修改环境、安装依赖、访问网络或产生副作用，需要确认后执行。"
            });
          }
        }
        if (name === "ask_user") {
          if (parsed.pending) {
            emit({
              type: "ask_user_pending",
              question: parsed.question,
              context: parsed.context || "",
              options: Array.isArray(parsed.options) ? parsed.options : []
            });
            shouldWaitForUserAnswer = true;
          }
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        emit({
          type: "status",
          message: `工具 ${name} 已返回结果，但 UI 事件处理失败：${messageText}`
        });
      }
    }

    if (recoveryMessages.length > 0) {
      messages.push(...recoveryMessages);
      emit({
        type: "status",
        message: "工具失败信息已结构化写入上下文；下一轮会按错误类型选择恢复策略。"
      });
    }

    if (shouldWaitForUserAnswer) {
      emit({ type: "status", message: "Agent 正在等待用户选择后继续。" });
      return;
    }
  }

  throw new Error(`agent 超过最大工具循环次数 ${maxAgentSteps}，已停止。可以在进阶菜单调高工具调用次数限制后重试。`);
}

function buildAttachmentMessage(attachments) {
  if (attachments.length === 0) return null;
  return {
    role: "user",
    content: [
      "Attached workspace files for context:",
      ...attachments.map((file) => `\n--- ${file.path} ---\n${String(file.content ?? "").slice(0, 50000)}`)
    ].join("\n")
  };
}

async function buildMessages({
  systemMessage,
  attachmentMessage,
  priorMessages,
  userInput,
  contextTokens,
  providerConfig,
  signal,
  emit
}) {
  const maxTokens = Math.max(4096, contextTokens);
  const maxOutputTokens = getEffectiveMaxOutputTokens(providerConfig, maxTokens);
  const safetyMarginTokens = getDynamicSafetyMarginTokens(maxTokens, maxOutputTokens);
  const inputBudgetTokens = getInputBudgetTokens(maxTokens, maxOutputTokens);
  const normalizedHistory = normalizeChatMessages(priorMessages);
  const userMessage = { role: "user", content: userInput };
  const fixedMessages = [systemMessage, attachmentMessage].filter(Boolean);
  const fixedTokens = countChatMessagesTokens([...fixedMessages, userMessage]);
  const historyTokens = countChatMessagesTokens(normalizedHistory);
  const fullInputTokens = fixedTokens + historyTokens;
  const historyBudget = Math.max(1024, inputBudgetTokens - fixedTokens);

  if (fullInputTokens <= inputBudgetTokens || normalizedHistory.length < 4) {
    return {
      messages: [...fixedMessages, ...selectRecentMessages(normalizedHistory, historyBudget), userMessage],
      compressed: false
    };
  }

  const recentBudget = Math.max(2048, Math.min(historyBudget, Math.floor(inputBudgetTokens * RECENT_HISTORY_RATIO_AFTER_SUMMARY)));
  const recentMessages = selectRecentMessages(normalizedHistory, recentBudget);
  const earlyMessages = normalizedHistory.slice(0, Math.max(0, normalizedHistory.length - recentMessages.length));

  if (earlyMessages.length === 0) {
    return {
      messages: [...fixedMessages, ...selectRecentMessages(normalizedHistory, historyBudget), userMessage],
      compressed: false
    };
  }

  emit({
    type: "status",
    message: `历史上下文接近可用输入预算（${fullInputTokens.toLocaleString("en-US")} / ${inputBudgetTokens.toLocaleString("en-US")} tokens；已预留输出 ${maxOutputTokens.toLocaleString("en-US")} tokens，安全余量 ${safetyMarginTokens.toLocaleString("en-US")} tokens），正在压缩 ${earlyMessages.length} 条早期消息...`
  });

  try {
    const summary = await summarizeHistoryMessages({
      messages: earlyMessages,
      config: providerConfig,
      contextTokens: maxTokens,
      signal
    });
    const summaryMessage = buildConversationSummaryMessage(summary);
    const remainingBudget = Math.max(
      1024,
      inputBudgetTokens - countChatMessagesTokens([...fixedMessages, summaryMessage, userMessage])
    );
    const recentWithinBudget = selectRecentMessages(recentMessages, remainingBudget);

    emit({
      type: "status",
      message: `早期对话已压缩为 ${countChatMessageTokens(summaryMessage).toLocaleString("en-US")} tokens 的记忆摘要。`
    });

    return {
      messages: [...fixedMessages, summaryMessage, ...recentWithinBudget, userMessage],
      compressed: true
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    emit({
      type: "status",
      message: `早期对话摘要失败，已退回滑动窗口上下文：${messageText}`
    });
    return {
      messages: [...fixedMessages, ...selectRecentMessages(normalizedHistory, historyBudget), userMessage],
      compressed: false
    };
  }
}

function normalizeChatMessages(messages) {
  const normalized = [];
  for (const message of messages) {
    const role = message?.role;
    if (role === "user" || role === "system") {
      const content = String(message.content ?? "").trim();
      if (content) normalized.push({ role, content });
      continue;
    }

    if (role === "assistant") {
      const toolCalls = normalizeToolCalls(message.tool_calls);
      const content = [
        String(message?.content ?? ""),
        message?.reasoning ? `\n\n[Assistant reasoning]\n${String(message.reasoning)}` : ""
      ].join("").trim();
      if (content || toolCalls.length > 0) {
        normalized.push({
          role: "assistant",
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        });
      }
      continue;
    }

    if (role === "tool") {
      const toolCallId = String(message.tool_call_id ?? "").trim();
      const content = String(message.content ?? "").trim();
      if (toolCallId && content) {
        normalized.push({
          role: "tool",
          tool_call_id: toolCallId,
          content,
          ...(message.name ? { name: String(message.name) } : {})
        });
      }
    }
  }
  return repairChatProtocol(normalized);
}

function normalizeToolCalls(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((toolCall) => {
      const id = String(toolCall?.id ?? "").trim();
      if (!id) return null;
      return {
        id,
        type: toolCall?.type || "function",
        function: {
          name: String(toolCall?.function?.name ?? ""),
          arguments: String(toolCall?.function?.arguments ?? "")
        }
      };
    })
    .filter(Boolean);
}

function repairChatProtocol(messages) {
  const repaired = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const remainingIds = new Set(message.tool_calls.map((toolCall) => toolCall.id).filter(Boolean));
      const group = [message];
      let nextIndex = index + 1;

      while (
        nextIndex < messages.length &&
        messages[nextIndex].role === "tool" &&
        remainingIds.has(messages[nextIndex].tool_call_id)
      ) {
        group.push(messages[nextIndex]);
        remainingIds.delete(messages[nextIndex].tool_call_id);
        nextIndex += 1;
      }

      if (remainingIds.size === 0) {
        repaired.push(...group);
      } else {
        const partialToolResults = group
          .slice(1)
          .map((toolMessage) => `Tool result ${toolMessage.tool_call_id}:\n${String(toolMessage.content || "").slice(0, 4000)}`)
          .join("\n\n");
        repaired.push({
          role: "system",
          content: [
            message.content ? `Assistant message before an incomplete tool-call group:\n${message.content}` : "",
            "Some earlier tool calls were truncated before their tool results. Treat the following as historical memory, not as an active tool call:",
            JSON.stringify(message.tool_calls).slice(0, 4000),
            partialToolResults
          ].filter(Boolean).join("\n\n")
        });
      }
      index = nextIndex - 1;
      continue;
    }

    if (message.role === "tool") {
      repaired.push({
        role: "system",
        content: [
          `Orphaned earlier tool result (${message.name || message.tool_call_id || "unknown"}):`,
          String(message.content || "").slice(0, 12000)
        ].join("\n")
      });
      continue;
    }

    if (message.role === "assistant" && !message.content) continue;
    repaired.push(message);
  }

  return repaired;
}

async function summarizeHistoryMessages({ messages, config, contextTokens, signal }) {
  const { maxSummaryTokens, transcriptBudget, summaryConfig } = getSummaryCompressionBudgets({
    config,
    contextTokens
  });
  const transcript = buildSummaryTranscript(messages, transcriptBudget);
  const response = await completeChat({
    config: summaryConfig,
    maxTokens: maxSummaryTokens,
    signal,
    messages: [
      {
        role: "system",
        content: [
          "You compress earlier conversation history for a coding agent.",
          "Write a concise but durable memory summary.",
          "Preserve user goals, project constraints, decisions, file paths, bugs fixed, pending tasks, approvals, and warnings.",
          "Preserve important tool-call results and command errors as facts the future agent can use.",
          "The transcript may already contain compressed memory summaries. Merge them with newer facts instead of replacing or dropping them.",
          "Do not invent facts. Prefer bullet points. Do not include small talk unless it changes the task."
        ].join("\n")
      },
      {
        role: "user",
        content: `Summarize these earlier messages for future turns:\n\n${transcript}`
      }
    ]
  });

  const summary = String(response.message?.content || "").trim();
  if (!summary) throw new Error("模型返回了空摘要。");
  return summary;
}

function getSummaryCompressionBudgets({ config, contextTokens }) {
  const sourceContextTokens = Math.max(4096, Math.floor(Number(contextTokens) || 0));
  const summaryModel = String(config.summaryModel || "").trim();
  const baseSummaryConfig = {
    ...config,
    model: summaryModel || config.model,
    thinkingMode: "disabled"
  };
  const normalizedSummaryConfig = normalizeProviderConfig(baseSummaryConfig);
  const summaryContextTokens = normalizedSummaryConfig.contextTokens;
  const modelMaxOutputTokens = getEffectiveMaxOutputTokens(baseSummaryConfig, summaryContextTokens);
  const desiredSummaryTokens = Math.max(1024, Math.floor(sourceContextTokens * SUMMARY_TOKEN_RATIO));
  const maxSummaryTokens = Math.min(modelMaxOutputTokens, desiredSummaryTokens);
  const summaryInputBudgetTokens = getInputBudgetTokens(summaryContextTokens, maxSummaryTokens);
  const desiredTranscriptTokens = Math.max(4096, Math.floor(sourceContextTokens * SUMMARY_TRANSCRIPT_RATIO));
  const transcriptBudget = Math.max(4096, Math.min(desiredTranscriptTokens, Math.floor(summaryInputBudgetTokens * 0.9)));

  return {
    maxSummaryTokens,
    transcriptBudget,
    summaryConfig: {
      ...baseSummaryConfig,
      maxTokens: maxSummaryTokens
    },
    summaryContextTokens,
    summaryInputBudgetTokens
  };
}

function buildSummaryTranscript(messages, tokenBudget) {
  const selected = [];
  let totalTokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const content = String(message.content || "");
    const label = formatSummaryRoleLabel(message);
    const entry = [
      `${label}:`,
      content,
      message.tool_calls ? `Tool calls: ${JSON.stringify(message.tool_calls).slice(0, 4000)}` : "",
      message.tool_call_id ? `Tool call id: ${message.tool_call_id}` : ""
    ].filter(Boolean).join("\n");
    const tokens = countTextTokens(entry);
    if (totalTokens + tokens > tokenBudget && selected.length > 0) break;
    selected.unshift(entry);
    totalTokens += tokens;
  }

  return selected.join("\n\n---\n\n");
}

function formatSummaryRoleLabel(message) {
  if (message.role === "assistant") return "Assistant";
  if (message.role === "tool") return `Tool result${message.name ? ` (${message.name})` : ""}`;
  if (message.role === "system") return "System memory";
  return "User";
}

function buildConversationSummaryMessage(summary) {
  return {
    role: "system",
    content: [
      "Compressed memory summary from earlier conversation history:",
      summary,
      "",
      "Use this summary as durable context. It may omit exact wording; when editing files, inspect the current workspace before acting."
    ].join("\n")
  };
}

function buildStreamContinuationMessage(partialMessage, streamError) {
  const contentTail = String(partialMessage.content || "").slice(-4000);
  const reasoningTail = String(partialMessage.reasoning_content || "").slice(-2000);
  return {
    role: "system",
    content: [
      "The previous streamed assistant response was interrupted before it finished.",
      streamError ? `Stream error: ${streamError}` : "",
      contentTail ? `Visible response tail before interruption:\n${contentTail}` : "",
      reasoningTail ? `Reasoning tail before interruption:\n${reasoningTail}` : "",
      "Continue from exactly where the response stopped. Do not repeat completed text. If you were about to call a tool, re-issue the full intended tool call with complete valid arguments."
    ].filter(Boolean).join("\n\n")
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("请求已取消。");
}

function getMaxAgentSteps(configuredValue) {
  const rawValue = configuredValue ?? process.env.AGENT_MAX_STEPS;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_AGENT_STEPS;
  return Math.min(Math.max(Math.floor(parsed), 8), 256);
}

function getEffectiveContextTokens(config) {
  return normalizeProviderConfig(config).contextTokens;
}

function getEffectiveMaxOutputTokens(config, contextTokens) {
  return Math.min(normalizeProviderConfig(config).maxTokens, Math.max(1, contextTokens - 1024));
}

function parseToolArguments(rawArgs) {
  try {
    return rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return {};
  }
}

function parseToolResult(result) {
  try {
    return result ? JSON.parse(result) : { ok: false, error: "Tool returned an empty result.", errorType: "empty_result" };
  } catch {
    return { ok: true, result: String(result ?? "") };
  }
}

function buildToolRecoveryMessage(toolName, rawArgs, parsed, sameCallFailureCount, consecutiveToolFailureCount) {
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

function recoveryGuidanceForError(errorType) {
  switch (errorType) {
    case "file_not_found":
      return "Recovery: list the parent directory or search for the file before reading, writing, deleting, or patching it.";
    case "permission_denied":
      return "Recovery: avoid privileged operations; ask the user for approval or choose a workspace-local alternative.";
    case "invalid_arguments":
      return "Recovery: fix the JSON/tool arguments schema before retrying. Do not repeat malformed arguments.";
    case "path_security":
      return "Recovery: keep paths relative to the workspace and remove absolute paths or parent-directory traversal.";
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

function selectRecentMessages(messages, contextTokens) {
  const maxTokens = Math.max(4096, contextTokens);
  const selected = [];
  let totalTokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const normalized = {
      role: message.role,
      content: String(message?.content ?? ""),
      ...(message.tool_calls ? { tool_calls: normalizeToolCalls(message.tool_calls) } : {}),
      ...(message.tool_call_id ? { tool_call_id: String(message.tool_call_id) } : {}),
      ...(message.name ? { name: String(message.name) } : {})
    };
    const messageTokens = countChatMessageTokens(normalized);
    const nextTotal = totalTokens + messageTokens;
    if (nextTotal > maxTokens && selected.length > 0) break;
    selected.unshift(normalized);
    totalTokens = nextTotal;
  }

  return repairChatProtocol(selected);
}

export const __test__ = {
  getSummaryCompressionBudgets
};
