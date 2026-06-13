import { useEffect, useState } from "react";
import type { AttachedFile } from "../global";
import type { ChatMessage } from "../types";

type UseTokenCounterParams = {
  messages: ChatMessage[];
  attachedFiles: AttachedFile[];
  input: string;
};

export function useTokenCounter({
  messages,
  attachedFiles,
  input
}: UseTokenCounterParams) {
  const [baseContextTokenCount, setBaseContextTokenCount] = useState(0);
  const [inputTokenCount, setInputTokenCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.agentWindow.countTokens({ messages, input: "", attachments: attachedFiles })
        .then((result) => {
          if (!cancelled) setBaseContextTokenCount(result.tokens);
        })
        .catch(() => {
          if (!cancelled) setBaseContextTokenCount(0);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [messages, attachedFiles]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.agentWindow.countTokens({ messages: [], input, attachments: [] })
        .then((result) => {
          if (!cancelled) setInputTokenCount(result.tokens);
        })
        .catch(() => {
          if (!cancelled) setInputTokenCount(0);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input]);

  return {
    baseContextTokenCount,
    inputTokenCount,
    contextTokenCount: baseContextTokenCount + inputTokenCount
  };
}
