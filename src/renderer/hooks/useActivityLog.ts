import { useCallback, useState } from "react";
import type { EventLogItem } from "../types";
import { trimActivityEvents } from "../utils";

export function useActivityLog() {
  const [events, setEvents] = useState<EventLogItem[]>([]);

  const appendEvent = useCallback((kind: EventLogItem["kind"], title: string, body: string) => {
    setEvents((current) => trimActivityEvents([...current, { id: crypto.randomUUID(), title, body, kind, createdAt: Date.now() }]));
  }, []);

  const resetEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    setEvents,
    appendEvent,
    resetEvents
  };
}
