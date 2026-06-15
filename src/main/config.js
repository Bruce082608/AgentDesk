import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";
import { getModelCapability, normalizeConfigForCapabilities } from "../shared/providerCapabilities.js";

const CONFIG_FILE_NAME = "agent-config.json";
const SECRETS_FILE_NAME = "secrets.json";
const LEGACY_CONFIG_PATH = path.join(process.cwd(), CONFIG_FILE_NAME);

const DEFAULT_CONFIG = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  summaryModel: "deepseek-v4-flash",
  contextTokens: 1_000_000,
  maxTokens: 32768,
  maxAgentSteps: 64,
  thinkingMode: "enabled",
  reasoningEffort: "max",
  wireApi: "chat-completions",
  temperature: 0.2,
  telegramEnabled: true,
  telegramAllowedUserId: "7043147111",
  jimengToken: ""
};

export async function loadAppConfig() {
  const secretsState = await loadSecrets();
  const apiKey = secretsState.apiKey;
  const telegramBotToken = secretsState.telegramBotToken;
  const jimengToken = secretsState.jimengToken || "";
  const configPath = getConfigPath();

  try {
    const raw = await readConfigFile();
    const trimmed = raw.trim();
    if (!trimmed) {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey, telegramBotToken, jimengToken, ...getSafeStorageStatus(), apiKeyStorage: secretsState.storage };
    }
    const parsed = normalizeConfig(JSON.parse(trimmed));

    // Enforce default Telegram behavior as requested:
    // 1. Telegram Bot is enabled by default every time the app starts
    parsed.telegramEnabled = true;
    // 2. Default allowed user ID is 7043147111 if not set or empty
    if (!parsed.telegramAllowedUserId) {
      parsed.telegramAllowedUserId = "7043147111";
    }

    if (configPath !== LEGACY_CONFIG_PATH) {
      await writeConfigFile(toPersistedConfig(parsed));
    }
    return { ...DEFAULT_CONFIG, ...parsed, apiKey, telegramBotToken, jimengToken, ...getSafeStorageStatus(), apiKeyStorage: secretsState.storage };
  } catch (error) {
    if (error?.code === "ENOENT") {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey, telegramBotToken, jimengToken, ...getSafeStorageStatus(), apiKeyStorage: secretsState.storage };
    }

    await saveAppConfig(DEFAULT_CONFIG);
    return {
      ...DEFAULT_CONFIG,
      apiKey,
      telegramBotToken,
      jimengToken,
      ...getSafeStorageStatus(),
      apiKeyStorage: secretsState.storage,
      recoveredFromError: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function saveAppConfig(config) {
  let apiKeyStorage = "unchanged";
  const secretsToSave = {};
  let saveNeeded = false;
  if (Object.prototype.hasOwnProperty.call(config, "apiKey")) {
    secretsToSave.apiKey = config.apiKey;
    saveNeeded = true;
  }
  if (Object.prototype.hasOwnProperty.call(config, "telegramBotToken")) {
    secretsToSave.telegramBotToken = config.telegramBotToken;
    saveNeeded = true;
  }
  if (Object.prototype.hasOwnProperty.call(config, "jimengToken")) {
    secretsToSave.jimengToken = config.jimengToken;
    saveNeeded = true;
  }

  if (saveNeeded) {
    apiKeyStorage = await saveSecrets(secretsToSave);
  }

  const normalized = normalizeConfig(config);
  const persisted = toPersistedConfig({
    ...normalized,
    maxAgentSteps: clampInteger(config.maxAgentSteps, DEFAULT_CONFIG.maxAgentSteps, 8, 256)
  });

  await writeConfigFile(persisted);
  return { ok: true, path: getConfigPath(), apiKeyStorage, ...getSafeStorageStatus() };
}

function toPersistedConfig(config) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    summaryModel: config.summaryModel,
    contextTokens: config.contextTokens,
    maxTokens: config.maxTokens,
    maxAgentSteps: config.maxAgentSteps,
    thinkingMode: config.thinkingMode,
    reasoningEffort: config.reasoningEffort,
    wireApi: config.wireApi,
    temperature: config.temperature,
    telegramEnabled: Boolean(config.telegramEnabled),
    telegramAllowedUserId: String(config.telegramAllowedUserId ?? "")
  };
}

function normalizeConfig(config) {
  const normalized = normalizeConfigForCapabilities({ ...DEFAULT_CONFIG, ...config });
  const { provider, capability } = getModelCapability(normalized);
  return {
    ...normalized,
    capability: {
      label: capability.label,
      contextTokens: capability.contextTokens,
      maxOutputTokens: capability.maxOutputTokens,
      supportsThinking: capability.supportsThinking,
      supportsToolCalls: capability.supportsToolCalls,
      supportsTemperature: capability.supportsTemperature,
      balancePath: provider.balancePath
    }
  };
}

export function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
}

async function loadSecrets() {
  try {
    const raw = await fs.readFile(getSecretsPath(), "utf8");
    const data = JSON.parse(raw);
    const result = { apiKey: "", telegramBotToken: "", jimengToken: "", storage: "empty" };
    if (!data.apiKey && !data.telegramBotToken && !data.jimengToken) return result;
    if (data.storage === "safeStorage") {
      if (!safeStorage.isEncryptionAvailable()) {
        return { apiKey: "", telegramBotToken: "", jimengToken: "", storage: "safeStorage-unavailable" };
      }
      result.storage = "safeStorage";
      if (data.apiKey) {
        result.apiKey = safeStorage.decryptString(Buffer.from(data.apiKey, "base64"));
      }
      if (data.telegramBotToken) {
        result.telegramBotToken = safeStorage.decryptString(Buffer.from(data.telegramBotToken, "base64"));
      }
      if (data.jimengToken) {
        result.jimengToken = safeStorage.decryptString(Buffer.from(data.jimengToken, "base64"));
      }
      return result;
    }
    return { apiKey: "", telegramBotToken: "", jimengToken: "", storage: "unknown" };
  } catch (error) {
    if (error?.code === "ENOENT") return { apiKey: "", telegramBotToken: "", jimengToken: "", storage: "empty" };
    return { apiKey: "", telegramBotToken: "", jimengToken: "", storage: "unreadable" };
  }
}

async function saveSecrets(secrets) {
  const secretsPath = getSecretsPath();
  await fs.mkdir(path.dirname(secretsPath), { recursive: true });

  if (!safeStorage.isEncryptionAvailable()) {
    return "safeStorage-unavailable";
  }

  let currentSecrets = {};
  try {
    const raw = await fs.readFile(secretsPath, "utf8");
    const data = JSON.parse(raw);
    if (data.storage === "safeStorage") {
      currentSecrets = data;
    }
  } catch {}

  const nextSecrets = {
    storage: "safeStorage",
    apiKey: currentSecrets.apiKey || "",
    telegramBotToken: currentSecrets.telegramBotToken || "",
    jimengToken: currentSecrets.jimengToken || ""
  };

  let hasChanges = false;
  if (Object.prototype.hasOwnProperty.call(secrets, "apiKey")) {
    const value = String(secrets.apiKey ?? "");
    nextSecrets.apiKey = value ? safeStorage.encryptString(value).toString("base64") : "";
    hasChanges = true;
  }
  if (Object.prototype.hasOwnProperty.call(secrets, "telegramBotToken")) {
    const value = String(secrets.telegramBotToken ?? "");
    nextSecrets.telegramBotToken = value ? safeStorage.encryptString(value).toString("base64") : "";
    hasChanges = true;
  }
  if (Object.prototype.hasOwnProperty.call(secrets, "jimengToken")) {
    const value = String(secrets.jimengToken ?? "");
    nextSecrets.jimengToken = value ? safeStorage.encryptString(value).toString("base64") : "";
    hasChanges = true;
  }

  if (!hasChanges) return "unchanged";

  if (!nextSecrets.apiKey && !nextSecrets.telegramBotToken && !nextSecrets.jimengToken) {
    await fs.rm(secretsPath, { force: true }).catch(() => {});
    return "empty";
  }

  const tempPath = `${secretsPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(nextSecrets, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, secretsPath);
  return "safeStorage";
}

function getSecretsPath() {
  return path.join(app.getPath("userData"), SECRETS_FILE_NAME);
}

async function readConfigFile() {
  try {
    return await fs.readFile(getConfigPath(), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return await fs.readFile(LEGACY_CONFIG_PATH, "utf8");
  }
}

async function writeConfigFile(config) {
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, configPath);
}

function getSafeStorageStatus() {
  const available = safeStorage.isEncryptionAvailable();
  return {
    safeStorageAvailable: available,
    safeStorageBackend: getSafeStorageBackend(),
    platform: process.platform
  };
}

function getSafeStorageBackend() {
  try {
    if (typeof safeStorage.getSelectedStorageBackend === "function") {
      return safeStorage.getSelectedStorageBackend();
    }
  } catch {
    return "unknown";
  }
  return process.platform === "darwin" ? "keychain" : availableBackendFallback();
}

function availableBackendFallback() {
  if (process.platform === "win32") return "dpapi";
  if (process.platform === "linux") return "secret-service";
  return "unknown";
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

export async function importCodexConfig() {
  try {
    const home = os.homedir();
    const configTomlPath = path.join(home, ".codex", "config.toml");
    const authJsonPath = path.join(home, ".codex", "auth.json");

    let hasToml = false;
    let tomlContent = "";
    try {
      tomlContent = await fs.readFile(configTomlPath, "utf8");
      hasToml = true;
    } catch {}

    let hasAuth = false;
    let authContent = "";
    try {
      authContent = await fs.readFile(authJsonPath, "utf8");
      hasAuth = true;
    } catch {}

    if (!hasToml && !hasAuth) {
      throw new Error(`未找到 Codex CLI 配置文件。请确保 ~/.codex/ 目录下存在 config.toml 或 auth.json。`);
    }

    const result = parseImportedCodexConfig({
      tomlContent: hasToml ? tomlContent : "",
      authContent: hasAuth ? authContent : ""
    });
    return { ok: true, config: result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseImportedCodexConfig({ tomlContent = "", authContent = "" } = {}) {
  const result = {};
  const parsedToml = parseCodexToml(tomlContent);
  const modelProvider = asString(parsedToml.root.model_provider);
  const providerConfig = selectCodexModelProvider(parsedToml.modelProviders, modelProvider);
  const providerName = asString(providerConfig.name) || modelProvider;
  const baseUrl = asString(providerConfig.base_url) || asString(parsedToml.root.base_url);
  const wireApi = asString(providerConfig.wire_api) || asString(parsedToml.root.wire_api);
  const model = asString(parsedToml.root.model);
  const reasoningEffort = asString(parsedToml.root.model_reasoning_effort) || asString(parsedToml.root.reasoning_effort);

  const importedProvider = inferImportedProvider(providerName, baseUrl);
  if (importedProvider) result.provider = importedProvider;
  if (model) result.model = model;
  if (baseUrl) result.baseUrl = baseUrl;
  if (reasoningEffort) result.reasoningEffort = normalizeImportedReasoningEffort(reasoningEffort);
  const normalizedWireApi = normalizeImportedWireApi(wireApi);
  if (normalizedWireApi) result.wireApi = normalizedWireApi;

  const apiKey = readCodexApiKey(authContent, result.provider || importedProvider || "openai");
  if (apiKey) result.apiKey = apiKey;

  return result;
}

function parseCodexToml(content) {
  const root = {};
  const modelProviders = {};
  let currentSection = "";

  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = trimmed.slice(1, -1).trim();
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = unquoteTomlString(trimmed.slice(0, eqIdx).trim());
    const value = parseTomlValue(trimmed.slice(eqIdx + 1).trim());
    const providerName = getModelProviderSectionName(currentSection);

    if (providerName) {
      modelProviders[providerName] = {
        ...modelProviders[providerName],
        [key]: value
      };
    } else if (!currentSection) {
      root[key] = value;
    }
  }

  return { root, modelProviders };
}

function parseTomlValue(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.includes('"', 1)) || (raw.startsWith("'") && raw.includes("'", 1))) {
    const quote = raw[0];
    const endIdx = raw.lastIndexOf(quote);
    return unquoteTomlString(raw.slice(0, endIdx + 1));
  }
  const lower = raw.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return raw.replace(/\s+#.*$/, "").trim();
}

function unquoteTomlString(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getModelProviderSectionName(section) {
  const prefix = "model_providers.";
  if (!section.startsWith(prefix)) return "";
  return unquoteTomlString(section.slice(prefix.length));
}

function selectCodexModelProvider(modelProviders, modelProvider) {
  const providerNames = Object.keys(modelProviders);
  if (!providerNames.length) return {};
  const requested = providerNames.find((name) => name.toLowerCase() === String(modelProvider || "").toLowerCase());
  if (requested) return modelProviders[requested];
  const openai = providerNames.find((name) => name.toLowerCase() === "openai");
  if (openai) return modelProviders[openai];
  return modelProviders[providerNames[0]];
}

function inferImportedProvider(providerName, baseUrl) {
  const normalized = String(providerName || "").trim().toLowerCase();
  const normalizedBaseUrl = String(baseUrl || "").trim().toLowerCase();
  if (normalized.includes("deepseek") || normalizedBaseUrl.includes("deepseek")) return "deepseek";
  if (normalized || normalizedBaseUrl) return "openai";
  return "";
}

function readCodexApiKey(authContent, provider) {
  if (!authContent) return "";
  try {
    const authData = JSON.parse(authContent);
    const candidates = provider === "deepseek"
      ? ["DEEPSEEK_API_KEY", "deepseek_api_key"]
      : ["OPENAI_API_KEY", "openai_api_key", "AGENT_API_KEY", "api_key"];
    return findStringByKeys(authData, candidates) || findAnyApiKey(authData);
  } catch {
    return "";
  }
}

function findStringByKeys(value, keys) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  for (const nested of Object.values(value)) {
    const found = findStringByKeys(nested, keys);
    if (found) return found;
  }
  return "";
}

function findAnyApiKey(value) {
  if (!value || typeof value !== "object") return "";
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if ((normalizedKey === "apikey" || normalizedKey.endsWith("apikey")) && typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
    const found = findAnyApiKey(nested);
    if (found) return found;
  }
  return "";
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImportedReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "xhigh" || normalized === "xhihg" || normalized === "max") return "max";
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function normalizeImportedWireApi(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "responses" || normalized === "response") return "responses";
  if (normalized === "chat-completions" || normalized === "chat-completion" || normalized === "chat") {
    return "chat-completions";
  }
  return "";
}
