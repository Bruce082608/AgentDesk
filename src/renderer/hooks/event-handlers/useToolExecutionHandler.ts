import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatMessage, TaskStatus, ToolRun } from "../../types";
import { classifyToolPhase } from "./agent-event-labels";

type UseToolExecutionHandlerParams = {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setTaskPhase: (phase: TaskStatus["phase"], detail?: string) => void;
  taskStatusPhase: TaskStatus["phase"];
};

export function useToolExecutionHandler({
  setMessages,
  setTaskPhase,
  taskStatusPhase
}: UseToolExecutionHandlerParams) {
  const [activeToolRuns, setActiveToolRuns] = useState<ToolRun[]>([]);
  const activeToolRunMap = useRef(new Map<string, ToolRun>());

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

  const handleToolStart = useCallback((event: { toolCallId?: string; name: string; args: string; requestId: string }, ui: any, appendEvent: any) => {
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
  }, [setTaskPhase]);

  const handleToolResult = useCallback((event: { toolCallId?: string; name: string; result: string }, ui: any, appendEvent: any) => {
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
    if (taskStatusPhase !== "waiting") {
      setTaskPhase(classifyToolPhase(event.name), event.name);
    }
    appendEvent("tool", `${ui.toolResult}: ${event.name}`, event.result);
  }, [takeActiveToolRun, setMessages, setTaskPhase, taskStatusPhase]);

  const handleToolError = useCallback((event: { toolCallId?: string; name: string; result?: string; message: string }, ui: any, appendEvent: any) => {
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
  }, [takeActiveToolRun, setMessages, setTaskPhase]);

  return {
    activeToolRuns,
    setActiveToolRuns,
    clearActiveToolRuns,
    takeActiveToolRun,
    handleToolStart,
    handleToolResult,
    handleToolError
  };
}
