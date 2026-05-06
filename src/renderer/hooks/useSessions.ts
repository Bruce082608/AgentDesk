import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { translations } from "../i18n";
import type { ChatMessage, ChatSession, TokenUsageStats } from "../types";
import { MAX_SAVED_SESSIONS } from "../types";
import { createBlankSession, deriveSessionTitle, loadChatSessions, saveChatSessions } from "../utils";

type Translation = typeof translations[keyof typeof translations];

type UseSessionsParams = {
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

  useEffect(() => {
    const savedSessions = loadChatSessions();
    const initialSession = savedSessions[0] ?? createBlankSession(workspace);
    const nextSessions = savedSessions.length > 0 ? savedSessions : [initialSession];
    setSessions(nextSessions);
    setActiveSessionId(initialSession.id);
    setMessages(initialSession.messages);
    setTokenUsage(initialSession.tokenUsage);
    if (initialSession.workspace) {
      setWorkspace(initialSession.workspace);
      refreshWorkspace(initialSession.workspace);
      refreshGit(initialSession.workspace);
    }
    setSessionsLoaded(true);
    // Initial load intentionally runs once; refresh functions are stable enough for follow-up calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      saveChatSessions(next);
      return next;
    });
  }, [activeSessionId, messages, sessionsLoaded, tokenUsage, workspace]);

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
      saveChatSessions(next);
      return next;
    });
  }, [activeSessionId, messages, tokenUsage, workspace]);

  const startNewSession = useCallback(() => {
    if (busy) return;
    const session = createBlankSession(workspace);
    setSessions((current) => {
      const next = [session, ...current].slice(0, MAX_SAVED_SESSIONS);
      saveChatSessions(next);
      return next;
    });
    setActiveSessionId(session.id);
    setMessages([]);
    resetSessionTokenUsage();
    resetTransientState();
  }, [busy, resetSessionTokenUsage, resetTransientState, setMessages, workspace]);

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
      saveChatSessions(next);
      return next;
    });
    setRenamingSessionId("");
    setRenamingTitle("");
  }, [renamingTitle]);

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
      saveChatSessions(normalized);
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
  }, [activeSessionId, busy, clearWorkspaceData, refreshGit, refreshWorkspace, resetTransientState, setMessages, setTokenUsage, setWorkspace, t.deleteSessionConfirm, workspace]);

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
