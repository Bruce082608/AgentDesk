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
              <details className={`event ${event.kind}`} key={event.id} open={event.kind === "error"}>
                <summary>{event.title}</summary>
                <pre>{event.body}</pre>
              </details>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
