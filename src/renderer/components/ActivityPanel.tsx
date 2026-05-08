import type { RefObject } from "react";
import type { Language, translations } from "../i18n";
import type { ActivityFilter, EventLogItem, PlanItem, RightSidebarSection } from "../types";

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
};

export function ActivityPanel({
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
  t
}: ActivityPanelProps) {
  return (
    <aside className="activity">
      <nav className="right-tabs" aria-label={language === "zh" ? "右侧栏页面" : "Right sidebar sections"}>
        <button className={rightSidebarSection === "plan" ? "active" : ""} onClick={() => setRightSidebarSection("plan")}>{t.plan}</button>
        <button className={rightSidebarSection === "activity" ? "active" : ""} onClick={() => setRightSidebarSection("activity")}>{t.activity}</button>
      </nav>

      {rightSidebarSection === "plan" && (
        <div className="right-panel plan-panel">
          {planItems.length === 0 && <div className="muted">{t.planEmpty}</div>}
          {planItems.length > 0 && (
            <ol className="plan-list">
              {planItems.map((item, index) => (
                <li className={`plan-row ${item.status}`} key={`${item.step}-${index}`}>
                  <span className="plan-check">{item.status === "completed" ? "✓" : item.status === "in_progress" ? "•" : ""}</span>
                  <span>{item.step}</span>
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
            <input
              value={activitySearch}
              onChange={(event) => setActivitySearch(event.target.value)}
              placeholder={t.activitySearchPlaceholder}
            />
          </div>
          <div className="event-list" ref={activityListRef}>
            {filteredEvents.length === 0 && <div className="muted">{events.length === 0 ? t.activityEmpty : t.activitySearchPlaceholder}</div>}
            {filteredEvents.map((event) => (
              <details className={`event ${event.kind}`} key={event.id} open={event.kind === "error"} title={formatEventTimestamp(event.createdAt, language)}>
                <summary>{event.title}</summary>
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
              ↓
            </button>
          )}
        </>
      )}
    </aside>
  );
}

function formatEventTimestamp(timestamp: number | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "未记录时间" : "Timestamp not recorded";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(timestamp);
}
