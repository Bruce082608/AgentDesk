import { streamWithTools } from "./providers.js";
import { executeToolCall, toolDefinitions } from "./tools.js";

const MAX_AGENT_STEPS = 8;

export async function runAgentTurn(payload, emit) {
  const workspace = payload.workspace;
  const providerConfig = payload.providerConfig ?? {};
  const userInput = String(payload.input ?? "").trim();
  const priorMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const contextTokens = Math.max(4096, Number(providerConfig.contextTokens) || 1000000);

  if (!userInput) throw new Error("消息不能为空。");
  if (!workspace) throw new Error("请先选择 workspace。");

  const messages = [
    {
      role: "system",
      content: [
        "You are a local coding agent running inside a desktop demo app.",
        "You can inspect and edit files only through the provided tools.",
        "Keep changes small and explain what you changed.",
        "Before doing substantive work, call update_plan with 2-5 concrete steps. Keep it updated as work progresses.",
        "When editing files, call apply_patch with a unified diff. The user must approve the patch before it is applied.",
        "When you need project context, list files before reading.",
        "Prefer PowerShell commands on Windows.",
        "Never attempt destructive operations."
      ].join("\n")
    }
  ];

  if (attachments.length > 0) {
    messages.push({
      role: "user",
      content: [
        "Attached workspace files for context:",
        ...attachments.map((file) => `\n--- ${file.path} ---\n${String(file.content ?? "").slice(0, 50000)}`)
      ].join("\n")
    });
  }

  messages.push(...selectRecentMessages(priorMessages, contextTokens), { role: "user", content: userInput });

  emit({ type: "status", message: `发送给模型，上下文预算 ${contextTokens.toLocaleString("en-US")} tokens...` });

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    const { message, usage, provider, finishReason } = await streamWithTools({
      config: providerConfig,
      messages,
      tools: toolDefinitions,
      onDelta: (delta) => {
        if (delta.type === "content") emit({ type: "stream_delta", text: delta.text });
        if (delta.type === "reasoning") emit({ type: "reasoning_delta", text: delta.text });
      }
    });

    emit({
      type: "model",
      message: message.content || "",
      provider: provider.label,
      model: provider.model,
      finishReason,
      reasoning: message.reasoning_content || "",
      usage
    });

    messages.push(message);

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

    for (const toolCall of toolCalls) {
      const name = toolCall.function?.name ?? "unknown";
      const rawArgs = toolCall.function?.arguments ?? "{}";
      emit({ type: "tool_start", name, args: rawArgs });

      try {
        const result = await executeToolCall(toolCall, workspace);
        emit({ type: "tool_result", name, result });
        if (name === "update_plan") {
          const parsed = JSON.parse(result);
          emit({ type: "plan_update", items: parsed.items ?? [] });
        }
        if (name === "apply_patch") {
          const parsed = JSON.parse(result);
          emit({
            type: "patch_proposed",
            patchId: parsed.patchId,
            summary: parsed.summary,
            patch: parseToolArguments(rawArgs).patch ?? ""
          });
        }
        if (name === "run_command") {
          const parsed = JSON.parse(result);
          if (parsed.pending) {
            emit({
              type: "command_pending",
              commandId: parsed.commandId,
              command: parsed.command,
              reason: "这个命令可能修改环境、安装依赖、访问网络或产生副作用，需要确认后执行。"
            });
          }
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        emit({ type: "tool_error", name, message: messageText });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Tool failed: ${messageText}`
        });
      }
    }
  }

  throw new Error(`agent 超过最大工具循环次数 ${MAX_AGENT_STEPS}，已停止。`);
}

function parseToolArguments(rawArgs) {
  try {
    return rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return {};
  }
}

function selectRecentMessages(messages, contextTokens) {
  // This is an app-side approximation. DeepSeek V4 has 1M context, but the API
  // does not expose a request parameter that changes the model context window.
  const maxChars = Math.max(16000, contextTokens * 4);
  const selected = [];
  let totalChars = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const content = String(message?.content ?? "");
    const nextTotal = totalChars + content.length;
    if (nextTotal > maxChars && selected.length > 0) break;
    selected.unshift({ role: message.role, content });
    totalChars = nextTotal;
  }

  return selected;
}
