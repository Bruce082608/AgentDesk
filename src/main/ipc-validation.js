const MAX_ID_LENGTH = 128;
const MAX_PATH_LENGTH = 4096;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_MESSAGES = 500;
const MAX_ATTACHMENTS = 50;
const CHAT_ROLES = new Set(["user", "assistant", "tool", "system"]);
const PROVIDERS = new Set(["deepseek", "openai-compatible"]);
const THINKING_MODES = new Set(["enabled", "disabled"]);
const REASONING_EFFORTS = new Set(["low", "medium", "high", "max"]);
const LANGUAGES = new Set(["zh", "en"]);

export function validateWorkspace(value, field = "workspace") {
  return requireString(value, field, { max: MAX_PATH_LENGTH });
}

export function validateWorkspaceTreePayload(value) {
  if (typeof value === "string") return { workspace: validateWorkspace(value), directory: "" };
  const payload = requireObject(value, "workspace tree payload");
  return {
    workspace: validateWorkspace(payload.workspace),
    directory: optionalString(payload.directory, "directory", { max: MAX_PATH_LENGTH }) || ""
  };
}

export function validateConfigPayload(value) {
  return validateProviderConfig(value, { allowEmptyApiKey: true });
}

export function validateFileReadPayload(value) {
  const payload = requireObject(value, "file payload");
  return {
    workspace: validateWorkspace(payload.workspace),
    path: requireString(payload.path, "path", { max: MAX_PATH_LENGTH })
  };
}

export function validateFileSearchPayload(value) {
  const payload = requireObject(value, "search payload");
  return {
    workspace: validateWorkspace(payload.workspace),
    query: requireString(payload.query, "query", { max: 1000 }),
    maxResults: optionalInteger(payload.maxResults, "maxResults", 1, 200)
  };
}

export function validateAttachmentPathsPayload(value) {
  const payload = requireObject(value, "attachment paths payload");
  if (!Array.isArray(payload.paths)) invalid("paths", "an array");
  if (payload.paths.length > MAX_ATTACHMENTS) invalid("paths", `at most ${MAX_ATTACHMENTS} items`);
  return {
    paths: payload.paths.map((item, index) => requireString(item, `paths[${index}]`, { max: MAX_PATH_LENGTH }))
  };
}

export function validateAgentSendPayload(value) {
  const payload = requireObject(value, "agent payload");
  return {
    requestId: requireString(payload.requestId, "requestId", { max: MAX_ID_LENGTH }),
    sessionId: optionalString(payload.sessionId, "sessionId", { max: MAX_ID_LENGTH }),
    language: validateLanguage(payload.language),
    workspace: validateWorkspace(payload.workspace),
    input: requireString(payload.input, "input", { max: MAX_TEXT_LENGTH, trim: false }),
    providerConfig: validateProviderConfig(payload.providerConfig, { allowEmptyApiKey: true }),
    messages: validateMessages(payload.messages),
    attachments: validateAttachments(payload.attachments)
  };
}

export function validateRequestId(value) {
  return requireString(value, "requestId", { max: MAX_ID_LENGTH });
}

export function validateTokenCountPayload(value) {
  const payload = requireObject(value, "token payload");
  return {
    messages: validateMessages(Array.isArray(payload.messages) ? payload.messages : []),
    input: optionalString(payload.input, "input", { max: MAX_TEXT_LENGTH, trim: false }) || "",
    attachments: validateAttachments(Array.isArray(payload.attachments) ? payload.attachments : [])
  };
}

export function validatePatchPayload(value) {
  if (typeof value === "string") return { patchId: requireString(value, "patchId", { max: MAX_ID_LENGTH }), language: "zh" };
  const payload = requireObject(value, "patch payload");
  return {
    patchId: requireString(payload.patchId, "patchId", { max: MAX_ID_LENGTH }),
    language: validateLanguage(payload.language)
  };
}

export function validateCommandApprovalPayload(value) {
  if (typeof value === "string") {
    return { commandId: requireString(value, "commandId", { max: MAX_ID_LENGTH }), allowFuture: false, language: "zh" };
  }
  const payload = requireObject(value, "command approval payload");
  return {
    commandId: requireString(payload.commandId, "commandId", { max: MAX_ID_LENGTH }),
    allowFuture: Boolean(payload.allowFuture),
    language: validateLanguage(payload.language)
  };
}

export function validateCommandId(value) {
  return requireString(value, "commandId", { max: MAX_ID_LENGTH });
}

export function validateAutoApprovalPayload(value) {
  const payload = requireObject(value, "auto approval payload");
  return {
    enabled: Boolean(payload.enabled),
    workspace: validateWorkspace(payload.workspace),
    sessionId: optionalString(payload.sessionId, "sessionId", { max: MAX_ID_LENGTH }),
    requestId: optionalString(payload.requestId, "requestId", { max: MAX_ID_LENGTH })
  };
}

function validateProviderConfig(value, options = {}) {
  const config = requireObject(value ?? {}, "provider config");
  const provider = optionalString(config.provider, "provider", { max: 64 }) || "deepseek";
  if (!PROVIDERS.has(provider)) invalid("provider", "one of: deepseek, openai-compatible");

  const thinkingMode = optionalString(config.thinkingMode, "thinkingMode", { max: 32 }) || "enabled";
  if (!THINKING_MODES.has(thinkingMode)) invalid("thinkingMode", "enabled or disabled");

  const reasoningEffort = optionalString(config.reasoningEffort, "reasoningEffort", { max: 32 }) || "max";
  if (!REASONING_EFFORTS.has(reasoningEffort)) invalid("reasoningEffort", "low, medium, high, or max");

  const apiKey = optionalString(config.apiKey, "apiKey", { max: 20_000 }) || "";
  if (!options.allowEmptyApiKey && !apiKey) invalid("apiKey", "a non-empty string");

  return {
    ...config,
    provider,
    baseUrl: optionalString(config.baseUrl, "baseUrl", { max: 2048 }) || "",
    model: optionalString(config.model, "model", { max: 256 }) || "",
    summaryModel: optionalString(config.summaryModel, "summaryModel", { max: 256 }) || "",
    apiKey,
    temperature: optionalNumber(config.temperature, "temperature", 0, 2),
    maxTokens: optionalInteger(config.maxTokens, "maxTokens", 1, 2_000_000),
    contextTokens: optionalInteger(config.contextTokens, "contextTokens", 1024, 4_000_000),
    maxAgentSteps: optionalInteger(config.maxAgentSteps, "maxAgentSteps", 1, 512),
    thinkingMode,
    reasoningEffort
  };
}

function validateMessages(value) {
  if (!Array.isArray(value)) invalid("messages", "an array");
  if (value.length > MAX_MESSAGES) invalid("messages", `at most ${MAX_MESSAGES} items`);
  return value.map((item, index) => validateMessage(item, `messages[${index}]`));
}

function validateMessage(value, field) {
  const message = requireObject(value, field);
  const role = requireString(message.role, `${field}.role`, { max: 32 });
  if (!CHAT_ROLES.has(role)) invalid(`${field}.role`, "user, assistant, tool, or system");
  return {
    ...message,
    role,
    content: optionalString(message.content, `${field}.content`, { max: MAX_TEXT_LENGTH, trim: false }) || "",
    tool_call_id: optionalString(message.tool_call_id, `${field}.tool_call_id`, { max: MAX_ID_LENGTH }),
    name: optionalString(message.name, `${field}.name`, { max: 256 }),
    reasoning: optionalString(message.reasoning, `${field}.reasoning`, { max: MAX_TEXT_LENGTH, trim: false }),
    tool_calls: validateToolCalls(message.tool_calls, `${field}.tool_calls`)
  };
}

function validateToolCalls(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalid(field, "an array");
  if (value.length > 100) invalid(field, "at most 100 items");
  return value.map((toolCall, index) => {
    const item = requireObject(toolCall, `${field}[${index}]`);
    const fn = requireObject(item.function ?? {}, `${field}[${index}].function`);
    return {
      ...item,
      id: requireString(item.id, `${field}[${index}].id`, { max: MAX_ID_LENGTH }),
      type: optionalString(item.type, `${field}[${index}].type`, { max: 64 }) || "function",
      function: {
        ...fn,
        name: optionalString(fn.name, `${field}[${index}].function.name`, { max: 256 }) || "",
        arguments: optionalString(fn.arguments, `${field}[${index}].function.arguments`, { max: MAX_TEXT_LENGTH, trim: false }) || ""
      }
    };
  });
}

function validateAttachments(value) {
  if (!Array.isArray(value)) invalid("attachments", "an array");
  if (value.length > MAX_ATTACHMENTS) invalid("attachments", `at most ${MAX_ATTACHMENTS} items`);
  return value.map((item, index) => {
    const file = requireObject(item, `attachments[${index}]`);
    return {
      path: requireString(file.path, `attachments[${index}].path`, { max: MAX_PATH_LENGTH }),
      content: optionalString(file.content, `attachments[${index}].content`, { max: MAX_TEXT_LENGTH, trim: false }) || ""
    };
  });
}

function validateLanguage(value) {
  const language = optionalString(value, "language", { max: 8 }) || "zh";
  return LANGUAGES.has(language) ? language : "zh";
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field, "an object");
  return value;
}

function requireString(value, field, options = {}) {
  const text = optionalString(value, field, options);
  if (!text && !options.allowEmpty) invalid(field, "a non-empty string");
  return text;
}

function optionalString(value, field, options = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") invalid(field, "a string");
  const text = options.trim === false ? value : value.trim();
  if (!options.allowEmpty && text.length === 0) return "";
  const max = options.max ?? MAX_TEXT_LENGTH;
  if (text.length > max) invalid(field, `no longer than ${max} characters`);
  return text;
}

function optionalInteger(value, field, min, max) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) invalid(field, "a finite number");
  const integer = Math.floor(number);
  if (integer < min || integer > max) invalid(field, `between ${min} and ${max}`);
  return integer;
}

function optionalNumber(value, field, min, max) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) invalid(field, "a finite number");
  if (number < min || number > max) invalid(field, `between ${min} and ${max}`);
  return number;
}

function invalid(field, expected) {
  throw new Error(`Invalid IPC payload: ${field} must be ${expected}.`);
}
