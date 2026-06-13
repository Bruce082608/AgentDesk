import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(composerHeight));
  }, [composerHeight]);

  const startComposerResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = composerHeight;

    const move = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxHeight = Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, window.innerHeight - 220));
      setComposerHeight(Math.min(Math.max(startHeight + deltaY, MIN_COMPOSER_HEIGHT), maxHeight));
    };

    const stop = () => {
      document.body.classList.remove("resizing-rows");
      window.removeEventListener("pointermove", move);
    };

    document.body.classList.add("resizing-rows");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }, [composerHeight]);

  return {
    composerHeight,
    startComposerResize
  };
}
