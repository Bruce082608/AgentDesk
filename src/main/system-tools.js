import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { handleBackgroundTaskTool } from "./background-tasks.js";

const execFileAsync = promisify(execFile);
const MAX_CLIPBOARD_TEXT = 500_000;

let runtime = {
  notify: null,
  getDesktopState: null
};

export function configureSystemToolRuntime(options = {}) {
  runtime = {
    notify: typeof options.notify === "function" ? options.notify : runtime.notify,
    getDesktopState: typeof options.getDesktopState === "function" ? options.getDesktopState : runtime.getDesktopState
  };
}

export async function executeSystemTool(name, args, context) {
  switch (name) {
    case "system_clipboard":
      return systemClipboard(args);
    case "system_window_info":
      return systemWindowInfo();
    case "system_notify":
      return systemNotify(args);
    case "background_task":
      return handleBackgroundTaskTool(args, context);
    default:
      return null;
  }
}

export function isSystemTool(name) {
  return ["system_clipboard", "system_window_info", "system_notify", "background_task"].includes(name);
}

async function systemClipboard(args = {}) {
  const action = String(args.action || "read_text").trim();
  const { clipboard } = await getElectronRuntime();
  if (!clipboard) {
    return JSON.stringify({
      ok: false,
      error: "Electron clipboard is unavailable in this runtime."
    }, null, 2);
  }

  if (action === "read_text") {
    const text = clipboard.readText();
    return JSON.stringify({
      ok: true,
      action,
      text: text.slice(0, MAX_CLIPBOARD_TEXT),
      truncated: text.length > MAX_CLIPBOARD_TEXT,
      chars: text.length
    }, null, 2);
  }

  if (action === "write_text") {
    const text = String(args.text ?? "");
    if (text.length > MAX_CLIPBOARD_TEXT) {
      throw new Error(`Clipboard text is too large. Limit is ${MAX_CLIPBOARD_TEXT} characters.`);
    }
    clipboard.writeText(text);
    return JSON.stringify({ ok: true, action, chars: text.length }, null, 2);
  }

  if (action === "clear") {
    clipboard.clear();
    return JSON.stringify({ ok: true, action }, null, 2);
  }

  throw new Error("system_clipboard action must be one of: read_text, write_text, clear.");
}

async function systemWindowInfo() {
  const electron = await getElectronRuntime();
  const windows = typeof electron.BrowserWindow?.getAllWindows === "function"
    ? electron.BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      title: window.getTitle(),
      visible: window.isVisible(),
      focused: window.isFocused(),
      minimized: window.isMinimized(),
      bounds: window.getBounds()
    }))
    : [];
  const cursor = typeof electron.screen?.getCursorScreenPoint === "function"
    ? electron.screen.getCursorScreenPoint()
    : null;
  const display = cursor && typeof electron.screen?.getDisplayNearestPoint === "function"
    ? summarizeDisplay(electron.screen.getDisplayNearestPoint(cursor))
    : null;
  const desktopState = typeof runtime.getDesktopState === "function" ? runtime.getDesktopState() : null;
  const foregroundWindow = await getForegroundWindowInfo();

  return JSON.stringify({
    ok: true,
    platform: process.platform,
    desktopState,
    cursor,
    display,
    agentWindows: windows,
    foregroundWindow,
    limitations: foregroundWindow?.limited
      ? "Foreground window details can require Accessibility permission on macOS or helper tools on Linux."
      : ""
  }, null, 2);
}

async function systemNotify(args = {}) {
  const title = String(args.title || "AgentDesk").trim() || "AgentDesk";
  const body = String(args.body || "").trim();
  const silent = Boolean(args.silent);
  if (runtime.notify) {
    return JSON.stringify(runtime.notify({ title, body, silent }), null, 2);
  }
  const { Notification } = await getElectronRuntime();
  if (!Notification?.isSupported?.()) {
    return JSON.stringify({ ok: false, reason: "Notifications are not supported on this platform/runtime." }, null, 2);
  }
  const notification = new Notification({ title, body, silent });
  notification.show();
  return JSON.stringify({ ok: true, title, body }, null, 2);
}

async function getForegroundWindowInfo() {
  if (process.platform === "win32") return getWindowsForegroundWindow();
  if (process.platform === "darwin") return getMacForegroundWindow();
  if (process.platform === "linux") return getLinuxForegroundWindow();
  return { limited: true, reason: `Unsupported platform: ${process.platform}` };
}

async function getWindowsForegroundWindow() {
  const script = [
    "Add-Type @\"",
    "using System;",
    "using System.Text;",
    "using System.Runtime.InteropServices;",
    "public class AgentDeskWin32 {",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "}",
    "\"@",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$handle = [AgentDeskWin32]::GetForegroundWindow()",
    "$titleBuilder = New-Object Text.StringBuilder 512",
    "[AgentDeskWin32]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity) | Out-Null",
    "$windowProcessId = 0",
    "[AgentDeskWin32]::GetWindowThreadProcessId($handle, [ref]$windowProcessId) | Out-Null",
    "$process = Get-Process -Id $windowProcessId -ErrorAction SilentlyContinue",
    "@{ title = $titleBuilder.ToString(); processId = $windowProcessId; processName = $process.ProcessName } | ConvertTo-Json -Compress"
  ].join("\n");
  return parseJsonCommand("powershell.exe", ["-NoProfile", "-Command", script]);
}

async function getMacForegroundWindow() {
  const script = [
    "tell application \"System Events\"",
    "  set frontApp to first application process whose frontmost is true",
    "  set appName to name of frontApp",
    "  set windowTitle to \"\"",
    "  try",
    "    if exists window 1 of frontApp then set windowTitle to name of window 1 of frontApp",
    "  end try",
    "  return appName & linefeed & windowTitle",
    "end tell"
  ].join("\n");
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 3000, windowsHide: true });
    const [processName = "", title = ""] = stdout.trimEnd().split(/\r?\n/);
    return { processName, title };
  } catch (error) {
    return {
      limited: true,
      reason: "macOS did not allow foreground window inspection.",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function getLinuxForegroundWindow() {
  try {
    const { stdout } = await execFileAsync("sh", ["-lc", "xdotool getactivewindow getwindowname getwindowpid 2>/dev/null"], {
      timeout: 3000,
      windowsHide: true
    });
    const [title = "", processId = ""] = stdout.trimEnd().split(/\r?\n/);
    return { title, processId: Number(processId) || 0 };
  } catch (error) {
    return {
      limited: true,
      reason: "Install xdotool or add a platform helper to inspect the active Linux window.",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function parseJsonCommand(file, args) {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 3000, windowsHide: true });
    return JSON.parse(stdout);
  } catch (error) {
    return {
      limited: true,
      reason: "Foreground window inspection failed.",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function getElectronRuntime() {
  const imported = await import("electron");
  const fallback = imported.default && typeof imported.default === "object" ? imported.default : {};
  return {
    app: imported.app ?? fallback.app,
    BrowserWindow: imported.BrowserWindow ?? fallback.BrowserWindow,
    clipboard: imported.clipboard ?? fallback.clipboard,
    Notification: imported.Notification ?? fallback.Notification,
    screen: imported.screen ?? fallback.screen
  };
}

function summarizeDisplay(display) {
  if (!display) return null;
  return {
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    touchSupport: display.touchSupport
  };
}
