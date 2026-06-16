import { memo, useEffect, useRef, useState } from "react";
import { ChevronRight, Clock3, Workflow } from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { ChatMessage } from "../../types";
import { ToolCallCard } from "./ToolCallCard";
import {
  formatDuration,
  formatMessageTimestamp,
  isToolResultError,
  toolStatusLabel
} from "./conversation-utils";

type Translation = typeof translations[keyof typeof translations];

export type WorkProcessCardProps = {
  tools: { message: ChatMessage; index: number }[];
  language: Language;
  t: Translation;
  toolDetailsMode: "default" | "expanded" | "collapsed";
  busy: boolean;
};

export const WorkProcessCard = memo(function WorkProcessCard({
  tools,
  language,
  t,
  toolDetailsMode,
  busy
}: WorkProcessCardProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const wasBusyRef = useRef(busy);
  const hasError = tools.some(({ message }) => message.toolStatus === "error" || isToolResultError(message.content));
  const effectiveStatus = hasError ? "error" : "completed";
  const totalDuration = tools.reduce((sum, { message }) => {
    if (typeof message.durationMs === "number") return sum + Math.max(0, message.durationMs);
    if (message.startedAt && message.endedAt) return sum + Math.max(0, message.endedAt - message.startedAt);
    return sum;
  }, 0);
  const durationLabel = formatDuration(totalDuration, language) || (language === "zh" ? "0s" : "0s");
  const isOpen = toolDetailsMode === "expanded"
    ? true
    : toolDetailsMode === "collapsed"
      ? false
      : localOpen;
  const statusLabel = toolStatusLabel(effectiveStatus, language);
  const titleText = language === "zh"
    ? `${hasError ? "已处理，部分失败" : "已处理"} ${durationLabel}`
    : `${hasError ? "Processed with issues" : "Processed"} in ${durationLabel}`;
  const detailText = language === "zh"
    ? `${tools.length} 个步骤`
    : `${tools.length} step${tools.length === 1 ? "" : "s"}`;

  useEffect(() => {
    if (wasBusyRef.current && !busy) {
      setLocalOpen(false);
    }
    wasBusyRef.current = busy;
  }, [busy]);

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    setLocalOpen(event.currentTarget.open);
  };

  return (
    <details className={`work-process-card ${effectiveStatus}`} open={isOpen} onToggle={handleToggle}>
      <summary>
        <span className="work-process-chevron" aria-hidden="true">
          <ChevronRight size={13} strokeWidth={2.6} />
        </span>
        <span className="work-process-copy">
          <span className="work-process-title">{titleText}</span>
          {isOpen && <span className="work-process-detail">{detailText}</span>}
        </span>
        {isOpen && (
          <>
            <span className={`work-process-icon ${effectiveStatus}`} aria-hidden="true">
              <Workflow size={14} strokeWidth={2.4} />
            </span>
            <span className="work-process-meta">
              <span className="work-process-duration">
                <Clock3 size={12} strokeWidth={2.4} aria-hidden="true" />
                {durationLabel}
              </span>
              <span className={`work-process-status ${effectiveStatus}`}>{statusLabel}</span>
            </span>
          </>
        )}
      </summary>
      <div className="work-process-details">
        {tools.map(({ message, index }) => (
          <ToolCallCard
            key={`${message.tool_call_id || message.name || "tool"}-${index}`}
            args={message.toolArgs || ""}
            copyLabel={t.copy}
            copiedLabel={t.copied}
            durationMs={message.durationMs}
            endedAt={message.endedAt}
            language={language}
            name={message.name || ""}
            result={message.content}
            startedAt={message.startedAt}
            status={message.toolStatus === "error" || isToolResultError(message.content) ? "error" : "completed"}
            title={formatMessageTimestamp(message.createdAt, language)}
            toolDetailsMode={toolDetailsMode === "expanded" ? "expanded" : "collapsed"}
          />
        ))}
      </div>
    </details>
  );
});
