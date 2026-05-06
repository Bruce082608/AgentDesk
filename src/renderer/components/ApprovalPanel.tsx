import type { Language } from "../i18n";
import { translations } from "../i18n";
import type { CommandItem, PatchItem, UserQuestionItem } from "../types";

type Translation = typeof translations[keyof typeof translations];

type ApprovalPanelProps = {
  activeCommands: CommandItem[];
  activePatches: PatchItem[];
  activeQuestions: UserQuestionItem[];
  approveCommand: (commandId: string, allowFuture?: boolean) => void;
  applyPatch: (patchId: string) => void;
  busy: boolean;
  commandAutoApproval: boolean;
  discardCommand: (commandId: string) => void;
  discardPatch: (patchId: string) => void;
  dismissQuestion: (questionId: string) => void;
  answerQuestion: (questionId: string, option: string) => void;
  language: Language;
  resetCommandAutoApproval: () => void;
  t: Translation;
};

export function ApprovalPanel({
  activeCommands,
  activePatches,
  activeQuestions,
  answerQuestion,
  approveCommand,
  applyPatch,
  busy,
  commandAutoApproval,
  discardCommand,
  discardPatch,
  dismissQuestion,
  language,
  resetCommandAutoApproval,
  t
}: ApprovalPanelProps) {
  if (activePatches.length === 0 && activeCommands.length === 0 && activeQuestions.length === 0) return null;

  return (
    <section className="conversation-approvals" aria-live="polite">
      <div className="role">{t.needsApproval}</div>
      <div className="approval-thread">
        {activeQuestions.length > 0 && (
          <section className="patch-stack">
            <div className="panel-title">{language === "zh" ? "Agent 提问" : "Agent Questions"}</div>
            {activeQuestions.map((question) => (
              <div className="question-card" key={question.id}>
                {question.context && <div className="question-context">{question.context}</div>}
                <div className="question-text">{question.question}</div>
                <div className="patch-actions">
                  {question.options.map((option) => (
                    <button className="primary small question-option" key={option} disabled={busy} onClick={() => answerQuestion(question.id, option)}>{option}</button>
                  ))}
                  <button className="secondary small" onClick={() => dismissQuestion(question.id)}>{t.dismiss}</button>
                </div>
              </div>
            ))}
          </section>
        )}
        {activePatches.length > 0 && (
          <section className="patch-stack">
            <div className="panel-title">{t.pendingChanges}</div>
            {activePatches.map((patch) => (
              <details className={`patch-card ${patch.status}`} key={patch.id} open={patch.status === "pending" || patch.status === "failed"}>
                <summary>
                  <span>{patch.summary}</span>
                  <small>{patch.status}</small>
                </summary>
                <pre>{patch.patch}</pre>
                {patch.error && <div className="patch-error">{patch.error}</div>}
                <div className="patch-actions">
                  <button className="primary small" disabled={patch.status !== "pending"} onClick={() => applyPatch(patch.id)}>{t.apply}</button>
                  <button className="secondary small" disabled={patch.status !== "pending"} onClick={() => discardPatch(patch.id)}>{t.discard}</button>
                </div>
              </details>
            ))}
          </section>
        )}
        {activeCommands.length > 0 && (
          <section className="patch-stack">
            <div className="panel-title command-title">
              <span>{t.commandApprovals}</span>
              {commandAutoApproval && <button className="secondary tiny" onClick={resetCommandAutoApproval}>{t.restoreConfirm}</button>}
            </div>
            {commandAutoApproval && <div className="approval-banner">{t.autoApprovalBanner}</div>}
            {activeCommands.map((command) => (
              <details className={`patch-card command-card ${command.highRisk ? "high-risk" : ""} ${command.status}`} key={command.id} open={command.status === "pending" || command.status === "failed"}>
                <summary>
                  <span>{command.command}</span>
                  <small>{command.highRisk ? `high / ${command.status}` : command.status}</small>
                </summary>
                <div className="patch-error">{command.error || command.reason}</div>
                {command.result && <pre>{command.result}</pre>}
                <div className="patch-actions">
                  <button className="primary small" disabled={command.status !== "pending"} onClick={() => approveCommand(command.id)}>{t.execute}</button>
                  <button className="primary small allow-future" disabled={command.status !== "pending"} onClick={() => approveCommand(command.id, true)}>{t.executeAllowFuture}</button>
                  <button className="secondary small" disabled={command.status !== "pending"} onClick={() => discardCommand(command.id)}>{t.discard}</button>
                </div>
              </details>
            ))}
          </section>
        )}
      </div>
    </section>
  );
}
