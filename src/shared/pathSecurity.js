import path from "node:path";

const DEFAULT_MESSAGES = {
  missingWorkspace: "请先选择 workspace。",
  outsideWorkspace: ({ path: targetPath }) => `路径越界：${targetPath}`,
  emptyPath: "path 不能为空。",
  unsafePath: ({ path: targetPath }) => `路径不安全：${targetPath}`
};

export function resolveInsideWorkspace(workspace, targetPath, options = {}) {
  if (!workspace) throw pathSecurityError("missingWorkspace", { path: targetPath }, options);
  const absoluteWorkspace = path.resolve(workspace);
  const absoluteTarget = path.resolve(absoluteWorkspace, String(targetPath || "."));
  const relative = path.relative(absoluteWorkspace, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw pathSecurityError("outsideWorkspace", { path: targetPath }, options);
  }
  return absoluteTarget;
}

export function normalizeWorkspacePath(filePath, options = {}) {
  const normalized = String(filePath ?? "").replaceAll("\\", "/").trim();
  if (!normalized) throw pathSecurityError("emptyPath", { path: filePath }, options);
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw pathSecurityError("unsafePath", { path: filePath }, options);
  }
  return normalized;
}

function pathSecurityError(key, values, options) {
  const message = formatPathSecurityMessage(key, values, options);
  const error = new Error(message);
  if (options.language) error.language = options.language;
  return error;
}

function formatPathSecurityMessage(key, values, options) {
  if (typeof options.message === "function") return options.message(key, values);
  const template = options.messages?.[key] ?? DEFAULT_MESSAGES[key] ?? key;
  return typeof template === "function"
    ? template(values)
    : String(template).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ""));
}
