import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../../i18n";
import type { TaskStatus } from "../../types";
import { getTaskStatusLabels } from "./agent-event-labels";

export function useTaskStatusHandler(language: Language) {
  const [taskStatus, setTaskStatus] = useState<TaskStatus>({ phase: "idle", label: "" });
  const completionTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (completionTimer.current) {
        window.clearTimeout(completionTimer.current);
      }
    };
  }, []);

  const clearCompletionTimer = useCallback(() => {
    if (!completionTimer.current) return;
    window.clearTimeout(completionTimer.current);
    completionTimer.current = null;
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

  return {
    taskStatus,
    setTaskStatus,
    setTaskPhase,
    clearCompletionTimer,
    completionTimer
  };
}
