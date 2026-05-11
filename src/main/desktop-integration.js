import { app, globalShortcut, Menu, nativeImage, Notification, Tray } from "electron";
import { deflateSync } from "node:zlib";

const DEFAULT_TOGGLE_SHORTCUT = "CommandOrControl+Shift+Space";

let tray = null;
let isQuitting = false;
let shortcutRegistered = false;
let shortcutAccelerator = DEFAULT_TOGGLE_SHORTCUT;
let getMainWindowRef = () => null;
let createWindowRef = () => null;
let getActiveRequestCountRef = () => 0;

export function setupDesktopIntegration({
  getMainWindow,
  createWindow,
  getActiveRequestCount,
  accelerator = DEFAULT_TOGGLE_SHORTCUT
} = {}) {
  getMainWindowRef = typeof getMainWindow === "function" ? getMainWindow : getMainWindowRef;
  createWindowRef = typeof createWindow === "function" ? createWindow : createWindowRef;
  getActiveRequestCountRef = typeof getActiveRequestCount === "function" ? getActiveRequestCount : getActiveRequestCountRef;
  shortcutAccelerator = String(accelerator || DEFAULT_TOGGLE_SHORTCUT);

  createTray();
  registerGlobalShortcut();

  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("will-quit", () => {
    globalShortcut.unregister(shortcutAccelerator);
    shortcutRegistered = false;
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  return getDesktopIntegrationState();
}

export function shouldHideToTrayOnClose() {
  return Boolean(tray) && !isQuitting;
}

export function keepsAppRunningInBackground() {
  return Boolean(tray) && !isQuitting;
}

export function showMainWindow() {
  let window = getMainWindowRef();
  if (!window || window.isDestroyed()) {
    window = createWindowRef();
  }
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}

export function toggleMainWindow() {
  const window = getMainWindowRef();
  if (window && !window.isDestroyed() && window.isVisible() && window.isFocused()) {
    window.hide();
    return { ok: true, visible: false };
  }
  const shown = showMainWindow();
  return { ok: shown, visible: shown };
}

export function quitFromTray() {
  isQuitting = true;
  app.quit();
}

export function refreshDesktopIntegrationState() {
  updateTrayMenu();
}

export function showDesktopNotification({ title, body = "", silent = false } = {}) {
  const safeTitle = truncateText(title || "AgentDesk", 120);
  const safeBody = truncateText(body || "", 2000);
  if (!Notification.isSupported()) {
    return { ok: false, reason: "Notifications are not supported on this platform/runtime." };
  }
  const notification = new Notification({
    title: safeTitle,
    body: safeBody,
    silent: Boolean(silent)
  });
  notification.on("click", () => {
    showMainWindow();
  });
  notification.show();
  return { ok: true, title: safeTitle, body: safeBody };
}

export function handleAgentDesktopEvent(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "command_pending") {
    showDesktopNotification({
      title: "AgentDesk is waiting",
      body: `Command approval needed: ${truncateText(message.command || "", 160)}`
    });
    return;
  }
  if (message.type === "patch_proposed") {
    showDesktopNotification({
      title: "AgentDesk is waiting",
      body: `Patch review needed: ${truncateText(message.summary || "", 180)}`
    });
    return;
  }
  if (message.type === "ask_user_pending") {
    showDesktopNotification({
      title: "AgentDesk needs input",
      body: truncateText(message.question || "", 220)
    });
    return;
  }
  if (message.type === "error") {
    showDesktopNotification({
      title: "AgentDesk task failed",
      body: truncateText(message.message || "", 220)
    });
    return;
  }
  if (message.type === "done" && shouldNotifyWhenDone()) {
    showDesktopNotification({
      title: "AgentDesk task finished",
      body: "The current agent run is complete."
    });
  }
}

export function getDesktopIntegrationState() {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    trayEnabled: Boolean(tray),
    globalShortcutRegistered: shortcutRegistered,
    globalShortcutAccelerator: shortcutAccelerator,
    notificationsSupported: Notification.isSupported(),
    activeRequests: Number(getActiveRequestCountRef()) || 0,
    backgroundMode: Boolean(tray)
  };
}

function createTray() {
  if (tray) return tray;
  tray = new Tray(createTrayIcon());
  tray.setToolTip("AgentDesk");
  tray.on("click", () => {
    toggleMainWindow();
  });
  updateTrayMenu();
  return tray;
}

function updateTrayMenu() {
  if (!tray) return;
  const activeRequests = Number(getActiveRequestCountRef()) || 0;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show AgentDesk",
      click: () => showMainWindow()
    },
    {
      label: activeRequests > 0 ? `Active tasks: ${activeRequests}` : "No active tasks",
      enabled: false
    },
    {
      label: `Toggle: ${shortcutAccelerator}`,
      enabled: false
    },
    { type: "separator" },
    {
      label: "Quit AgentDesk",
      click: () => quitFromTray()
    }
  ]);
  tray.setContextMenu(contextMenu);
}

function registerGlobalShortcut() {
  globalShortcut.unregister(shortcutAccelerator);
  shortcutRegistered = globalShortcut.register(shortcutAccelerator, () => {
    toggleMainWindow();
  });
}

function shouldNotifyWhenDone() {
  const window = getMainWindowRef();
  if (!window || window.isDestroyed()) return true;
  return !window.isVisible() || window.isMinimized() || !window.isFocused();
}

function createTrayIcon() {
  const image = nativeImage.createFromBuffer(createPngIconBuffer(18, 18));
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image;
}

function createPngIconBuffer(width, height) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const border = x === 1 || y === 1 || x === width - 2 || y === height - 2;
      const diagonal = x === y || x === width - y - 1;
      const center = x >= 7 && x <= 10 && y >= 7 && y <= 10;
      const active = border || diagonal || center;
      row[offset] = active ? 38 : 0;
      row[offset + 1] = active ? 99 : 0;
      row[offset + 2] = active ? 235 : 0;
      row[offset + 3] = active ? 255 : 0;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  return Buffer.concat([
    pngSignature(),
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngSignature() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data])))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function truncateText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
