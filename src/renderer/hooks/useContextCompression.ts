import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../i18n";
import type { ContextCompressionState } from "../types";

type UseContextCompressionParams = {
  language: Language;
};

export function useContextCompression({
  language
}: UseContextCompressionParams) {
  const [contextCompressionStatus, setContextCompressionStatus] = useState("");
  const [contextCompression, setContextCompression] = useState<ContextCompressionState>({ phase: "idle", message: "" });
  const compressionStatusTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (compressionStatusTimer.current) {
        window.clearTimeout(compressionStatusTimer.current);
      }
    };
  }, []);

  const updateCompressionStatus = useCallback((
    phase: "start" | "done" | "failed",
    message = "",
    summary = "",
    effectiveTokenCount?: number,
    inputBudgetTokens?: number
  ) => {
    if (compressionStatusTimer.current) {
      window.clearTimeout(compressionStatusTimer.current);
      compressionStatusTimer.current = null;
    }
    setContextCompression((current) => ({
      phase,
      message: message || current.message,
      summary: summary || current.summary,
      effectiveTokenCount: phase === "done" && Number.isFinite(effectiveTokenCount) ? effectiveTokenCount : undefined,
      inputBudgetTokens: Number.isFinite(inputBudgetTokens) ? inputBudgetTokens : undefined,
      updatedAt: Date.now()
    }));
    if (phase === "start") {
      setContextCompressionStatus(language === "zh" ? "正在自动压缩上下文" : "Auto-compressing context");
      return;
    }
    setContextCompressionStatus(
      phase === "failed"
        ? (language === "zh" ? "上下文压缩失败，已使用滑动窗口" : "Context compression failed; using recent history")
        : (language === "zh" ? "上下文压缩完成" : "Context compression complete")
    );
    compressionStatusTimer.current = window.setTimeout(() => setContextCompressionStatus(""), 3000);
  }, [language]);

  const resetContextCompression = useCallback(() => {
    if (compressionStatusTimer.current) {
      window.clearTimeout(compressionStatusTimer.current);
      compressionStatusTimer.current = null;
    }
    setContextCompressionStatus("");
    setContextCompression({ phase: "idle", message: "" });
  }, []);

  return {
    contextCompressionStatus,
    setContextCompressionStatus,
    contextCompression,
    setContextCompression,
    resetContextCompression,
    updateCompressionStatus
  };
}
