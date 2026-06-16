import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Language } from "../i18n";
import type { AgentEvent, ChatMessage } from "../global";
import type { EventLogItem, PlanItem, TokenUsageStats } from "../types";

// Helper/Label functions
import { getAgentEventLabels } from "./event-handlers/agent-event-labels";

// Subhooks
import { useTaskStatusHandler } from "./event-handlers/useTaskStatusHandler";
import { useStreamHandler } from "./event-handlers/useStreamHandler";
import { useToolExecutionHandler } from "./event-handlers/useToolExecutionHandler";
import { useApprovalEventHandler } from "./event-handlers/useApprovalEventHandler";
import { useAutoApproval } from "./useAutoApproval";
import { useContextCompression } from "./useContextCompression";
import { useApprovalActions } from "./useApprovalActions";

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
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [busy, setBusy] = useState(false);
  const activeRequest = useRef<string | null>(null);

  // Hook 1: Task Status Manager
  const {
    taskStatus,
    setTaskPhase,
    clearCompletionTimer,
    completionTimer
  } = useTaskStatusHandler(language);

  // Hook 2: Stream Handler
  const {
    streamingResponse,
    setStreamingResponse,
    streamRecoveryStatus,
    setStreamRecoveryStatus,
    toolDraft,
    setToolDraft,
    streamingMessageActive,
    reasoningMessageActive,
    resetStreamState,
    handleStreamDelta,
    handleReasoningDelta,
    handleToolCallDelta,
    handleStreamRecovery
  } = useStreamHandler({
    setMessages,
    setTaskPhase,
    taskStatusPhase: taskStatus.phase
  });

  // Hook 3: Tool Execution Handler
  const {
    activeToolRuns,
    clearActiveToolRuns,
    takeActiveToolRun,
    handleToolStart,
    handleToolResult,
    handleToolError
  } = useToolExecutionHandler({
    setMessages,
    setTaskPhase,
    taskStatusPhase: taskStatus.phase
  });

  // Hook 4: Approval Event Handler (State & propose handlers)
  const {
    patches,
    setPatches,
    commands,
    setCommands,
    questions,
    setQuestions,
    handlePatchProposed,
    handleCommandPending,
    handleAskUserPending
  } = useApprovalEventHandler({
    setMessages,
    setTaskPhase,
    language
  });

  // Hook 5: Auto Approval States & handlers
  const {
    commandAutoApproval,
    patchAutoApproval,
    commandAutoApprovalExpiresAt,
    patchAutoApprovalExpiresAt,
    applyAutoApprovalState,
    loadAutoApprovalState,
    resetCommandAutoApproval,
    resetPatchAutoApproval,
    updateCommandAutoApproval,
    updatePatchAutoApproval,
    updateFullAccessAutoApproval
  } = useAutoApproval({
    language,
    appendEvent
  });

  // Hook 6: Context Compression
  const {
    contextCompressionStatus,
    contextCompression,
    resetContextCompression,
    updateCompressionStatus
  } = useContextCompression({
    language
  });

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
      handleStreamDelta(event.text);
      return;
    }

    if (event.type === "reasoning_delta") {
      handleReasoningDelta(event.text);
      return;
    }

    if (event.type === "tool_call_delta") {
      handleToolCallDelta(event.name, event.text);
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
      updateCompressionStatus(event.phase, event.message, event.summary || "", event.effectiveTokens, event.inputBudgetTokens);
      if (event.phase === "start") setTaskPhase("understanding", event.message);
      if (event.phase === "done") setTaskPhase("understanding", event.message);
      if (event.phase === "failed") setTaskPhase("understanding", event.message);
      return;
    }

    if (event.type === "tool_start") {
      handleToolStart(event, ui, appendEvent);
      return;
    }

    if (event.type === "stream_recovery") {
      handleStreamRecovery(event, ui, appendEvent);
      return;
    }

    if (event.type === "tool_result") {
      handleToolResult(event, ui, appendEvent);
      return;
    }

    if (event.type === "tool_error") {
      handleToolError(event, ui, appendEvent);
      return;
    }

    if (event.type === "patch_proposed") {
      handlePatchProposed(event, ui, appendEvent);
      return;
    }

    if (event.type === "patch_applied") {
      setTaskPhase("editing", event.summary || event.patchId);
      appendEvent("patch", ui.patchAutoApplied, `${event.summary || event.patchId}${event.strategy ? ` (${event.strategy})` : ""}`);
      void refreshWorkspace();
      void refreshGit();
      return;
    }

    if (event.type === "command_pending") {
      handleCommandPending(event, ui, appendEvent);
      return;
    }

    if (event.type === "ask_user_pending") {
      handleAskUserPending(event, ui, appendEvent);
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
  }, [
    appendEvent,
    clearActiveToolRuns,
    clearCompletionTimer,
    language,
    recordTokenUsage,
    refreshGit,
    refreshWorkspace,
    resetStreamState,
    setMessages,
    updateCompressionStatus,
    setTaskPhase,
    handleStreamDelta,
    handleReasoningDelta,
    handleToolCallDelta,
    handleToolStart,
    handleStreamRecovery,
    handleToolResult,
    handleToolError,
    handlePatchProposed,
    handleCommandPending,
    handleAskUserPending,
    completionTimer
  ]);

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
    resetContextCompression();
    setBusy(true);
    setTaskPhase("understanding");
    setPlanItems([{ step: waitingPlan, status: "in_progress" }]);
  }, [clearActiveToolRuns, clearCompletionTimer, resetContextCompression, setTaskPhase, streamingMessageActive, reasoningMessageActive, setToolDraft, setStreamingResponse, setStreamRecoveryStatus]);

  // Hook 7: Action Executor
  const {
    loadPendingApprovals,
    applyPatch,
    discardPatch,
    approveCommand,
    discardCommand,
    answerQuestion,
    dismissQuestion,
    cancelActiveRequest
  } = useApprovalActions({
    patches,
    setPatches,
    commands,
    setCommands,
    questions,
    setQuestions,
    busy,
    setBusy,
    activeRequest,
    clearActiveToolRuns,
    setTaskPhase,
    beginRequest,
    applyAutoApprovalState,
    language,
    appendEvent,
    setMessages
  });

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
    resetContextCompression();
    setTaskPhase("idle");
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
  }, [clearActiveToolRuns, clearCompletionTimer, resetContextCompression, setTaskPhase, setPatches, setCommands, setQuestions, setToolDraft, setStreamingResponse, setStreamRecoveryStatus, streamingMessageActive, reasoningMessageActive]);

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
