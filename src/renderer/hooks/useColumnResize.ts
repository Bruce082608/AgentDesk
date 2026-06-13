import { useCallback, useEffect, useState } from "react";
import {
  LEFT_SIDEBAR_WIDTH_KEY,
  RIGHT_SIDEBAR_WIDTH_KEY,
  MIN_LEFT_SIDEBAR_WIDTH,
  MAX_LEFT_SIDEBAR_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  MAX_RIGHT_SIDEBAR_WIDTH,
  MIN_CONVERSATION_WIDTH,
  RESIZE_HANDLE_WIDTH
} from "../types";
import { readStoredNumber } from "../utils";

export function useColumnResize() {
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredNumber(LEFT_SIDEBAR_WIDTH_KEY, 292, MIN_LEFT_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH)
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readStoredNumber(RIGHT_SIDEBAR_WIDTH_KEY, 340, MIN_RIGHT_SIDEBAR_WIDTH, MAX_RIGHT_SIDEBAR_WIDTH)
  );
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    localStorage.getItem("agent-left-sidebar-collapsed") === "true"
  );
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() =>
    localStorage.getItem("agent-right-sidebar-collapsed") === "true"
  );

  const toggleLeftSidebar = useCallback(() => {
    setLeftSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("agent-left-sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setRightSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("agent-right-sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(leftSidebarWidth));
  }, [leftSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  const startColumnResize = useCallback((side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startLeftWidth = leftSidebarWidth;
    const startRightWidth = rightSidebarWidth;

    const move = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const availableWidth = window.innerWidth - MIN_CONVERSATION_WIDTH - RESIZE_HANDLE_WIDTH * 2;
      if (side === "left") {
        const maxWidth = Math.min(MAX_LEFT_SIDEBAR_WIDTH, Math.max(MIN_LEFT_SIDEBAR_WIDTH, availableWidth - startRightWidth));
        setLeftSidebarWidth(Math.min(Math.max(startLeftWidth + deltaX, MIN_LEFT_SIDEBAR_WIDTH), maxWidth));
      } else {
        const maxWidth = Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, availableWidth - startLeftWidth));
        setRightSidebarWidth(Math.min(Math.max(startRightWidth - deltaX, MIN_RIGHT_SIDEBAR_WIDTH), maxWidth));
      }
    };

    const stop = () => {
      document.body.classList.remove("resizing-columns");
      window.removeEventListener("pointermove", move);
    };

    document.body.classList.add("resizing-columns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }, [leftSidebarWidth, rightSidebarWidth]);

  return {
    leftSidebarWidth,
    rightSidebarWidth,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar,
    startColumnResize
  };
}
