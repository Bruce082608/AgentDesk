import { useEffect, useState } from "react";
import { THEME_KEY, type ThemeMode } from "../types";

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light" || saved === "system") {
      return saved;
    }
    return "light";
  });

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);

    if (theme !== "system") {
      document.body.dataset.theme = theme;
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = () => {
      document.body.dataset.theme = mediaQuery.matches ? "dark" : "light";
    };
    applySystemTheme();

    mediaQuery.addEventListener("change", applySystemTheme);
    return () => mediaQuery.removeEventListener("change", applySystemTheme);
  }, [theme]);

  return {
    theme,
    setTheme
  };
}
