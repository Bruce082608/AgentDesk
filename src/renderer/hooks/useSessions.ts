import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { translations } from "../i18n";
import type { ChatMessage, ChatSession, TokenUsageStats } from "../types";
import { MAX_SAVED_SESSIONS } from "../types";
import { createBlankSession, deriveSessionTitle, loadChatSessions } from "../utils";

type Translation = typeof translations[keyof typeof translations];

type UseSessionsParams = {
  appendEvent: (kind: "status" | "tool" | "error" | "model" | "patch", title: string, body: string) => void;
  busy: boolean;
  clearWorkspaceData: () => void;
  messages: ChatMessage[];
  refreshGit: (target?: string) => Promise<void>;
  refreshWorkspace: (target?: string) => Promise<void>;
  resetSessionTokenUsage: () => void;
  resetTransientState: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setTokenUsage: Dispatch<SetStateAction<TokenUsageStats>>;
  setWorkspace: Dispatch<SetStateAction<string>>;
  t: Translation;
  tokenUsage: TokenUsageStats;
  workspace: string;
};

export function useSessions({
  appendEvent,
  busy,
  clearWorkspaceData,
  messages,
  refreshGit,
  refreshWorkspace,
  resetSessionTokenUsage,
  resetTransientState,
  setMessages,
  setTokenUsage,
  setWorkspace,
  t,
  tokenUsage,
  workspace
}: UseSessionsParams) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renamingTitle, setRenamingTitle] = useState("");
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<ChatSession[] | null>(null);
  const storageWarningRef = useRef("");

  const flushSessionSave = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    try {
      const result = await window.agentWindow.saveSessions(pending);
      if (result.ok && result.count < pending.length && storageWarningRef.current !== "compacted") {
        storageWarningRef.current = "compacted";
        appendEvent("status", t.sessionStorageCompacted, t.sessionStorageCompactedBody);
      }
    } catch (error) {
      if (storageWarningRef.current !== "failed") {
        storageWarningRef.current = "failed";
        appendEvent("error", t.sessionStorageFailed, error instanceof Error ? error.message : t.sessionStorageFailedBody);
      }
    }
  }, [appendEvent, t]);

  const scheduleSessionSave = useCallback((nextSessions: ChatSession[], immediate = false) => {
    pendingSaveRef.current = nextSessions;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (immediate) {
      void flushSessionSave();
      return;
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSessionSave();
    }, 350);
  }, [flushSessionSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      void flushSessionSave();
    };
  }, [flushSessionSave]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const savedSessions = await window.agentWindow.loadSessions();
        let nextSessions = Array.isArray(savedSessions) ? savedSessions : [];
        if (nextSessions.length === 0) {
          const legacySessions = loadChatSessions();
          if (legacySessions.length > 0) {
            nextSessions = legacySessions;
            await window.agentWindow.saveSessions(nextSessions);
            localStorage.removeItem("agent-chat-sessions");
          }
        }
        if (nextSessions.length === 0) {
          nextSessions = [createBlankSession(workspace)];
        }

        if (cancelled) return;
        setSessions(nextSessions);
        const initialSession = nextSessions[0];
        setActiveSessionId(initialSession.id);
        setMessages(initialSession.messages);
        setTokenUsage(initialSession.tokenUsage);
        if (initialSession.workspace) {
          setWorkspace(initialSession.workspace);
          await refreshWorkspace(initialSession.workspace);
          await refreshGit(initialSession.workspace);
        }
        setSessionsLoaded(true);
        scheduleSessionSave(nextSessions, true);
      } catch (error) {
        if (cancelled) return;
        appendEvent("error", t.sessionStorageFailed, error instanceof Error ? error.message : t.sessionStorageFailedBody);
        const fallback = [createBlankSession(workspace)];
        setSessions(fallback);
        setActiveSessionId(fallback[0].id);
        setMessages(fallback[0].messages);
        setTokenUsage(fallback[0].tokenUsage);
        setSessionsLoaded(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // Initial load intentionally runs once; refresh functions are stable enough for follow-up calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window.agentWindow.onSessionsUpdated !== "function") return;

    const unsubscribe = window.agentWindow.onSessionsUpdated(async () => {
      try {
        const savedSessions = await window.agentWindow.loadSessions();
        let nextSessions = Array.isArray(savedSessions) ? savedSessions : [];
        if (nextSessions.length > 0) {
          setSessions(nextSessions);
          const activeSession = nextSessions.find((s) => s.id === activeSessionId);
          if (activeSession) {
            setMessages(activeSession.messages);
            setTokenUsage(activeSession.tokenUsage);
            if (activeSession.workspace && activeSession.workspace !== workspace) {
              setWorkspace(activeSession.workspace);
              await refreshWorkspace(activeSession.workspace);
              await refreshGit(activeSession.workspace);
            }
          }
        }
      } catch (error) {
        console.error("Failed to reload sessions on update event:", error);
      }
    });

    return unsubscribe;
  }, [activeSessionId, refreshGit, refreshWorkspace, setMessages, setTokenUsage, setWorkspace, workspace]);

  useEffect(() => {
    if (!sessionsLoaded || !activeSessionId) return;
    setSessions((current) => {
      const next = current
        .map((session) => {
          if (session.id !== activeSessionId) return session;
          return {
            ...session,
            title: session.titleEdited ? session.title : deriveSessionTitle(messages, session.title),
            workspace,
            messages,
            tokenUsage,
            updatedAt: Date.now()
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SAVED_SESSIONS);
      scheduleSessionSave(next);
      return next;
    });
  }, [activeSessionId, messages, scheduleSessionSave, sessionsLoaded, tokenUsage, workspace]);

  const persistActiveSession = useCallback((updates: Partial<ChatSession>) => {
    if (!activeSessionId) return;
    setSessions((current) => {
      const next = current.map((session) => {
        if (session.id !== activeSessionId) return session;
        return {
          ...session,
          ...updates,
          messages: updates.messages ?? messages,
          tokenUsage: updates.tokenUsage ?? tokenUsage,
          workspace: updates.workspace ?? workspace,
          updatedAt: Date.now()
        };
      });
      scheduleSessionSave(next, true);
      return next;
    });
  }, [activeSessionId, messages, scheduleSessionSave, tokenUsage, workspace]);

  const startNewSession = useCallback((initialWorkspace?: string) => {
    if (busy) return;
    const ws = typeof initialWorkspace === "string" ? initialWorkspace : "";
    const session = createBlankSession(ws);
    setSessions((current) => {
      const next = [session, ...current].slice(0, MAX_SAVED_SESSIONS);
      scheduleSessionSave(next, true);
      return next;
    });
    setActiveSessionId(session.id);
    setMessages([]);
    setWorkspace(ws);
    if (ws) {
      void refreshWorkspace(ws);
      void refreshGit(ws);
    } else {
      clearWorkspaceData();
    }
    resetSessionTokenUsage();
    resetTransientState();
  }, [busy, clearWorkspaceData, refreshWorkspace, refreshGit, resetSessionTokenUsage, resetTransientState, scheduleSessionSave, setMessages, setWorkspace]);

  const selectSession = useCallback(async (sessionId: string) => {
    if (busy || sessionId === activeSessionId) return;
    persistActiveSession({ workspace, messages, tokenUsage });
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setTokenUsage(session.tokenUsage);
    setWorkspace(session.workspace);
    resetTransientState();
    if (session.workspace) {
      await refreshWorkspace(session.workspace);
      await refreshGit(session.workspace);
    } else {
      clearWorkspaceData();
    }
  }, [activeSessionId, busy, clearWorkspaceData, messages, persistActiveSession, refreshGit, refreshWorkspace, resetTransientState, sessions, setMessages, setTokenUsage, setWorkspace, tokenUsage, workspace]);

  const startRenameSession = useCallback((sessionId: string) => {
    if (busy) return;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setRenamingSessionId(sessionId);
    setRenamingTitle(session.title);
  }, [busy, sessions]);

  const commitRenameSession = useCallback((sessionId: string) => {
    const nextTitle = renamingTitle.trim();
    if (!nextTitle) return;
    setSessions((current) => {
      const next = current.map((item) => item.id === sessionId ? { ...item, title: nextTitle, titleEdited: true, updatedAt: Date.now() } : item);
      scheduleSessionSave(next, true);
      return next;
    });
    setRenamingSessionId("");
    setRenamingTitle("");
  }, [renamingTitle, scheduleSessionSave]);

  const cancelRenameSession = useCallback(() => {
    setRenamingSessionId("");
    setRenamingTitle("");
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    if (busy) return;
    if (!window.confirm(t.deleteSessionConfirm)) return;
    setSessions((current) => {
      const next = current.filter((item) => item.id !== sessionId);
      const fallback = next[0] ?? createBlankSession(workspace);
      const normalized = next.length > 0 ? next : [fallback];
      scheduleSessionSave(normalized, true);
      if (sessionId === activeSessionId) {
        setActiveSessionId(fallback.id);
        setMessages(fallback.messages);
        setTokenUsage(fallback.tokenUsage);
        setWorkspace(fallback.workspace);
        resetTransientState();
        if (fallback.workspace) {
          refreshWorkspace(fallback.workspace);
          refreshGit(fallback.workspace);
        } else {
          clearWorkspaceData();
        }
      }
      return normalized;
    });
  }, [activeSessionId, busy, clearWorkspaceData, refreshGit, refreshWorkspace, resetTransientState, scheduleSessionSave, setMessages, setTokenUsage, setWorkspace, t.deleteSessionConfirm, workspace]);

  const clearCurrentSession = useCallback(() => {
    if (busy) return;
    setMessages([]);
    resetSessionTokenUsage();
    resetTransientState();
  }, [busy, resetSessionTokenUsage, resetTransientState, setMessages]);

  return {
    activeSessionId,
    cancelRenameSession,
    clearCurrentSession,
    commitRenameSession,
    deleteSession,
    persistActiveSession,
    renamingSessionId,
    renamingTitle,
    selectSession,
    sessions,
    sessionsLoaded,
    setRenamingTitle,
    startNewSession,
    startRenameSession
  };
}
