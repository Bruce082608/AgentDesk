import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Language } from "../i18n";
import type { AgentEvent, ApprovalRecord, ChatMessage } from "../global";
import type { CommandItem, ContextCompressionState, EventLogItem, PatchItem, PlanItem, StreamRecoveryStatus, TaskStatus, TokenUsageStats, ToolDraft, ToolRun, UserQuestionItem } from "../types";
import { formatQuestionAnswer, formatQuestionMessage, normalizeQuestionOptions } from "../utils";

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
  const [taskStatus, setTaskStatus] = useState<TaskStatus>({ phase: "idle", label: "" });
  const [streamingResponse, setStreamingResponse] = useState(false);
  const [streamRecoveryStatus, setStreamRecoveryStatus] = useState<StreamRecoveryStatus | null>(null);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [commandAutoApproval, setCommandAutoApproval] = useState(false);
  const [patchAutoApproval, setPatchAutoApproval] = useState(false);
  const [commandAutoApprovalExpiresAt, setCommandAutoApprovalExpiresAt] = useState<number | null>(null);
  const [patchAutoApprovalExpiresAt, setPatchAutoApprovalExpiresAt] = useState<number | null>(null);
  const [contextCompressionStatus, setContextCompressionStatus] = useState("");
  const [contextCompression, setContextCompression] = useState<ContextCompressionState>({ phase: "idle", message: "" });
  const activeRequest = useRef<string | null>(null);
  const streamingMessageActive = useRef(false);
  const reasoningMessageActive = useRef(false);
  const compressionStatusTimer = useRef<number | null>(null);
  const activeToolRunMap = useRef(new Map<string, ToolRun>());
  const completionTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (compressionStatusTimer.current) window.clearTimeout(compressionStatusTimer.current);
      if (completionTimer.current) window.clearTimeout(completionTimer.current);
    };
  }, []);

  const resetStreamState = useCallback(() => {
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
    setToolDraft(null);
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
  }, []);

  const clearCompletionTimer = useCallback(() => {
    if (!completionTimer.current) return;
    window.clearTimeout(completionTimer.current);
    completionTimer.current = null;
  }, []);

  const clearActiveToolRuns = useCallback(() => {
    activeToolRunMap.current.clear();
    setActiveToolRuns([]);
  }, []);

  const takeActiveToolRun = useCallback((toolCallId?: string, name?: string) => {
    const normalizedId = String(toolCallId || "").trim();
    if (normalizedId && activeToolRunMap.current.has(normalizedId)) {
      const run = activeToolRunMap.current.get(normalizedId) || null;
      activeToolRunMap.current.delete(normalizedId);
      setActiveToolRuns((current) => current.filter((item) => item.id !== normalizedId && item.toolCallId !== normalizedId));
      return run;
    }

    if (name) {
      for (const [id, run] of activeToolRunMap.current.entries()) {
        if (run.name !== name) continue;
        activeToolRunMap.current.delete(id);
        setActiveToolRuns((current) => current.filter((item) => item.id !== id && item.toolCallId !== id));
        return run;
      }
    }

    return null;
  }, []);

  const setTaskPhase = useCallback((phase: TaskStatus["phase"], detail = "") => {
    const labels = getTaskStatusLabels(language);
    setTaskStatus({
      phase,
      label: labels[phase],
      detail: detail || undefined,
      updatedAt: Date.now()
    });
  }, [language]);

  const updateCompressionStatus = useCallback((phase: "start" | "done" | "failed", message = "", summary = "") => {
    if (compressionStatusTimer.current) {
      window.clearTimeout(compressionStatusTimer.current);
      compressionStatusTimer.current = null;
    }
    setContextCompression((current) => ({
      phase,
      message: message || current.message,
      summary: summary || current.summary,
      updatedAt: Date.now()
    }));
    if (phase === "start") {
      setContextCompressionStatus(language === "zh" ? "正在自动压缩上下文" : "Auto-compressing context");
      return;
    }
    setContextCompressionStatus(
      phase === "failed"
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
      clearCompletionTimer();
      setPlanItems((current) => current.map((item) => item.status === "in_progress" ? { ...item, status: "completed" } : item));
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      setTaskPhase("completed");
      resetStreamState();
      completionTimer.current = window.setTimeout(() => {
        setTaskPhase("idle");
        completionTimer.current = null;
      }, 1400);
      return;
    }

    if (event.type === "stream_delta") {
      setStreamingResponse(true);
      if (taskStatus.phase === "idle") setTaskPhase("understanding");
      setMessages((current) => {
        if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
          streamingMessageActive.current = true;
          return [...current, { role: "assistant", content: event.text, createdAt: Date.now() }];
        }
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + event.text };
        return next;
      });
      return;
    }

    if (event.type === "reasoning_delta") {
      setStreamingResponse(true);
      if (taskStatus.phase === "idle") setTaskPhase("understanding");
      setMessages((current) => {
        if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
          reasoningMessageActive.current = true;
          return [...current, { role: "assistant", content: "", reasoning: event.text, createdAt: Date.now() }];
        }
        const next = [...current];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, reasoning: `${last.reasoning || ""}${event.text}` };
        return next;
      });
      return;
    }

    if (event.type === "tool_call_delta") {
      if (taskStatus.phase === "idle") setTaskPhase("understanding");
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
          createdAt: Date.now(),
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
      appendEvent("status", ui.status, event.message);
      return;
    }

    if (event.type === "context_compression") {
      updateCompressionStatus(event.phase, event.message, event.summary || "");
      if (event.phase === "start") setTaskPhase("understanding", event.message);
      if (event.phase === "done") setTaskPhase("understanding", event.message);
      if (event.phase === "failed") setTaskPhase("understanding", event.message);
      return;
    }

    if (event.type === "tool_start") {
      setTaskPhase(classifyToolPhase(event.name), event.name);
      const startedAt = Date.now();
      const toolCallId = String(event.toolCallId || `${event.requestId}-${event.name}-${startedAt}`).trim();
      const run: ToolRun = {
        id: toolCallId,
        toolCallId: event.toolCallId || toolCallId,
        name: event.name,
        args: event.args,
        startedAt,
        status: "running"
      };
      activeToolRunMap.current.set(toolCallId, run);
      setActiveToolRuns((current) => [
        ...current,
        run
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
      const startedRun = takeActiveToolRun(event.toolCallId, event.name);
      const endedAt = Date.now();
      const startedAt = startedRun?.startedAt ?? endedAt;
      const durationMs = Math.max(0, endedAt - startedAt);
      setMessages((current) => [...current, {
        role: "tool",
        content: event.result,
        createdAt: endedAt,
        tool_call_id: startedRun?.toolCallId || event.toolCallId,
        name: event.name,
        toolArgs: startedRun?.args,
        startedAt,
        endedAt,
        durationMs,
        toolStatus: "completed"
      }]);
      if (taskStatus.phase !== "waiting") {
        setTaskPhase(classifyToolPhase(event.name), event.name);
      }
      appendEvent("tool", `${ui.toolResult}: ${event.name}`, event.result);
      return;
    }

    if (event.type === "tool_error") {
      const startedRun = takeActiveToolRun(event.toolCallId, event.name);
      const endedAt = Date.now();
      const startedAt = startedRun?.startedAt ?? endedAt;
      const durationMs = Math.max(0, endedAt - startedAt);
      setMessages((current) => [...current, {
        role: "tool",
        content: event.result || event.message,
        createdAt: endedAt,
        tool_call_id: startedRun?.toolCallId || event.toolCallId,
        name: event.name,
        toolArgs: startedRun?.args,
        startedAt,
        endedAt,
        durationMs,
        toolStatus: "error",
        toolError: event.message
      }]);
      setTaskPhase("error", event.message || event.name);
      appendEvent("error", `${ui.toolFailed}: ${event.name}`, event.message);
      return;
    }

    if (event.type === "patch_proposed") {
      setTaskPhase("waiting", event.summary || event.patchId);
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
      setTaskPhase("editing", event.summary || event.patchId);
      appendEvent("patch", ui.patchAutoApplied, `${event.summary || event.patchId}${event.strategy ? ` (${event.strategy})` : ""}`);
      refreshWorkspace();
      refreshGit();
      return;
    }

    if (event.type === "command_pending") {
      setTaskPhase("waiting", event.reason || event.command);
      setCommands((current) => [
        {
          id: event.commandId,
          command: event.command,
          reason: event.reason,
          cwd: event.cwd,
          timeoutMs: event.timeoutMs,
          shell: event.shell,
          inheritedEnv: event.inheritedEnv,
          highRisk: Boolean(event.highRisk),
          status: "pending"
        },
        ...current
      ]);
      appendEvent("patch", ui.commandPending, event.command);
      return;
    }

    if (event.type === "ask_user_pending") {
      setTaskPhase("waiting", event.question);
      const options = normalizeQuestionOptions(event.options, event.question, language);
      const assistantQuestion = formatQuestionMessage(event.question, event.context, options);
      setQuestions((current) => [
        { id: event.questionId, question: event.question, context: event.context, options, status: "pending" },
        ...current
      ]);
      setMessages((current) => [...current, { role: "assistant", content: assistantQuestion, createdAt: Date.now() }]);
      appendEvent("patch", ui.agentQuestion, event.question);
      return;
    }

    if (event.type === "error") {
      clearCompletionTimer();
      setTaskPhase("error", event.message);
      appendEvent("error", ui.agentError, event.message);
      setMessages((current) => [...current, { role: "assistant", content: `${ui.requestFailed}: ${event.message}`, createdAt: Date.now() }]);
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      resetStreamState();
    }

    if (event.type === "cancelled") {
      clearCompletionTimer();
      setTaskPhase("idle");
      appendEvent("status", ui.requestCancelled, event.message);
      setMessages((current) => [...current, { role: "assistant", content: ui.requestCancelledBody, createdAt: Date.now() }]);
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      resetStreamState();
    }
  }, [appendEvent, clearActiveToolRuns, clearCompletionTimer, language, recordTokenUsage, refreshGit, refreshWorkspace, resetStreamState, setMessages, takeActiveToolRun, taskStatus.phase, updateCompressionStatus, setTaskPhase]);

  useEffect(() => {
    return window.agentWindow.onAgentEvent((event) => {
      if (event.requestId !== activeRequest.current) return;
      handleAgentEvent(event);
    });
  }, [handleAgentEvent]);

  const beginRequest = useCallback((requestId: string, waitingPlan: string) => {
    clearCompletionTimer();
    activeRequest.current = requestId;
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
    setToolDraft(null);
    clearActiveToolRuns();
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
    setBusy(true);
    setTaskPhase("understanding");
    setPlanItems([{ step: waitingPlan, status: "in_progress" }]);
  }, [clearActiveToolRuns, clearCompletionTimer, setTaskPhase]);

  const loadPendingApprovals = useCallback(async (sessionId: string) => {
    try {
      const approvals = await window.agentWindow.listPendingApprovals({ sessionId });
      const patchItems: PatchItem[] = [];
      const commandItems: CommandItem[] = [];
      const questionItems: UserQuestionItem[] = [];

      for (const approval of approvals as ApprovalRecord[]) {
        if (approval.kind === "patch") {
          patchItems.push({
            id: approval.id,
            summary: approval.summary || "Proposed patch",
            patch: approval.patch || "",
            status: "pending"
          });
        } else if (approval.kind === "command") {
          commandItems.push({
            id: approval.id,
            command: approval.command || "",
            reason: approval.reason || "",
            cwd: approval.cwd,
            timeoutMs: approval.timeoutMs,
            shell: approval.shell,
            inheritedEnv: approval.inheritedEnv,
            highRisk: Boolean(approval.highRisk),
            status: "pending"
          });
        } else if (approval.kind === "question") {
          questionItems.push({
            id: approval.id,
            question: approval.question || "",
            context: approval.context,
            options: Array.isArray(approval.options) ? approval.options : [],
            status: "pending"
          });
        }
      }

      setPatches(patchItems);
      setCommands(commandItems);
      setQuestions(questionItems);
    } catch {
      setPatches([]);
      setCommands([]);
      setQuestions([]);
    }
  }, []);

  const clearApprovalItem = useCallback((kind: "patch" | "command" | "question", id: string) => {
    if (kind === "patch") {
      setPatches((current) => current.filter((item) => item.id !== id));
    } else if (kind === "command") {
      setCommands((current) => current.filter((item) => item.id !== id));
    } else {
      setQuestions((current) => current.filter((item) => item.id !== id));
    }
  }, []);

  const markApprovalFailed = useCallback((kind: "patch" | "command" | "question", id: string, error: string) => {
    if (kind === "patch") {
      setPatches((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error } : item));
    } else if (kind === "command") {
      setCommands((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error } : item));
    } else {
      setQuestions((current) => current.filter((item) => item.id !== id));
    }
  }, []);

  const applyAutoApprovalState = useCallback((result: { commandAutoApproval: boolean; patchAutoApproval: boolean; fullAccessAutoApproval?: boolean; commandAutoApprovalExpiresAt?: number | null; patchAutoApprovalExpiresAt?: number | null }) => {
    setCommandAutoApproval(result.commandAutoApproval);
    setPatchAutoApproval(result.patchAutoApproval);
    setCommandAutoApprovalExpiresAt(result.commandAutoApprovalExpiresAt || null);
    setPatchAutoApprovalExpiresAt(result.patchAutoApprovalExpiresAt || null);
  }, []);

  const cancelActiveRequest = useCallback(async () => {
    if (!activeRequest.current) return;
    await window.agentWindow.cancelMessage(activeRequest.current);
  }, []);

  const startApprovalContinuation = useCallback(() => {
    const requestId = crypto.randomUUID();
    beginRequest(requestId, language === "zh" ? "等待审批结果" : "Awaiting approval result");
    return requestId;
  }, [beginRequest, language]);

  const applyPatch = useCallback(async (patchId: string) => {
    if (busy) return;
    const patch = patches.find((item) => item.id === patchId);
    if (!patch) return;
    const requestId = startApprovalContinuation();
    const result = await window.agentWindow.resumeApproval({
      requestId,
      continuationId: patchId,
      kind: "patch",
      decision: "approved",
      language
    });
    if (!result.ok) {
      markApprovalFailed("patch", patchId, result.error || getAgentEventLabels(language).patchApplyFailed);
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      setTaskPhase("error", result.error || getAgentEventLabels(language).patchApplyFailed);
      appendEvent("error", getAgentEventLabels(language).patchApplyFailed, result.error || "Unknown error");
      return;
    }
    clearApprovalItem("patch", patchId);
  }, [appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, markApprovalFailed, patches, startApprovalContinuation, setTaskPhase]);

  const discardPatch = useCallback(async (patchId: string) => {
    if (busy) return;
    const requestId = startApprovalContinuation();
    const result = await window.agentWindow.resumeApproval({
      requestId,
      continuationId: patchId,
      kind: "patch",
      decision: "discarded",
      language
    });
    if (!result.ok) {
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      setTaskPhase("error", result.error || getAgentEventLabels(language).patchApplyFailed);
      appendEvent("error", getAgentEventLabels(language).patchApplyFailed, result.error || "Unknown error");
      return;
    }
    clearApprovalItem("patch", patchId);
    appendEvent("patch", getAgentEventLabels(language).patchDiscarded, patchId);
  }, [appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, startApprovalContinuation, setTaskPhase]);

  const approveCommand = useCallback(async (commandId: string, allowFuture = false) => {
    if (busy) return;
    const command = commands.find((item) => item.id === commandId);
    if (!command) return;
    const requestId = startApprovalContinuation();
    const result = await window.agentWindow.resumeApproval({
      requestId,
      continuationId: commandId,
      kind: "command",
      decision: "approved",
      allowFuture,
      language
    });
    if (result.ok) {
      const approvalState = result.result as Record<string, unknown> | undefined;
      if (typeof approvalState?.commandAutoApproval === "boolean" && typeof approvalState?.patchAutoApproval === "boolean") {
        applyAutoApprovalState({
          commandAutoApproval: approvalState.commandAutoApproval,
          patchAutoApproval: approvalState.patchAutoApproval,
          fullAccessAutoApproval: Boolean(approvalState.fullAccessAutoApproval),
          commandAutoApprovalExpiresAt: Number(approvalState.commandAutoApprovalExpiresAt || null) || null,
          patchAutoApprovalExpiresAt: Number(approvalState.patchAutoApprovalExpiresAt || null) || null
        });
      }
      if (Boolean(approvalState?.autoApproveFutureCommands)) {
        const ui = getAgentEventLabels(language);
        appendEvent("status", ui.futureCommandsAllowed, ui.futureCommandsAllowedBody);
      }
      clearApprovalItem("command", commandId);
    } else {
      markApprovalFailed("command", commandId, result.error || getAgentEventLabels(language).commandFailed);
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      setTaskPhase("error", result.error || getAgentEventLabels(language).commandFailed);
      appendEvent("error", getAgentEventLabels(language).commandFailed, result.error || "Unknown error");
    }
  }, [activeRequest, appendEvent, applyAutoApprovalState, busy, clearActiveToolRuns, clearApprovalItem, commands, language, markApprovalFailed, setBusy, startApprovalContinuation, setTaskPhase]);

  const discardCommand = useCallback(async (commandId: string) => {
    if (busy) return;
    const requestId = startApprovalContinuation();
    const result = await window.agentWindow.resumeApproval({
      requestId,
      continuationId: commandId,
      kind: "command",
      decision: "discarded",
      language
    });
    if (!result.ok) {
      markApprovalFailed("command", commandId, result.error || getAgentEventLabels(language).commandFailed);
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      setTaskPhase("error", result.error || getAgentEventLabels(language).commandFailed);
      appendEvent("error", getAgentEventLabels(language).commandFailed, result.error || "Unknown error");
      return;
    }
    clearApprovalItem("command", commandId);
  }, [activeRequest, appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, markApprovalFailed, setBusy, startApprovalContinuation, setTaskPhase]);

  const answerQuestion = useCallback(async (questionId: string, option: string) => {
    if (busy) return;
    const question = questions.find((item) => item.id === questionId);
    if (!question) return;
    const requestId = startApprovalContinuation();
    const answer = formatQuestionAnswer(question.question, option);
    setMessages((current) => [...current, { role: "user", content: answer, createdAt: Date.now() }]);
    const result = await window.agentWindow.resumeApproval({
      requestId,
      continuationId: questionId,
      kind: "question",
      decision: "approved",
      answer: option,
      option,
      language
    });
    if (!result.ok) {
      markApprovalFailed("question", questionId, result.error || getAgentEventLabels(language).agentError);
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      setTaskPhase("error", result.error || getAgentEventLabels(language).agentError);
      appendEvent("error", getAgentEventLabels(language).agentError, result.error || "Unknown error");
      return;
    }
    clearApprovalItem("question", questionId);
  }, [activeRequest, appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, markApprovalFailed, questions, setBusy, setMessages, startApprovalContinuation, setTaskPhase]);

  const dismissQuestion = useCallback(async (questionId: string) => {
    if (busy) return;
    const question = questions.find((item) => item.id === questionId);
    if (!question) return;
    const requestId = startApprovalContinuation();
    const result = await window.agentWindow.resumeApproval({
      requestId,
      continuationId: questionId,
      kind: "question",
      decision: "dismissed",
      language
    });
    if (!result.ok) {
      markApprovalFailed("question", questionId, result.error || getAgentEventLabels(language).agentError);
      setBusy(false);
      activeRequest.current = null;
      clearActiveToolRuns();
      setTaskPhase("error", result.error || getAgentEventLabels(language).agentError);
      appendEvent("error", getAgentEventLabels(language).agentError, result.error || "Unknown error");
      return;
    }
    clearApprovalItem("question", questionId);
  }, [activeRequest, appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, markApprovalFailed, questions, setBusy, startApprovalContinuation, setTaskPhase]);

  const loadAutoApprovalState = useCallback(async (context: { workspace: string; sessionId?: string }) => {
    try {
      const result = await window.agentWindow.getAutoApprovalState({ ...context, enabled: false });
      applyAutoApprovalState(result);
    } catch {
      // Keep the current local UI state if the persisted scope cannot be read.
    }
  }, [applyAutoApprovalState]);

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

  const updateFullAccessAutoApproval = useCallback(async (enabled: boolean, context: { workspace: string; sessionId?: string }) => {
    const result = await window.agentWindow.setFullAccessAutoApproval({ ...context, enabled });
    applyAutoApprovalState(result);
    appendEvent(
      "status",
      enabled
        ? (language === "zh" ? "已启用完全访问权限" : "Full access enabled")
        : (language === "zh" ? "已恢复默认权限" : "Default permissions restored"),
      enabled
        ? (language === "zh" ? "命令与文件变更会自动执行；agent 仍可在需求不清时使用 ask_user 向你提问。" : "Commands and file changes run automatically; ask_user can still appear for clarification.")
        : (language === "zh" ? "有副作用的命令和文件变更会重新请求审批。" : "Commands with side effects and file changes will ask for approval again.")
    );
  }, [appendEvent, applyAutoApprovalState, language]);

  const resetAgentTransientState = useCallback(() => {
    clearCompletionTimer();
    setPatches([]);
    setCommands([]);
    setQuestions([]);
    setPlanItems([]);
    setToolDraft(null);
    clearActiveToolRuns();
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
    setTaskPhase("idle");
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
  }, [clearActiveToolRuns, clearCompletionTimer, setTaskPhase]);

  return {
    activeToolRuns,
    activeRequest,
    answerQuestion,
    applyPatch,
    approveCommand,
    beginRequest,
    busy,
    cancelActiveRequest,
    commandAutoApproval,
    commandAutoApprovalExpiresAt,
    commands,
    contextCompressionStatus,
    contextCompression,
    discardCommand,
    discardPatch,
    dismissQuestion,
    loadAutoApprovalState,
    loadPendingApprovals,
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
    taskStatus,
    toolDraft,
    updateCommandAutoApproval,
    updateFullAccessAutoApproval,
    updatePatchAutoApproval
  };
}

function classifyToolPhase(name: string): TaskStatus["phase"] {
  const normalized = String(name || "").toLowerCase();
  if (!normalized) return "understanding";
  if (["list_files", "read_file", "read_files", "read_file_range", "read_result_chunk", "search_files", "web_search", "workspace_map", "workspace_tree", "read_command_output"].includes(normalized)) return "searching";
  if (["write_file", "delete_file", "replace_text", "apply_patch"].includes(normalized)) return "editing";
  if (["run_command", "start_command", "stop_command", "browser_page", "system_clipboard", "system_window_info", "system_notify", "background_task"].includes(normalized)) return "running";
  if (["ask_user", "update_plan"].includes(normalized)) return "waiting";
  return "understanding";
}

function getTaskStatusLabels(language: Language) {
  if (language === "en") {
    return {
      idle: "",
      understanding: "Thinking",
      searching: "Reading files",
      editing: "Editing files",
      waiting: "Waiting for approval",
      running: "Running command",
      completed: "Completed",
      error: "Needs attention"
    };
  }
  return {
    idle: "",
    understanding: "思考中",
    searching: "读取文件",
    editing: "编辑文件",
    waiting: "等待审批",
    running: "运行命令",
    completed: "已完成",
    error: "需要处理"
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
      futureCommandsAllowedBody: "Future command requests in this chat and workspace will run automatically until you switch back.",
      commandFailed: "Command failed",
      commandConfirmRestored: "Future command confirmation restored",
      commandConfirmRestoredBody: "Future high-risk or side-effect commands will ask for confirmation again.",
      patchAutoApplyDisabled: "Patch auto-apply disabled",
      patchAutoApplyDisabledBody: "Future file changes will ask for confirmation again.",
      commandAutoRunEnabled: "Command auto-run enabled",
      commandAutoRunDisabled: "Command auto-run disabled",
      autoPermissionScoped: "Only applies to this chat until you switch back. File tools can access paths outside the workspace.",
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
    futureCommandsAllowedBody: "当前会话和 workspace 内，后续命令请求将自动执行，直到你切回默认权限。",
    commandFailed: "命令执行失败",
    commandConfirmRestored: "后续命令确认已恢复",
    commandConfirmRestoredBody: "agent 后续高危或副作用命令会再次请求确认。",
    patchAutoApplyDisabled: "自动应用 Patch 已关闭",
    patchAutoApplyDisabledBody: "agent 后续文件变更会再次请求确认。",
    commandAutoRunEnabled: "已启用命令自动执行",
    commandAutoRunDisabled: "已关闭命令自动执行",
    autoPermissionScoped: "仅当前会话生效，文件工具可访问 workspace 外路径，直到你切回默认权限。",
    commandNeedsConfirm: "高危或副作用命令会请求确认。",
    patchAutoApplyEnabled: "已启用 Patch 自动应用",
    patchNeedsConfirm: "文件写入、删除和 patch 会请求确认。"
  };
}
