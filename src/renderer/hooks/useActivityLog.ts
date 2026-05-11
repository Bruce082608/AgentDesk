import { useCallback, useEffect, useRef, useState } from "react";
import type { EventLogItem } from "../types";
import { trimActivityEvents } from "../utils";

export function useActivityLog() {
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const eventsRef = useRef<EventLogItem[]>([]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    let cancelled = false;
    window.agentWindow.loadActivityEvents()
      .then((loaded) => {
        if (cancelled) return;
        setEvents(trimActivityEvents(Array.isArray(loaded) ? loaded : []));
        hydratedRef.current = true;
      })
      .catch(() => {
        if (!cancelled) hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      window.agentWindow.saveActivityEvents(events).catch(() => {});
    }, 250);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [events]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (hydratedRef.current) {
        window.agentWindow.saveActivityEvents(eventsRef.current).catch(() => {});
      }
    };
  }, []);

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
