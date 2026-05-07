import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Language } from "../i18n";
import type { AgentEvent, ChatMessage } from "../global";
import type { CommandItem, EventLogItem, PatchItem, PlanItem, StreamRecoveryStatus, TokenUsageStats, ToolDraft, ToolRun, UserQuestionItem } from "../types";
import { formatQuestionMessage, normalizeQuestionOptions } from "../utils";

type AppendEvent = (kind: EventLogItem["kind"], title: string, body: string) => void;

type UseAgentEventsParams = {
  appendEvent: AppendEvent;
  language: Language;
  refreshGit: (target?: string) => Promise<void>;
  refreshWorkspace: (target?: string) => Promise<void>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setTokenUsage: Dispatch<SetStateAction<TokenUsageStats>>;
};

export function useAgentEvents({
  appendEvent,
  language,
  refreshGit,
  refreshWorkspace,
  setMessages,
  setTokenUsage
}: UseAgentEventsParams) {
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [questions, setQuestions] = useState<UserQuestionItem[]>([]);
  const [toolDraft, setToolDraft] = useState<ToolDraft | null>(null);
  const [activeToolRuns, setActiveToolRuns] = useState<ToolRun[]>([]);
  const [streamingResponse, setStreamingResponse] = useState(false);
  const [streamRecoveryStatus, setStreamRecoveryStatus] = useState<StreamRecoveryStatus | null>(null);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [commandAutoApproval, setCommandAutoApproval] = useState(false);
  const [patchAutoApproval, setPatchAutoApproval] = useState(false);
  const [commandAutoApprovalExpiresAt, setCommandAutoApprovalExpiresAt] = useState<number | null>(null);
  const [patchAutoApprovalExpiresAt, setPatchAutoApprovalExpiresAt] = useState<number | null>(null);
  const [contextCompressionStatus, setContextCompressionStatus] = useState("");
  const activeRequest = useRef<string | null>(null);
  const streamingMessageActive = useRef(false);
  const reasoningMessageActive = useRef(false);
  const compressionStatusTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (compressionStatusTimer.current) window.clearTimeout(compressionStatusTimer.current);
    };
  }, []);

  const resetStreamState = useCallback(() => {
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
    setToolDraft(null);
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
  }, []);

  const finishActiveToolRun = useCallback((name: string) => {
    setActiveToolRuns((current) => {
      const sameNameIndex = current.findIndex((tool) => tool.name === name);
      const index = sameNameIndex >= 0 ? sameNameIndex : 0;
      if (index < 0) return current;
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }, []);

  const updateCompressionStatus = useCallback((message: string) => {
    const isCompressionStart = message.includes("正在压缩") || message.includes("Compressing");
    const isCompressionFailed = message.includes("摘要失败") || message.includes("已退回滑动窗口") || message.includes("summary failed") || message.includes("falling back");
    const isCompressionDone = message.includes("已压缩") || message.includes("compressed into") || isCompressionFailed;
    if (!isCompressionStart && !isCompressionDone) return;
    if (compressionStatusTimer.current) {
      window.clearTimeout(compressionStatusTimer.current);
      compressionStatusTimer.current = null;
    }
    if (isCompressionStart) {
      setContextCompressionStatus(language === "zh" ? "正在自动压缩上下文" : "Auto-compressing context");
      return;
    }
    setContextCompressionStatus(
      isCompressionFailed
        ? (language === "zh" ? "上下文压缩失败，已使用滑动窗口" : "Context compression failed; using recent history")
        : (language === "zh" ? "上下文压缩完成" : "Context compression complete")
    );
    compressionStatusTimer.current = window.setTimeout(() => setContextCompressionStatus(""), 3000);
  }, [language]);

  const recordTokenUsage = useCallback((usage: unknown) => {
    if (!usage || typeof usage !== "object") return;
    const data = usage as Record<string, unknown>;
    const promptTokens = Number(data.prompt_tokens ?? data.promptTokens ?? 0);
    const completionTokens = Number(data.completion_tokens ?? data.completionTokens ?? 0);
    const totalTokens = Number(data.total_tokens ?? data.totalTokens ?? promptTokens + completionTokens);
    if (![promptTokens, completionTokens, totalTokens].some((value) => Number.isFinite(value) && value > 0)) return;
    setTokenUsage((current) => ({
      promptTokens: current.promptTokens + (Number.isFinite(promptTokens) ? promptTokens : 0),
      completionTokens: current.completionTokens + (Number.isFinite(completionTokens) ? completionTokens : 0),
      totalTokens: current.totalTokens + (Number.isFinite(totalTokens) ? totalTokens : 0),
      requests: current.requests + 1
    }));
  }, [setTokenUsage]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    const ui = getAgentEventLabels(language);
    if (event.type === "done") {
      setPlanItems((current) => current.map((item) => item.status === "in_progress" ? { ...item, status: "completed" } : item));
      setBusy(false);
      activeRequest.current = null;
      setActiveToolRuns([]);
      resetStreamState();
      return;
    }

    if (event.type === "stream_delta") {
      setStreamingResponse(true);
      setMessages((current) => {
        if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
          streamingMessageActive.current = true;
          return [...current, { role: "assistant", content: event.text }];
        }
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + event.text };
        return next;
      });
      return;
    }

    if (event.type === "reasoning_delta") {
      setStreamingResponse(true);
      setMessages((current) => {
        if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
          reasoningMessageActive.current = true;
          return [...current, { role: "assistant", content: "", reasoning: event.text }];
        }
        const next = [...current];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, reasoning: `${last.reasoning || ""}${event.text}` };
        return next;
      });
      return;
    }

    if (event.type === "tool_call_delta") {
      setToolDraft((current) => ({
        name: event.name || current?.name || "tool_call",
        text: `${current?.text || ""}${event.text}`
      }));
      return;
    }

    if (event.type === "plan_update") {
      setPlanItems(event.items);
      return;
    }

    if (event.type === "model") {
      if (streamingMessageActive.current || reasoningMessageActive.current) {
        setMessages((current) => {
          if (current[current.length - 1]?.role !== "assistant") return current;
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = {
            ...last,
            content: last.content || event.message || "",
            reasoning: event.reasoning || last.reasoning,
            tool_calls: event.tool_calls?.length ? event.tool_calls : last.tool_calls
          };
          return next;
        });
      } else if (event.message.trim() || event.reasoning?.trim() || event.tool_calls?.length) {
        setMessages((current) => [...current, {
          role: "assistant",
          content: event.message || "",
          reasoning: event.reasoning || undefined,
          tool_calls: event.tool_calls?.length ? event.tool_calls : undefined
        }]);
      }
      resetStreamState();
      recordTokenUsage(event.usage);
      appendEvent(
        "model",
        `${event.provider} / ${event.model}${event.finishReason ? ` / ${event.finishReason}` : ""}`,
        JSON.stringify(
          {
            usage: event.usage ?? null,
            reasoning_preview: event.reasoning ? event.reasoning.slice(0, 1200) : ""
          },
          null,
          2
        )
      );
      return;
    }

    if (event.type === "status") {
      updateCompressionStatus(event.message);
      appendEvent("status", ui.status, event.message);
      return;
    }

    if (event.type === "tool_start") {
      setActiveToolRuns((current) => [
        ...current,
        {
          id: `${event.requestId}-${current.length}-${Date.now()}`,
          name: event.name,
          args: event.args,
          startedAt: Date.now()
        }
      ]);
      appendEvent("tool", `${ui.toolStart}: ${event.name}`, event.args);
      return;
    }

    if (event.type === "stream_recovery") {
      setStreamRecoveryStatus({
        message: event.message,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        recovering: event.recovering
      });
      appendEvent(event.recovering ? "status" : "error", event.recovering ? ui.streamRecovery : ui.streamInterrupted, event.message);
      return;
    }

    if (event.type === "tool_result") {
      finishActiveToolRun(event.name);
      if (event.toolCallId) {
        setMessages((current) => [...current, {
          role: "tool",
          content: event.result,
          tool_call_id: event.toolCallId,
          name: event.name
        }]);
      }
      appendEvent("tool", `${ui.toolResult}: ${event.name}`, event.result);
      return;
    }

    if (event.type === "tool_error") {
      finishActiveToolRun(event.name);
      if (event.toolCallId) {
        setMessages((current) => [...current, {
          role: "tool",
          content: event.result || event.message,
          tool_call_id: event.toolCallId,
          name: event.name
        }]);
      }
      appendEvent("error", `${ui.toolFailed}: ${event.name}`, event.message);
      return;
    }

    if (event.type === "patch_proposed") {
      setPatches((current) => [
        {
          id: event.patchId,
          summary: event.summary || "Proposed patch",
          patch: event.patch,
          status: "pending"
        },
        ...current
      ]);
      appendEvent("patch", ui.pendingChanges, event.summary || ui.patchWaiting);
      return;
    }

    if (event.type === "patch_applied") {
      appendEvent("patch", ui.patchAutoApplied, `${event.summary || event.patchId}${event.strategy ? ` (${event.strategy})` : ""}`);
      refreshWorkspace();
      refreshGit();
      return;
    }

    if (event.type === "command_pending") {
      setCommands((current) => [
        { id: event.commandId, command: event.command, reason: event.reason, highRisk: Boolean(event.highRisk), status: "pending" },
        ...current
      ]);
      appendEvent("patch", ui.commandPending, event.command);
      return;
    }

    if (event.type === "ask_user_pending") {
      const options = normalizeQuestionOptions(event.options, event.question, language);
      const assistantQuestion = formatQuestionMessage(event.question, event.context, options);
      setQuestions((current) => [
        { id: crypto.randomUUID(), question: event.question, context: event.context, options, status: "pending" },
        ...current
      ]);
      setMessages((current) => [...current, { role: "assistant", content: assistantQuestion }]);
      appendEvent("patch", ui.agentQuestion, event.question);
      return;
    }

    if (event.type === "error") {
      appendEvent("error", ui.agentError, event.message);
      setMessages((current) => [...current, { role: "assistant", content: `${ui.requestFailed}: ${event.message}` }]);
      setBusy(false);
      activeRequest.current = null;
      setActiveToolRuns([]);
      resetStreamState();
    }

    if (event.type === "cancelled") {
      appendEvent("status", ui.requestCancelled, event.message);
      setMessages((current) => [...current, { role: "assistant", content: ui.requestCancelledBody }]);
      setBusy(false);
      activeRequest.current = null;
      setActiveToolRuns([]);
      resetStreamState();
    }
  }, [appendEvent, finishActiveToolRun, language, recordTokenUsage, refreshGit, refreshWorkspace, resetStreamState, setMessages, updateCompressionStatus]);

  useEffect(() => {
    return window.agentWindow.onAgentEvent((event) => {
      if (event.requestId !== activeRequest.current) return;
      handleAgentEvent(event);
    });
  }, [handleAgentEvent]);

  const beginRequest = useCallback((requestId: string, waitingPlan: string) => {
    activeRequest.current = requestId;
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
    setToolDraft(null);
    setActiveToolRuns([]);
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
    setBusy(true);
    setPlanItems([{ step: waitingPlan, status: "in_progress" }]);
  }, []);

  const cancelActiveRequest = useCallback(async () => {
    if (!activeRequest.current) return;
    await window.agentWindow.cancelMessage(activeRequest.current);
  }, []);

  const applyPatch = useCallback(async (patchId: string) => {
    setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "pending", error: undefined } : patch));
    const result = await window.agentWindow.applyPatch({ patchId, language });
    if (result.ok) {
      setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "applied" } : patch));
      const ui = getAgentEventLabels(language);
      appendEvent("patch", ui.patchApplied, `${result.result.summary}${result.result.strategy ? ` (${result.result.strategy})` : ""}`);
      await refreshWorkspace();
      await refreshGit();
    } else {
      setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "failed", error: result.error } : patch));
      appendEvent("error", getAgentEventLabels(language).patchApplyFailed, result.error);
    }
  }, [appendEvent, language, refreshGit, refreshWorkspace]);

  const discardPatch = useCallback(async (patchId: string) => {
    await window.agentWindow.discardPatch(patchId);
    setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "discarded" } : patch));
    appendEvent("patch", getAgentEventLabels(language).patchDiscarded, patchId);
  }, [appendEvent, language]);

  const approveCommand = useCallback(async (commandId: string, allowFuture = false) => {
    const result = await window.agentWindow.approveCommand({ commandId, allowFuture, language });
    if (result.ok) {
      setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "approved", result: result.result.result } : command));
      const ui = getAgentEventLabels(language);
      appendEvent("tool", `${ui.commandExecuted}: ${result.result.command}`, result.result.result);
      setCommandAutoApproval(result.result.commandAutoApproval);
      setPatchAutoApproval(result.result.patchAutoApproval);
      setCommandAutoApprovalExpiresAt(result.result.commandAutoApprovalExpiresAt || null);
      setPatchAutoApprovalExpiresAt(result.result.patchAutoApprovalExpiresAt || null);
      if (result.result.autoApproveFutureCommands) {
        appendEvent("status", ui.futureCommandsAllowed, ui.futureCommandsAllowedBody);
      }
    } else {
      setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "failed", error: result.error } : command));
      appendEvent("error", getAgentEventLabels(language).commandFailed, result.error);
    }
  }, [appendEvent, language]);

  const discardCommand = useCallback(async (commandId: string) => {
    await window.agentWindow.discardCommand(commandId);
    setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "discarded" } : command));
  }, []);

  const applyAutoApprovalState = useCallback((result: { commandAutoApproval: boolean; patchAutoApproval: boolean; commandAutoApprovalExpiresAt?: number | null; patchAutoApprovalExpiresAt?: number | null }) => {
    setCommandAutoApproval(result.commandAutoApproval);
    setPatchAutoApproval(result.patchAutoApproval);
    setCommandAutoApprovalExpiresAt(result.commandAutoApprovalExpiresAt || null);
    setPatchAutoApprovalExpiresAt(result.patchAutoApprovalExpiresAt || null);
  }, []);

  const resetCommandAutoApproval = useCallback(async (context: { workspace: string; sessionId?: string }) => {
    const result = await window.agentWindow.setCommandAutoApproval({ ...context, enabled: false });
    applyAutoApprovalState(result);
    const ui = getAgentEventLabels(language);
    appendEvent("status", ui.commandConfirmRestored, ui.commandConfirmRestoredBody);
  }, [appendEvent, applyAutoApprovalState, language]);

  const resetPatchAutoApproval = useCallback(async (context: { workspace: string; sessionId?: string }) => {
    const result = await window.agentWindow.setPatchAutoApproval({ ...context, enabled: false });
    applyAutoApprovalState(result);
    const ui = getAgentEventLabels(language);
    appendEvent("status", ui.patchAutoApplyDisabled, ui.patchAutoApplyDisabledBody);
  }, [appendEvent, applyAutoApprovalState, language]);

  const updateCommandAutoApproval = useCallback(async (enabled: boolean, context: { workspace: string; sessionId?: string }) => {
    const result = await window.agentWindow.setCommandAutoApproval({ ...context, enabled });
    applyAutoApprovalState(result);
    const ui = getAgentEventLabels(language);
    appendEvent(
      "status",
      enabled ? ui.commandAutoRunEnabled : ui.commandAutoRunDisabled,
      enabled ? ui.autoPermissionScoped : ui.commandNeedsConfirm
    );
  }, [appendEvent, applyAutoApprovalState, language]);

  const updatePatchAutoApproval = useCallback(async (enabled: boolean, context: { workspace: string; sessionId?: string }) => {
    const result = await window.agentWindow.setPatchAutoApproval({ ...context, enabled });
    applyAutoApprovalState(result);
    const ui = getAgentEventLabels(language);
    appendEvent(
      "status",
      enabled ? ui.patchAutoApplyEnabled : ui.patchAutoApplyDisabled,
      enabled ? ui.autoPermissionScoped : ui.patchNeedsConfirm
    );
  }, [appendEvent, applyAutoApprovalState, language]);

  const resetAgentTransientState = useCallback(() => {
    setPatches([]);
    setCommands([]);
    setQuestions([]);
    setPlanItems([]);
    setToolDraft(null);
    setActiveToolRuns([]);
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
  }, []);

  return {
    activeToolRuns,
    activeRequest,
    applyPatch,
    approveCommand,
    beginRequest,
    busy,
    cancelActiveRequest,
    commandAutoApproval,
    commandAutoApprovalExpiresAt,
    commands,
    contextCompressionStatus,
    discardCommand,
    discardPatch,
    patches,
    patchAutoApproval,
    patchAutoApprovalExpiresAt,
    planItems,
    questions,
    resetAgentTransientState,
    resetCommandAutoApproval,
    resetPatchAutoApproval,
    setBusy,
    setQuestions,
    streamingResponse,
    streamRecoveryStatus,
    toolDraft,
    updateCommandAutoApproval,
    updatePatchAutoApproval
  };
}

function getAgentEventLabels(language: Language) {
  if (language === "en") {
    return {
      status: "Status",
      toolStart: "Tool call",
      toolResult: "Tool result",
      toolFailed: "Tool failed",
      streamRecovery: "Stream recovery",
      streamInterrupted: "Stream interrupted",
      pendingChanges: "Pending changes",
      patchWaiting: "Agent proposed a patch and is waiting for approval.",
      patchAutoApplied: "Patch auto-applied",
      commandPending: "Command waiting for approval",
      agentQuestion: "Agent requested input",
      agentError: "Agent error",
      requestFailed: "Request failed",
      requestCancelled: "Request cancelled",
      requestCancelledBody: "Request cancelled.",
      patchApplied: "Patch applied",
      patchApplyFailed: "Patch apply failed",
      patchDiscarded: "Patch discarded",
      commandExecuted: "Command executed",
      futureCommandsAllowed: "Future commands allowed",
      futureCommandsAllowedBody: "Future command requests in this chat and workspace will run automatically for 30 minutes.",
      commandFailed: "Command failed",
      commandConfirmRestored: "Future command confirmation restored",
      commandConfirmRestoredBody: "Future high-risk or side-effect commands will ask for confirmation again.",
      patchAutoApplyDisabled: "Patch auto-apply disabled",
      patchAutoApplyDisabledBody: "Future file changes will ask for confirmation again.",
      commandAutoRunEnabled: "Command auto-run enabled",
      commandAutoRunDisabled: "Command auto-run disabled",
      autoPermissionScoped: "Only applies to this chat and workspace; expires after 30 minutes.",
      commandNeedsConfirm: "High-risk or side-effect commands will ask for confirmation.",
      patchAutoApplyEnabled: "Patch auto-apply enabled",
      patchNeedsConfirm: "File writes, deletes, and patches will ask for confirmation."
    };
  }

  return {
    status: "状态",
    toolStart: "调用工具",
    toolResult: "工具结果",
    toolFailed: "工具失败",
    streamRecovery: "流式恢复",
    streamInterrupted: "流式连接中断",
    pendingChanges: "待确认变更",
    patchWaiting: "Agent 提交了一个 patch，等待应用。",
    patchAutoApplied: "Patch 已自动应用",
    commandPending: "命令等待确认",
    agentQuestion: "Agent 请求用户输入",
    agentError: "Agent 错误",
    requestFailed: "请求失败",
    requestCancelled: "请求已取消",
    requestCancelledBody: "请求已取消。",
    patchApplied: "Patch 已应用",
    patchApplyFailed: "Patch 应用失败",
    patchDiscarded: "Patch 已放弃",
    commandExecuted: "命令已执行",
    futureCommandsAllowed: "后续命令已允许",
    futureCommandsAllowedBody: "当前会话和 workspace 内，后续命令请求将在 30 分钟内自动执行。",
    commandFailed: "命令执行失败",
    commandConfirmRestored: "后续命令确认已恢复",
    commandConfirmRestoredBody: "agent 后续高危或副作用命令会再次请求确认。",
    patchAutoApplyDisabled: "自动应用 Patch 已关闭",
    patchAutoApplyDisabledBody: "agent 后续文件变更会再次请求确认。",
    commandAutoRunEnabled: "已启用命令自动执行",
    commandAutoRunDisabled: "已关闭命令自动执行",
    autoPermissionScoped: "仅当前会话和 workspace 生效，30 分钟后自动失效。",
    commandNeedsConfirm: "高危或副作用命令会请求确认。",
    patchAutoApplyEnabled: "已启用 Patch 自动应用",
    patchNeedsConfirm: "文件写入、删除和 patch 会请求确认。"
  };
}
