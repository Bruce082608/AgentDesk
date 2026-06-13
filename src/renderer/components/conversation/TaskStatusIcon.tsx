import {
  Files,
  PenLine,
  ShieldCheck,
  Terminal,
  CheckCircle2,
  TriangleAlert,
  LoaderCircle
} from "lucide-react";
import type { TaskStatus } from "../../types";

export function TaskStatusIcon({ phase }: { phase: TaskStatus["phase"] }) {
  if (phase === "searching") return <Files size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "editing") return <PenLine size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "waiting") return <ShieldCheck size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "running") return <Terminal size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "completed") return <CheckCircle2 size={16} strokeWidth={2.4} aria-hidden="true" />;
  if (phase === "error") return <TriangleAlert size={16} strokeWidth={2.4} aria-hidden="true" />;
  return <LoaderCircle className="status-icon spin" size={16} strokeWidth={2.4} aria-hidden="true" />;
}
