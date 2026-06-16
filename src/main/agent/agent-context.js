import { createHash } from "node:crypto";
import { normalizeLanguage, t } from "../i18n.js";
import { normalizeProviderConfig, completeChat } from "../providers.js";
import { getInputBudgetTokens, getDynamicSafetyMarginTokens } from "../../shared/contextBudget.js";
import { countChatMessageTokens, countChatMessagesTokens, countTextTokens } from "../../shared/tokenCounter.js";

const RECENT_HISTORY_RATIO_AFTER_SUMMARY = 0.45;
const SUMMARY_TOKEN_RATIO = 0.15;
const SUMMARY_TRANSCRIPT_RATIO = 0.95;
const compressionCache = new Map();

export function buildAttachmentMessage(attachments, supportsVision) {
  if (attachments.length === 0) return null;
  
  const textAttachments = attachments.filter(a => !a.isImage);
  const imageAttachments = attachments.filter(a => a.isImage);
  
  if (supportsVision && imageAttachments.length > 0) {
    const contents = [];
    if (textAttachments.length > 0) {
      const textHeader = "Attached files for context. Some paths may be outside the workspace; exact attached paths are allowed for read_file:\n" +
        textAttachments.map((file) => `\n--- ${file.path} ---\n${String(file.content ?? "").slice(0, 50000)}`).join("\n");
      contents.push({ type: "text", text: textHeader });
    } else {
      contents.push({ type: "text", text: "Attached images for visual analysis:" });
    }

    for (const img of imageAttachments) {
      contents.push({
        type: "image_url",
        image_url: {
          url: img.content
        }
      });
      contents.push({
        type: "text",
        text: `[Image file path: ${img.path}]`
      });
    }

    return {
      role: "user",
      content: contents
    };
  } else {
    const lines = [
      "Attached files for context. Some paths may be outside the workspace; exact attached paths are allowed for read_file:"
    ];
    for (const file of attachments) {
      if (file.isImage) {
        lines.push(`\n--- ${file.path} ---\n[图片附件 (当前模型不支持视觉解析，已自动降级为纯文本占位符)]`);
      } else {
        lines.push(`\n--- ${file.path} ---\n${String(file.content ?? "").slice(0, 50000)}`);
      }
    }
    return {
      role: "user",
      content: lines.join("\n")
    };
  }
}

export async function buildMessages({
  systemMessage,
  attachmentMessage,
  priorMessages,
  userInput,
  contextTokens,
  providerConfig,
  language,
  signal,
  emit,
  sessionId
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

  const ACTIVE_COMPRESSION_MESSAGE_COUNT = 30;
  const WORKING_MEMORY_MESSAGE_COUNT = 12;

  const shouldCompress = fullInputTokens > inputBudgetTokens || normalizedHistory.length >= ACTIVE_COMPRESSION_MESSAGE_COUNT;

  if (!shouldCompress || normalizedHistory.length < 4) {
    return {
      messages: [...fixedMessages, ...selectRecentMessages(normalizedHistory, historyBudget), userMessage],
      compressed: false
    };
  }

  let recentMessages = [];
  let earlyMessages = [];

  if (fullInputTokens > inputBudgetTokens) {
    const recentBudget = Math.max(2048, Math.min(historyBudget, Math.floor(inputBudgetTokens * RECENT_HISTORY_RATIO_AFTER_SUMMARY)));
    recentMessages = selectRecentMessages(normalizedHistory, recentBudget);
    earlyMessages = normalizedHistory.slice(0, Math.max(0, normalizedHistory.length - recentMessages.length));
  } else {
    const splitIdx = Math.max(0, normalizedHistory.length - WORKING_MEMORY_MESSAGE_COUNT);
    recentMessages = normalizedHistory.slice(splitIdx);
    earlyMessages = normalizedHistory.slice(0, splitIdx);
  }

  if (earlyMessages.length === 0) {
    return {
      messages: [...fixedMessages, ...selectRecentMessages(normalizedHistory, historyBudget), userMessage],
      compressed: false
    };
  }

  const compressionStartMessage = t(language, "agent.compressionStart", {
      full: formatTokens(fullInputTokens),
      input: formatTokens(inputBudgetTokens),
      output: formatTokens(maxOutputTokens),
      margin: formatTokens(safetyMarginTokens),
      count: earlyMessages.length
  });
  emit({ type: "context_compression", phase: "start", message: compressionStartMessage });
  emit({ type: "status", message: compressionStartMessage });

  try {
    const summary = await summarizeHistoryMessages({
      messages: earlyMessages,
      config: providerConfig,
      contextTokens: maxTokens,
      language,
      signal,
      sessionId
    });
    const summaryMessage = buildConversationSummaryMessage(summary);
    const remainingBudget = Math.max(
      1024,
      inputBudgetTokens - countChatMessagesTokens([...fixedMessages, summaryMessage, userMessage])
    );
    const recentWithinBudget = selectRecentMessages(recentMessages, remainingBudget);

    const compressedMessages = [...fixedMessages, summaryMessage, ...recentWithinBudget, userMessage];
    const effectiveTokens = countChatMessagesTokens(compressedMessages);
    const compressionDoneMessage = t(language, "agent.compressionDone", { tokens: formatTokens(countChatMessageTokens(summaryMessage)) });
    emit({
      type: "context_compression",
      phase: "done",
      message: compressionDoneMessage,
      summary,
      effectiveTokens,
      inputBudgetTokens
    });
    emit({ type: "status", message: compressionDoneMessage });

    return {
      messages: compressedMessages,
      compressed: true
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const compressionFailedMessage = t(language, "agent.compressionFailed", { message: messageText });
    const fallbackMessages = [...fixedMessages, ...selectRecentMessages(normalizedHistory, historyBudget), userMessage];
    emit({
      type: "context_compression",
      phase: "failed",
      message: compressionFailedMessage,
      effectiveTokens: countChatMessagesTokens(fallbackMessages),
      inputBudgetTokens
    });
    emit({ type: "status", message: compressionFailedMessage });
    return {
      messages: fallbackMessages,
      compressed: false
    };
  }
}

export function normalizeChatMessages(messages) {
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
      const content = String(message?.content ?? "").trim();
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

export function normalizeToolCalls(value) {
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

export function repairChatProtocol(messages) {
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

export async function summarizeHistoryMessages({ messages, config, contextTokens, language, signal, sessionId }) {
  const { maxSummaryTokens, transcriptBudget, summaryConfig } = getSummaryCompressionBudgets({
    config,
    contextTokens
  });
  const transcript = buildSummaryTranscript(messages, transcriptBudget);
  const cacheKey = buildCompressionCacheKey({
    transcript,
    summaryModel: summaryConfig.model,
    contextTokens: summaryConfig.contextTokens,
    maxSummaryTokens
  });
  const cached = compressionCache.get(cacheKey);
  if (cached) return cached;
  const response = await completeChat({
    config: summaryConfig,
    maxTokens: maxSummaryTokens,
    signal,
    messages: [
      {
        role: "system",
        content: [
          "You are a precise conversation history compressor for a software development agent.",
          "You must compress the earlier conversation transcript and return a JSON object with the following structure:",
          "{",
          '  "goals": "Overall high-level goals of the user",',
          '  "constraints": "Key technical constraints, libraries, environment configurations, and file paths",',
          '  "modifiedFiles": ["List of files created, modified, or deleted so far"],',
          '  "fixedBugs": ["Specific errors or bugs encountered and how they were resolved"],',
          '  "decisionsAndApprovals": ["Key decisions, design choices, or user approvals/selections made"],',
          '  "pendingTasks": ["Next steps or tasks remaining to be done"],',
          '  "keyFacts": ["Important tool output summaries, command outputs, or facts the agent must remember"]',
          "}",
          "Ensure all JSON values are string or array of strings. Output ONLY the raw JSON. Do not wrap it in markdown code fences, do not write any pre-text or post-text."
        ].join("\n")
      },
      {
        role: "user",
        content: `Compress the following conversation transcript into the requested JSON format:\n\n${transcript}`
      }
    ]
  });

  let summary = String(response.message?.content || "").trim();
  if (!summary) throw new Error(t(language, "agent.emptySummary"));

  try {
    let cleaned = summary;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
    }
    const parsed = JSON.parse(cleaned.trim());
    summary = JSON.stringify(parsed, null, 2);
  } catch (err) {
    // fallback
  }

  compressionCache.set(cacheKey, summary);
  if (compressionCache.size > 200) {
    const oldest = compressionCache.keys().next().value;
    if (oldest) compressionCache.delete(oldest);
  }
  return summary;
}

export function getSummaryCompressionBudgets({ config, contextTokens }) {
  const sourceContextTokens = Math.max(4096, Math.floor(Number(contextTokens) || 0));
  const summaryModel = String(config.summaryModel || "").trim();
  const baseSummaryConfig = {
    ...config,
    model: summaryModel || config.model,
    thinkingMode: config.thinkingMode || "disabled"
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

export function buildSummaryTranscript(messages, tokenBudget) {
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

export function formatSummaryRoleLabel(message) {
  if (message.role === "assistant") return "Assistant";
  if (message.role === "tool") return `Tool result${message.name ? ` (${message.name})` : ""}`;
  if (message.role === "system") return "System memory";
  return "User";
}

export function buildConversationSummaryMessage(summary) {
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

export function buildStreamContinuationMessage(partialMessage, streamError) {
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

export function throwIfAborted(signal, language) {
  if (signal?.aborted) throw new Error(t(language, "agent.cancelled"));
}

export function formatTokens(value) {
  return Number(value || 0).toLocaleString("en-US");
}

export function getEffectiveMaxOutputTokens(config, contextTokens) {
  return Math.min(normalizeProviderConfig(config).maxTokens, Math.max(1, contextTokens - 1024));
}

export function buildCompressionCacheKey({ transcript, summaryModel, contextTokens, maxSummaryTokens }) {
  return createHash("sha1")
    .update([
      summaryModel || "",
      contextTokens || 0,
      maxSummaryTokens || 0,
      createHash("sha1").update(String(transcript || "")).digest("hex")
    ].join("|"))
    .digest("hex");
}

export function selectRecentMessages(messages, contextTokens) {
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
