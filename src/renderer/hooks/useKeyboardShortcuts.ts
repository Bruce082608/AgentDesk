import { useEffect } from "react";

type KeyboardShortcutsProps = {
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
};

export function useKeyboardShortcuts({
  toggleLeftSidebar,
  toggleRightSidebar
}: KeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleLeftSidebar();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleRightSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleLeftSidebar, toggleRightSidebar]);
}
