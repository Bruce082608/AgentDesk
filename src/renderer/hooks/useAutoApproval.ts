import { useCallback, useState } from "react";
import type { Language } from "../i18n";
import { getAgentEventLabels } from "./event-handlers/agent-event-labels";

type AutoApprovalState = {
  commandAutoApproval: boolean;
  patchAutoApproval: boolean;
  fullAccessAutoApproval?: boolean;
  commandAutoApprovalExpiresAt?: number | null;
  patchAutoApprovalExpiresAt?: number | null;
};

type UseAutoApprovalParams = {
  language: Language;
  appendEvent: (kind: "status" | "error" | "model" | "tool" | "patch", title: string, body: string) => void;
};

export function useAutoApproval({
  language,
  appendEvent
}: UseAutoApprovalParams) {
  const [commandAutoApproval, setCommandAutoApproval] = useState(false);
  const [patchAutoApproval, setPatchAutoApproval] = useState(false);
  const [commandAutoApprovalExpiresAt, setCommandAutoApprovalExpiresAt] = useState<number | null>(null);
  const [patchAutoApprovalExpiresAt, setPatchAutoApprovalExpiresAt] = useState<number | null>(null);

  const applyAutoApprovalState = useCallback((result: AutoApprovalState) => {
    setCommandAutoApproval(result.commandAutoApproval);
    setPatchAutoApproval(result.patchAutoApproval);
    setCommandAutoApprovalExpiresAt(result.commandAutoApprovalExpiresAt || null);
    setPatchAutoApprovalExpiresAt(result.patchAutoApprovalExpiresAt || null);
  }, []);

  const loadAutoApprovalState = useCallback(async (context: { workspace: string; sessionId?: string }) => {
    try {
      const result = await window.agentWindow.getAutoApprovalState({ ...context, enabled: false });
      applyAutoApprovalState(result);
    } catch {
      // Keep current state
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

  return {
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
  };
}
