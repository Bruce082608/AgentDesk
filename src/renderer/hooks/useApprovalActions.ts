import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Language } from "../i18n";
import type { ChatMessage, ApprovalRecord } from "../global";
import type { CommandItem, PatchItem, TaskStatus, UserQuestionItem, EventLogItem } from "../types";
import { formatQuestionAnswer } from "../utils";
import { getAgentEventLabels } from "./event-handlers/agent-event-labels";

type UseApprovalActionsParams = {
  patches: PatchItem[];
  setPatches: Dispatch<SetStateAction<PatchItem[]>>;
  commands: CommandItem[];
  setCommands: Dispatch<SetStateAction<CommandItem[]>>;
  questions: UserQuestionItem[];
  setQuestions: Dispatch<SetStateAction<UserQuestionItem[]>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  activeRequest: MutableRefObject<string | null>;
  clearActiveToolRuns: () => void;
  setTaskPhase: (phase: TaskStatus["phase"], detail?: string) => void;
  beginRequest: (requestId: string, waitingPlan: string) => void;
  applyAutoApprovalState: (result: {
    commandAutoApproval: boolean;
    patchAutoApproval: boolean;
    fullAccessAutoApproval?: boolean;
    commandAutoApprovalExpiresAt?: number | null;
    patchAutoApprovalExpiresAt?: number | null;
  }) => void;
  language: Language;
  appendEvent: (kind: EventLogItem["kind"], title: string, body: string) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

export function useApprovalActions({
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
}: UseApprovalActionsParams) {
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
  }, [setPatches, setCommands, setQuestions]);

  const clearApprovalItem = useCallback((kind: "patch" | "command" | "question", id: string) => {
    if (kind === "patch") {
      setPatches((current) => current.filter((item) => item.id !== id));
    } else if (kind === "command") {
      setCommands((current) => current.filter((item) => item.id !== id));
    } else {
      setQuestions((current) => current.filter((item) => item.id !== id));
    }
  }, [setPatches, setCommands, setQuestions]);

  const markApprovalFailed = useCallback((kind: "patch" | "command" | "question", id: string, error: string) => {
    if (kind === "patch") {
      setPatches((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error } : item));
    } else if (kind === "command") {
      setCommands((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error } : item));
    } else {
      setQuestions((current) => current.filter((item) => item.id !== id));
    }
  }, [setPatches, setCommands, setQuestions]);

  const cancelActiveRequest = useCallback(async () => {
    if (!activeRequest.current) return;
    await window.agentWindow.cancelMessage(activeRequest.current);
  }, [activeRequest]);

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
  }, [appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, markApprovalFailed, patches, startApprovalContinuation, setTaskPhase, activeRequest, setBusy]);

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
  }, [appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, startApprovalContinuation, setTaskPhase, activeRequest, setBusy]);

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
    
    // Clear instantly from UI state so the box disappears immediately
    clearApprovalItem("question", questionId);

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
  }, [activeRequest, appendEvent, busy, clearActiveToolRuns, clearApprovalItem, language, markApprovalFailed, questions, setBusy, setMessages, startApprovalContinuation, setTaskPhase]);

  const dismissQuestion = useCallback(async (questionId: string) => {
    if (activeRequest.current) {
      try {
        await window.agentWindow.cancelMessage(activeRequest.current);
      } catch (err) {
        console.error("Failed to cancel message on dismiss:", err);
      }
    }
    try {
      await (window as any).agentWindow.deleteContinuation(questionId);
    } catch (err) {
      console.error("Failed to delete continuation on dismiss:", err);
    }
    clearApprovalItem("question", questionId);
  }, [activeRequest, clearApprovalItem]);

  return {
    loadPendingApprovals,
    clearApprovalItem,
    markApprovalFailed,
    cancelActiveRequest,
    startApprovalContinuation,
    applyPatch,
    discardPatch,
    approveCommand,
    discardCommand,
    answerQuestion,
    dismissQuestion
  };
}
