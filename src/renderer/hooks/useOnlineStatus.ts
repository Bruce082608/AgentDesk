import { useEffect, useState } from "react";
import type { ChatMessage, EventLogItem } from "../types";

type Translation = {
  networkRestoredTitle: string;
  networkRestoredBody: string;
};

type UseOnlineStatusParams = {
  appendEvent: (kind: EventLogItem["kind"], title: string, body: string) => void;
  t: Translation;
};

export type RetryRequest = {
  inputText: string;
  priorMessages: ChatMessage[];
  nextMessages: ChatMessage[];
} | null;

export function useOnlineStatus({
  appendEvent,
  t
}: UseOnlineStatusParams) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [retryRequest, setRetryRequest] = useState<RetryRequest>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (retryRequest) {
        appendEvent("status", t.networkRestoredTitle, t.networkRestoredBody);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [appendEvent, retryRequest, t.networkRestoredBody, t.networkRestoredTitle]);

  return {
    isOnline,
    setIsOnline,
    retryRequest,
    setRetryRequest
  };
}
