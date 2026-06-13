import { memo, useState } from "react";
import { Clock3 } from "lucide-react";
import type { Language } from "../../i18n";
import { CodeBlock } from "../../utils";
import { ToolIcon } from "./ToolIcon";
import {
  parseToolPayload,
  stringValue,
  summarizeToolCall,
  formatToolCardPayload,
  toolStatusLabel,
  toolActionLabel,
  formatDuration,
  type ToolCardStatus
} from "./conversation-utils";

export type ToolCallCardProps = {
  args?: string;
  copiedLabel: string;
  copyLabel: string;
  durationMs?: number;
  endedAt?: number;
  language: Language;
  name: string;
  result?: string;
  startedAt?: number;
  status: ToolCardStatus;
  title?: string;
  toolDetailsMode?: "default" | "expanded" | "collapsed";
};

export const ToolCallCard = memo(function ToolCallCard({
  args,
  copiedLabel,
  copyLabel,
  durationMs,
  endedAt,
  language,
  name,
  result,
  startedAt,
  status,
  title,
  toolDetailsMode = "default"
}: ToolCallCardProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const parsedResult = parseToolPayload(result);
  const displayName = name || stringValue(parsedResult?.tool) || "tool";
  const effectiveStatus = status === "completed" && parsedResult?.ok === false ? "error" : status;
  const summary = summarizeToolCall(displayName, args, result, effectiveStatus, language);
  const argsCode = formatToolCardPayload(args);
  const resultCode = formatToolCardPayload(result);
  const statusLabel = toolStatusLabel(effectiveStatus, language);
  const actionLabel = toolActionLabel(displayName, language);
  const measuredDuration = durationMs ?? (startedAt && endedAt ? Math.max(0, endedAt - startedAt) : undefined);
  const durationLabel = formatDuration(measuredDuration, language);

  const isOpen = toolDetailsMode === "expanded"
    ? true
    : toolDetailsMode === "collapsed"
      ? false
      : (localOpen || effectiveStatus === "running" || effectiveStatus === "error");

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    setLocalOpen(e.currentTarget.open);
  };

  return (
    <details className={`tool-call-card ${effectiveStatus}`} open={isOpen} onToggle={handleToggle} title={title}>
      <summary>
        <span className={`tool-call-icon ${effectiveStatus}`} aria-hidden="true">
          <ToolIcon name={displayName} />
        </span>
        <span className="tool-call-copy">
          <span className="tool-call-name">{actionLabel}</span>
          <span className="tool-call-summary">{summary}</span>
        </span>
        <span className="tool-call-meta">
          {durationLabel && (
            <span className="tool-call-duration">
              <Clock3 size={12} strokeWidth={2.4} aria-hidden="true" />
              {durationLabel}
            </span>
          )}
          <span className={`tool-call-status ${effectiveStatus}`}>{statusLabel}</span>
        </span>
      </summary>
      <div className="tool-call-details">
        {argsCode && (
          <div className="tool-call-section">
            <div className="tool-call-section-title">{language === "zh" ? "参数" : "Args"}</div>
            <CodeBlock code={argsCode} language="json" copyLabel={copyLabel} copiedLabel={copiedLabel} />
          </div>
        )}
        {resultCode && (
          <div className="tool-call-section">
            <div className="tool-call-section-title">{effectiveStatus === "error" ? (language === "zh" ? "错误" : "Error") : (language === "zh" ? "结果" : "Result")}</div>
            <CodeBlock code={resultCode} language="json" copyLabel={copyLabel} copiedLabel={copiedLabel} />
          </div>
        )}
      </div>
    </details>
  );
});
