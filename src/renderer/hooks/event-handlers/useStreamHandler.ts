import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatMessage, StreamRecoveryStatus, TaskStatus, ToolDraft } from "../../types";

type UseStreamHandlerParams = {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setTaskPhase: (phase: TaskStatus["phase"], detail?: string) => void;
  taskStatusPhase: TaskStatus["phase"];
};

export function useStreamHandler({
  setMessages,
  setTaskPhase,
  taskStatusPhase
}: UseStreamHandlerParams) {
  const [streamingResponse, setStreamingResponse] = useState(false);
  const [streamRecoveryStatus, setStreamRecoveryStatus] = useState<StreamRecoveryStatus | null>(null);
  const [toolDraft, setToolDraft] = useState<ToolDraft | null>(null);
  const streamingMessageActive = useRef(false);
  const reasoningMessageActive = useRef(false);
  const reasoningStartTimeRef = useRef<number | null>(null);

  const stopReasoningTime = useCallback(() => {
    if (reasoningStartTimeRef.current !== null) {
      const duration = Date.now() - reasoningStartTimeRef.current;
      reasoningStartTimeRef.current = null;
      return duration;
    }
    return null;
  }, []);

  const resetStreamState = useCallback(() => {
    const reasoningDuration = stopReasoningTime();
    if (reasoningDuration !== null) {
      setMessages((current) => {
        if (current.length === 0 || current[current.length - 1]?.role !== "assistant") return current;
        const next = [...current];
        const last = next[next.length - 1];
        if (last.reasoning && last.reasoningDurationMs === undefined) {
          next[next.length - 1] = {
            ...last,
            reasoningDurationMs: reasoningDuration
          };
        }
        return next;
      });
    }
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
    setToolDraft(null);
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
  }, [setMessages, stopReasoningTime]);

  const handleStreamDelta = useCallback((text: string) => {
    setStreamingResponse(true);
    if (taskStatusPhase === "idle") {
      setTaskPhase("understanding");
    }
    const reasoningDuration = stopReasoningTime();
    setMessages((current) => {
      if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
        streamingMessageActive.current = true;
        const newMessage: ChatMessage = { role: "assistant", content: text, createdAt: Date.now() };
        return [...current, newMessage];
      }
      const next = [...current];
      const last = next[next.length - 1];
      const updatedLast = {
        ...last,
        content: last.content + text
      };
      if (reasoningDuration !== null && last.reasoning && last.reasoningDurationMs === undefined) {
        updatedLast.reasoningDurationMs = reasoningDuration;
      }
      next[next.length - 1] = updatedLast;
      return next;
    });
  }, [setMessages, setTaskPhase, taskStatusPhase, stopReasoningTime]);

  const handleReasoningDelta = useCallback((text: string) => {
    setStreamingResponse(true);
    if (taskStatusPhase === "idle") {
      setTaskPhase("understanding");
    }
    if (reasoningStartTimeRef.current === null) {
      reasoningStartTimeRef.current = Date.now();
    }
    setMessages((current) => {
      if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
        reasoningMessageActive.current = true;
        const newMessage: ChatMessage = { role: "assistant", content: "", reasoning: text, createdAt: Date.now() };
        return [...current, newMessage];
      }
      const next = [...current];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, reasoning: `${last.reasoning || ""}${text}` };
      return next;
    });
  }, [setMessages, setTaskPhase, taskStatusPhase]);

  const handleToolCallDelta = useCallback((name?: string, text?: string) => {
    if (taskStatusPhase === "idle") {
      setTaskPhase("understanding");
    }
    const reasoningDuration = stopReasoningTime();
    if (reasoningDuration !== null) {
      setMessages((current) => {
        if (current.length === 0 || current[current.length - 1]?.role !== "assistant") return current;
        const next = [...current];
        const last = next[next.length - 1];
        if (last.reasoning && last.reasoningDurationMs === undefined) {
          next[next.length - 1] = {
            ...last,
            reasoningDurationMs: reasoningDuration
          };
        }
        return next;
      });
    }
    setToolDraft((current) => ({
      name: name || current?.name || "tool_call",
      text: `${current?.text || ""}${text || ""}`
    }));
  }, [setTaskPhase, taskStatusPhase, stopReasoningTime, setMessages]);

  const handleStreamRecovery = useCallback((event: { message: string; attempt: number; maxAttempts: number; recovering: boolean }, ui: any, appendEvent: any) => {
    setStreamRecoveryStatus({
      message: event.message,
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      recovering: event.recovering
    });
    appendEvent(event.recovering ? "status" : "error", event.recovering ? ui.streamRecovery : ui.streamInterrupted, event.message);
  }, []);

  return {
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
  };
}
