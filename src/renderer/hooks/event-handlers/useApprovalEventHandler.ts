import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { Language } from "../../i18n";
import type { ChatMessage, CommandItem, PatchItem, TaskStatus, UserQuestionItem } from "../../types";
import { formatQuestionMessage, normalizeQuestionOptions } from "../../utils";

type UseApprovalEventHandlerParams = {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setTaskPhase: (phase: TaskStatus["phase"], detail?: string) => void;
  language: Language;
};

export function useApprovalEventHandler({
  setMessages,
  setTaskPhase,
  language
}: UseApprovalEventHandlerParams) {
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [questions, setQuestions] = useState<UserQuestionItem[]>([]);

  const handlePatchProposed = useCallback((event: { patchId: string; summary?: string; patch: string }, ui: any, appendEvent: any) => {
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
  }, [setTaskPhase]);

  const handleCommandPending = useCallback((event: {
    commandId: string;
    command: string;
    reason?: string;
    cwd?: string;
    timeoutMs?: number | null;
    shell?: string;
    inheritedEnv?: boolean;
    highRisk?: boolean;
  }, ui: any, appendEvent: any) => {
    setTaskPhase("waiting", event.reason || event.command);
    setCommands((current) => [
      {
        id: event.commandId,
        command: event.command,
        reason: event.reason || "",
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
  }, [setTaskPhase]);

  const handleAskUserPending = useCallback((event: {
    questionId: string;
    question: string;
    context?: string;
    options?: string[];
  }, ui: any, appendEvent: any) => {
    setTaskPhase("waiting", event.question);
    const options = normalizeQuestionOptions(event.options, event.question, language);
    const assistantQuestion = formatQuestionMessage(event.question, event.context, options);
    setQuestions((current) => [
      { id: event.questionId, question: event.question, context: event.context, options, status: "pending" },
      ...current
    ]);
    setMessages((current) => [...current, { role: "assistant", content: assistantQuestion, createdAt: Date.now() }]);
    appendEvent("patch", ui.agentQuestion, event.question);
  }, [setMessages, setTaskPhase, language]);

  return {
    patches,
    setPatches,
    commands,
    setCommands,
    questions,
    setQuestions,
    handlePatchProposed,
    handleCommandPending,
    handleAskUserPending
  };
}
