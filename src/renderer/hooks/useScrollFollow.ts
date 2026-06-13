import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, CommandItem, EventLogItem, PatchItem, ToolRun, UserQuestionItem } from "../types";

type UseScrollFollowParams = {
  messages: ChatMessage[];
  events: EventLogItem[];
  patches: PatchItem[];
  commands: CommandItem[];
  questions: UserQuestionItem[];
  activeToolRuns: ToolRun[];
  busy: boolean;
  activityFilter: string;
  activitySearch: string;
  rightSidebarSection: string;
};

export function useScrollFollow({
  messages,
  events,
  patches,
  commands,
  questions,
  activeToolRuns,
  busy,
  activityFilter,
  activitySearch,
  rightSidebarSection
}: UseScrollFollowParams) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showActivityScrollToBottom, setShowActivityScrollToBottom] = useState(false);

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const activityListRef = useRef<HTMLDivElement | null>(null);
  const followOutputRef = useRef(true);
  const followActivityRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    followOutputRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  const scrollActivityToBottom = useCallback(() => {
    const list = activityListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    followActivityRef.current = true;
    setShowActivityScrollToBottom(false);
  }, []);

  useEffect(() => {
    if (!followOutputRef.current) return;
    const list = messageListRef.current;
    if (!list) return;
    requestAnimationFrame(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "instant" });
    });
  }, [messages, events, patches, commands, questions, activeToolRuns, busy]);

  useEffect(() => {
    if (rightSidebarSection !== "activity") return;
    followActivityRef.current = true;
    setShowActivityScrollToBottom(false);
  }, [rightSidebarSection]);

  useEffect(() => {
    if (rightSidebarSection !== "activity") return;
    if (!followActivityRef.current) return;
    const list = activityListRef.current;
    if (!list) return;
    requestAnimationFrame(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "instant" });
    });
  }, [events, activityFilter, activitySearch, rightSidebarSection]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;

    const onUserScroll = () => {
      const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      followOutputRef.current = distanceToBottom < 32;
      const shouldShow = !followOutputRef.current;
      setShowScrollToBottom(prev => prev !== shouldShow ? shouldShow : prev);
    };

    list.addEventListener("scroll", onUserScroll, { passive: true });
    return () => list.removeEventListener("scroll", onUserScroll);
  }, [busy]);

  useEffect(() => {
    const list = activityListRef.current;
    if (!list) return;

    const onActivityScroll = () => {
      const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      followActivityRef.current = distanceToBottom < 32;
      const shouldShow = rightSidebarSection === "activity" && !followActivityRef.current;
      setShowActivityScrollToBottom(prev => prev !== shouldShow ? shouldShow : prev);
    };

    list.addEventListener("scroll", onActivityScroll, { passive: true });
    return () => list.removeEventListener("scroll", onActivityScroll);
  }, [rightSidebarSection]);

  return {
    showScrollToBottom,
    showActivityScrollToBottom,
    messageListRef,
    activityListRef,
    followOutputRef,
    followActivityRef,
    scrollToBottom,
    scrollActivityToBottom
  };
}
