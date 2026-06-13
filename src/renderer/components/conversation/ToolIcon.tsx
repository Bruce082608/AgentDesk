import {
  Files,
  FileText,
  Search,
  Terminal,
  Workflow,
  FileDiff,
  PenLine,
  MessageSquareMore,
  ListTodo,
  ClipboardPaste,
  Bell,
  Clock3
} from "lucide-react";

export function ToolIcon({ name }: { name: string }) {
  const normalized = String(name || "").toLowerCase();
  const props = { size: 15, strokeWidth: 2.35, "aria-hidden": true as const };
  if (normalized === "list_files" || normalized === "workspace_map") return <Files {...props} />;
  if (normalized === "read_file" || normalized === "read_files" || normalized === "read_file_range" || normalized === "read_result_chunk") return <FileText {...props} />;
  if (normalized === "search_files" || normalized === "web_search") return <Search {...props} />;
  if (normalized === "run_command" || normalized === "start_command" || normalized === "read_command_output" || normalized === "stop_command") return <Terminal {...props} />;
  if (normalized === "browser_page") return <Workflow {...props} />;
  if (normalized === "apply_patch") return <FileDiff {...props} />;
  if (normalized === "write_file" || normalized === "delete_file" || normalized === "replace_text") return <PenLine {...props} />;
  if (normalized === "ask_user") return <MessageSquareMore {...props} />;
  if (normalized === "update_plan") return <ListTodo {...props} />;
  if (normalized === "system_clipboard") return <ClipboardPaste {...props} />;
  if (normalized === "system_notify") return <Bell {...props} />;
  if (normalized === "background_task") return <Clock3 {...props} />;
  if (normalized === "system_window_info") return <Workflow {...props} />;
  return <Workflow {...props} />;
}
