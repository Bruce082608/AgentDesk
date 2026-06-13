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

  const updateCompressionStatus = useCallback((phase: "start" | "done" | "failed", message = "", summary = "") => {
    if (compressionStatusTimer.current) {
      window.clearTimeout(compressionStatusTimer.current);
      compressionStatusTimer.current = null;
    }
    setContextCompression((current) => ({
      phase,
      message: message || current.message,
      summary: summary || current.summary,
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

  return {
    contextCompressionStatus,
    setContextCompressionStatus,
    contextCompression,
    setContextCompression,
    updateCompressionStatus
  };
}
