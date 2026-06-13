import { useCallback, useEffect, useState, useRef } from "react";
import {
  COMPOSER_HEIGHT_KEY,
  MIN_COMPOSER_HEIGHT,
  MAX_COMPOSER_HEIGHT
} from "../types";
import { readStoredNumber } from "../utils";

export function useComposerResize() {
  const [composerHeight, setComposerHeight] = useState(() =>
    readStoredNumber(COMPOSER_HEIGHT_KEY, 78, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT)
  );

  const heightRef = useRef(composerHeight);
  heightRef.current = composerHeight;

  useEffect(() => {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(composerHeight));
  }, [composerHeight]);

  const startComposerResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = heightRef.current;
    let currentHeight = startHeight;

    const move = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxHeight = Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, window.innerHeight - 220));
      currentHeight = Math.min(Math.max(startHeight + deltaY, MIN_COMPOSER_HEIGHT), maxHeight);
      
      // Update DOM directly for lag-free resizing performance
      const composerEl = document.querySelector(".composer") as HTMLElement;
      if (composerEl) {
        composerEl.style.height = `${currentHeight + 30}px`;
      }
    };

    const stop = () => {
      document.body.classList.remove("resizing-rows");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      
      // Commit the final height to React state once resizing stops
      setComposerHeight(currentHeight);
    };

    document.body.classList.add("resizing-rows");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }, []); // Stable callback dependency

  return {
    composerHeight,
    startComposerResize
  };
}
