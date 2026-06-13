import { memo, useState } from "react";
import { Clock3, Workflow } from "lucide-react";
import type { Language, translations } from "../../i18n";
import type { ChatMessage } from "../../types";
import { ToolCallCard } from "./ToolCallCard";
import {
  isToolResultError,
  toolActionLabel,
  formatDuration,
  toolStatusLabel,
  formatMessageTimestamp
} from "./conversation-utils";

type Translation = typeof translations[keyof typeof translations];

export type ToolCallGroupCardProps = {
  name: string;
  tools: { message: ChatMessage; index: number }[];
  language: Language;
  t: Translation;
  toolDetailsMode: "default" | "expanded" | "collapsed";
  copyMessage: (message: ChatMessage) => void;
  busy: boolean;
  regenerateMessage: (index: number) => void;
};

export const ToolCallGroupCard = memo(function ToolCallGroupCard({
  name,
  tools,
  language,
  t,
  toolDetailsMode,
  copyMessage,
  busy,
  regenerateMessage
}: ToolCallGroupCardProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const hasError = tools.some(t => t.message.toolStatus === "error" || isToolResultError(t.message.content));
  const effectiveStatus = hasError ? "error" : "completed";
  const actionLabel = toolActionLabel(name, language);
  const count = tools.length;
  
  const totalDuration = tools.reduce((sum, item) => sum + (item.message.durationMs || 0), 0);
  const durationLabel = formatDuration(totalDuration, language);

  const isOpen = toolDetailsMode === "expanded"
    ? true
    : toolDetailsMode === "collapsed"
      ? false
      : localOpen;

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    setLocalOpen(e.currentTarget.open);
  };

  const titleText = language === "zh"
    ? `批量执行 ${actionLabel} (${count}次)`
    : `Batch ${actionLabel} (${count} times)`;

  return (
    <details 
      className={`tool-call-card group ${effectiveStatus}`} 
      open={isOpen} 
      onToggle={handleToggle}
    >
      <summary>
        <span className={`tool-call-icon ${effectiveStatus}`} aria-hidden="true">
          <Workflow size={15} strokeWidth={2.35} />
        </span>
        <span className="tool-call-copy">
          <span className="tool-call-name">{titleText}</span>
          <span className="tool-call-summary">
            {language === "zh" ? `连续执行了 ${count} 次` : `Executed consecutively ${count} times`}
          </span>
        </span>
        <span className="tool-call-meta">
          {durationLabel && (
            <span className="tool-call-duration">
              <Clock3 size={12} strokeWidth={2.4} aria-hidden="true" />
              {durationLabel}
            </span>
          )}
          <span className={`tool-call-status ${effectiveStatus}`}>
            {toolStatusLabel(effectiveStatus, language)}
          </span>
        </span>
      </summary>
      <div className="tool-call-details group-items" style={{ paddingLeft: "10px", borderLeft: "2px solid var(--border-light)", marginLeft: "10px", marginTop: "10px" }}>
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
            toolDetailsMode={toolDetailsMode === "expanded" ? "expanded" : "default"}
          />
        ))}
      </div>
    </details>
  );
});
