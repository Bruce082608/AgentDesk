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

  const resetStreamState = useCallback(() => {
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
    setToolDraft(null);
    setStreamingResponse(false);
    setStreamRecoveryStatus(null);
  }, []);

  const handleStreamDelta = useCallback((text: string) => {
    setStreamingResponse(true);
    if (taskStatusPhase === "idle") {
      setTaskPhase("understanding");
    }
    setMessages((current) => {
      if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
        streamingMessageActive.current = true;
        return [...current, { role: "assistant", content: text, createdAt: Date.now() }];
      }
      const next = [...current];
      next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + text };
      return next;
    });
  }, [setMessages, setTaskPhase, taskStatusPhase]);

  const handleReasoningDelta = useCallback((text: string) => {
    setStreamingResponse(true);
    if (taskStatusPhase === "idle") {
      setTaskPhase("understanding");
    }
    setMessages((current) => {
      if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
        reasoningMessageActive.current = true;
        return [...current, { role: "assistant", content: "", reasoning: text, createdAt: Date.now() }];
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
    setToolDraft((current) => ({
      name: name || current?.name || "tool_call",
      text: `${current?.text || ""}${text || ""}`
    }));
  }, [setTaskPhase, taskStatusPhase]);

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
