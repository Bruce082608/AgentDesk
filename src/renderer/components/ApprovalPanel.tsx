import type { Language } from "../i18n";
import { Check, FileDiff, MessageSquareMore, Play, RotateCcw, ShieldCheck, Terminal, TriangleAlert, X } from "lucide-react";
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
      <div className="role approval-heading">
        <ShieldCheck size={14} strokeWidth={2.5} aria-hidden="true" />
        <span>{t.needsApproval}</span>
      </div>
      <div className="approval-thread">
        {activeQuestions.length > 0 && (
          <section className="patch-stack">
            <div className="panel-title icon-title">
              <MessageSquareMore size={13} strokeWidth={2.4} aria-hidden="true" />
              <span>{language === "zh" ? "Agent 提问" : "Agent Questions"}</span>
            </div>
            {activeQuestions.map((question) => (
              <div className="question-card" key={question.id}>
                {question.context && <div className="question-context">{question.context}</div>}
                <div className="question-text">
                  <MessageSquareMore size={15} strokeWidth={2.4} aria-hidden="true" />
                  <span>{question.question}</span>
                </div>
                <div className="patch-actions">
                  {question.options.map((option) => (
                    <button className="primary small question-option" key={option} disabled={busy} onClick={() => answerQuestion(question.id, option)}>{option}</button>
                  ))}
                  <button className="secondary small icon-text-button" disabled={busy} onClick={() => dismissQuestion(question.id)}>
                    <X size={13} strokeWidth={2.5} aria-hidden="true" />
                    <span>{t.dismiss}</span>
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
        {activePatches.length > 0 && (
          <section className="patch-stack">
            <div className="panel-title icon-title">
              <FileDiff size={13} strokeWidth={2.4} aria-hidden="true" />
              <span>{t.pendingChanges}</span>
            </div>
            {activePatches.map((patch) => (
              <details className={`patch-card ${patch.status}`} key={patch.id} open={patch.status === "pending" || patch.status === "failed"}>
                <summary>
                  <span className="approval-summary-main">
                    <FileDiff size={14} strokeWidth={2.4} aria-hidden="true" />
                    <span>{patch.summary}</span>
                  </span>
                  <small>{patch.status}</small>
                </summary>
                <pre>{patch.patch}</pre>
                {patch.error && <div className="patch-error">{patch.error}</div>}
                <div className="patch-actions">
                  <button className="primary small icon-text-button" disabled={busy || patch.status !== "pending"} onClick={() => applyPatch(patch.id)}>
                    <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                    <span>{t.apply}</span>
                  </button>
                  <button className="secondary small icon-text-button" disabled={busy || patch.status !== "pending"} onClick={() => discardPatch(patch.id)}>
                    <X size={13} strokeWidth={2.6} aria-hidden="true" />
                    <span>{t.discard}</span>
                  </button>
                </div>
              </details>
            ))}
          </section>
        )}
        {activeCommands.length > 0 && (
          <section className="patch-stack">
            <div className="panel-title command-title">
              <span className="icon-title">
                <Terminal size={13} strokeWidth={2.4} aria-hidden="true" />
                <span>{t.commandApprovals}</span>
              </span>
              {commandAutoApproval && (
                <button className="secondary tiny icon-text-button" onClick={resetCommandAutoApproval}>
                  <RotateCcw size={13} strokeWidth={2.4} aria-hidden="true" />
                  <span>{t.restoreConfirm}</span>
                </button>
              )}
            </div>
            {commandAutoApproval && (
              <div className="approval-banner">
                <ShieldCheck size={14} strokeWidth={2.5} aria-hidden="true" />
                <span>{t.autoApprovalBanner}</span>
              </div>
            )}
            {activeCommands.map((command) => (
              <details className={`patch-card command-card ${command.highRisk ? "high-risk" : ""} ${command.status}`} key={command.id} open={command.status === "pending" || command.status === "failed"}>
                <summary>
                  <span className="approval-summary-main">
                    {command.highRisk ? <TriangleAlert size={14} strokeWidth={2.5} aria-hidden="true" /> : <Terminal size={14} strokeWidth={2.4} aria-hidden="true" />}
                    <span>{command.command}</span>
                  </span>
                  <small>{command.highRisk ? `high / ${command.status}` : command.status}</small>
                </summary>
                <div className="patch-error">{command.error || command.reason}</div>
                <dl className="command-meta">
                  {command.cwd && (
                    <>
                      <dt>cwd</dt>
                      <dd>{command.cwd}</dd>
                    </>
                  )}
                  {command.shell && (
                    <>
                      <dt>{language === "zh" ? "Shell" : "Shell"}</dt>
                      <dd>{command.shell}</dd>
                    </>
                  )}
                  {command.timeoutMs && (
                    <>
                      <dt>{language === "zh" ? "超时" : "Timeout"}</dt>
                      <dd>{Math.round(command.timeoutMs / 1000)}s</dd>
                    </>
                  )}
                  <dt>{language === "zh" ? "环境变量" : "Env"}</dt>
                  <dd>{command.inheritedEnv === false ? (language === "zh" ? "不继承" : "Isolated") : (language === "zh" ? "继承应用环境" : "Inherited from app")}</dd>
                </dl>
                {command.result && <pre>{command.result}</pre>}
                <div className="patch-actions">
                  <button className="primary small icon-text-button" disabled={busy || command.status !== "pending"} onClick={() => approveCommand(command.id)}>
                    <Play size={13} strokeWidth={2.5} aria-hidden="true" />
                    <span>{t.execute}</span>
                  </button>
                  <button className="primary small allow-future icon-text-button" disabled={busy || command.status !== "pending"} onClick={() => approveCommand(command.id, true)}>
                    <ShieldCheck size={13} strokeWidth={2.5} aria-hidden="true" />
                    <span>{t.executeAllowFuture}</span>
                  </button>
                  <button className="secondary small icon-text-button" disabled={busy || command.status !== "pending"} onClick={() => discardCommand(command.id)}>
                    <X size={13} strokeWidth={2.6} aria-hidden="true" />
                    <span>{t.discard}</span>
                  </button>
                </div>
              </details>
            ))}
          </section>
        )}
      </div>
    </section>
  );
}
