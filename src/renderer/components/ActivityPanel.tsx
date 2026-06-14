import { memo } from "react";
import type { RefObject } from "react";
import { Activity, ArrowDown, CheckCircle2, Clock3, ListTodo, LoaderCircle, MessageSquareMore, ShieldCheck, TriangleAlert, Workflow, Search, X } from "lucide-react";
import type { Language, translations } from "../i18n";
import type { ActivityFilter, EventLogItem, PlanItem, RightSidebarSection, ToolRun } from "../types";

type Translation = typeof translations[keyof typeof translations];

type ActivityPanelProps = {
  activityFilter: ActivityFilter;
  activityListRef: RefObject<HTMLDivElement | null>;
  activitySearch: string;
  events: EventLogItem[];
  filteredEvents: EventLogItem[];
  language: Language;
  planItems: PlanItem[];
  rightSidebarSection: RightSidebarSection;
  setActivityFilter: (filter: ActivityFilter) => void;
  setActivitySearch: (search: string) => void;
  setRightSidebarSection: (section: RightSidebarSection) => void;
  showActivityScrollToBottom: boolean;
  scrollActivityToBottom: () => void;
  t: Translation;
  activeToolRuns: ToolRun[];
};

export const ActivityPanel = memo(function ActivityPanel({
  activityFilter,
  activityListRef,
  activitySearch,
  events,
  filteredEvents,
  language,
  planItems,
  rightSidebarSection,
  setActivityFilter,
  setActivitySearch,
  setRightSidebarSection,
  showActivityScrollToBottom,
  scrollActivityToBottom,
  t,
  activeToolRuns
}: ActivityPanelProps) {
  return (
    <aside className="activity">
      <nav className="right-tabs" aria-label={language === "zh" ? "右侧栏页面" : "Right sidebar sections"}>
        <button className={rightSidebarSection === "plan" ? "active" : ""} onClick={() => setRightSidebarSection("plan")} title={t.plan} aria-label={t.plan}>
          <ListTodo size={15} strokeWidth={2.4} aria-hidden="true" />
          <span>{t.plan}</span>
        </button>
        <button className={rightSidebarSection === "activity" ? "active" : ""} onClick={() => setRightSidebarSection("activity")} title={t.activity} aria-label={t.activity}>
          <Activity size={15} strokeWidth={2.4} aria-hidden="true" />
          <span>{t.activity}</span>
        </button>
      </nav>

      {rightSidebarSection === "plan" && (
        <div className="right-panel plan-panel">
          {planItems.length === 0 && <div className="muted">{t.planEmpty}</div>}
          {planItems.length > 0 && (
            <ol className="plan-list">
              {planItems.map((item, index) => (
                <li className={`plan-row ${item.status}`} key={`${item.step}-${index}`}>
                  <span className="plan-check"><PlanStatusIcon status={item.status} /></span>
                  <div className="plan-content">
                    <span className="plan-step-text">{item.step}</span>
                    {item.status === "in_progress" && activeToolRuns.length > 0 && (
                      <div className="plan-active-tool">
                        <span className="pulse-dot" />
                        <span className="tool-name">
                          {language === "zh" ? "正在执行: " : "Executing: "}
                          <code>{activeToolRuns[0].name}</code>
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {rightSidebarSection === "activity" && (
        <>
          <div className="activity-controls">
            <div className="activity-filter-tabs" role="tablist" aria-label={t.activity}>
              {([
                ["all", t.activityFilterAll],
                ["tool", t.activityFilterTool],
                ["error", t.activityFilterError],
                ["approval", t.activityFilterApproval],
                ["system", t.activityFilterSystem]
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={activityFilter === value ? "active" : ""}
                  type="button"
                  onClick={() => setActivityFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="activity-search-container">
              <Search className="search-icon" size={14} strokeWidth={2.5} aria-hidden="true" />
              <input
                value={activitySearch}
                onChange={(event) => setActivitySearch(event.target.value)}
                placeholder={t.activitySearchPlaceholder}
              />
              {activitySearch && (
                <button
                  className="clear-button"
                  type="button"
                  onClick={() => setActivitySearch("")}
                  title={language === "zh" ? "清空搜索" : "Clear search"}
                  aria-label={language === "zh" ? "清空搜索" : "Clear search"}
                >
                  <X size={14} strokeWidth={2.5} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <div className="event-list" ref={activityListRef}>
            {filteredEvents.length === 0 && <div className="muted">{events.length === 0 ? t.activityEmpty : t.activitySearchPlaceholder}</div>}
            {filteredEvents.map((event) => (
              <details className={`event ${event.kind}`} key={event.id} open={event.kind === "error"} title={formatEventTimestamp(event.createdAt, language)}>
                <summary>
                  <span className="event-summary-main">
                    <EventKindIcon kind={event.kind} />
                    <span>{event.title}</span>
                  </span>
                  <small>{formatEventTime(event.createdAt, language)}</small>
                </summary>
                <pre>{event.body}</pre>
              </details>
            ))}
          </div>
          {showActivityScrollToBottom && (
            <button
              className="scroll-to-bottom activity-scroll-to-bottom"
              type="button"
              onClick={scrollActivityToBottom}
              title={language === "zh" ? "滚动到底部" : "Scroll to bottom"}
              aria-label={language === "zh" ? "滚动到底部" : "Scroll to bottom"}
            >
              <ArrowDown size={17} strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </aside>
  );
});

function PlanStatusIcon({ status }: { status: PlanItem["status"] }) {
  if (status === "completed") return <CheckCircle2 size={15} strokeWidth={2.5} aria-hidden="true" />;
  if (status === "in_progress") return <LoaderCircle className="status-icon spin" size={15} strokeWidth={2.5} aria-hidden="true" />;
  return <Clock3 size={15} strokeWidth={2.4} aria-hidden="true" />;
}

function EventKindIcon({ kind }: { kind: EventLogItem["kind"] }) {
  if (kind === "error") return <TriangleAlert size={14} strokeWidth={2.5} aria-hidden="true" />;
  if (kind === "patch") return <ShieldCheck size={14} strokeWidth={2.5} aria-hidden="true" />;
  if (kind === "tool") return <Workflow size={14} strokeWidth={2.5} aria-hidden="true" />;
  if (kind === "model") return <MessageSquareMore size={14} strokeWidth={2.5} aria-hidden="true" />;
  return <Activity size={14} strokeWidth={2.5} aria-hidden="true" />;
}

function formatEventTime(timestamp: number | undefined, language: Language) {
  if (!timestamp) return "--:--";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);
}

function formatEventTimestamp(timestamp: number | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "未记录时间" : "Timestamp not recorded";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(timestamp);
}
