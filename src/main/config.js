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

    const result = {};

    if (hasToml) {
      const lines = tomlContent.split(/\r?\n/);
      let currentSection = "";
      let modelProvider = "";
      let model = "";
      let baseUrl = "";
      let reasoningEffort = "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          currentSection = trimmed.slice(1, -1).trim();
          continue;
        }
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }

        if (currentSection === "") {
          if (key === "model_provider") {
            modelProvider = val;
          } else if (key === "model") {
            model = val;
          } else if (key === "model_reasoning_effort") {
            reasoningEffort = val;
          }
        } else if (currentSection.startsWith("model_providers.")) {
          const providerName = currentSection.slice("model_providers.".length).trim();
          if (providerName.toLowerCase() === "openai" || (modelProvider && providerName.toLowerCase() === modelProvider.toLowerCase())) {
            if (key === "base_url") {
              baseUrl = val;
            }
          }
        }
      }

      if (modelProvider) {
        const providerLower = modelProvider.toLowerCase();
        if (providerLower === "openai") {
          result.provider = "openai";
        } else if (providerLower === "deepseek") {
          result.provider = "deepseek";
        } else {
          result.provider = "openai-compatible";
        }
      }
      if (model) result.model = model;
      if (baseUrl) result.baseUrl = baseUrl;
      if (reasoningEffort) result.reasoningEffort = normalizeImportedReasoningEffort(reasoningEffort);
    }

    if (hasAuth) {
      try {
        const authData = JSON.parse(authContent);
        const provider = result.provider || "openai";
        if (provider === "openai" || provider === "openai-compatible") {
          result.apiKey = authData.OPENAI_API_KEY || authData.openai_api_key || Object.values(authData)[0] || "";
        } else if (provider === "deepseek") {
          result.apiKey = authData.DEEPSEEK_API_KEY || authData.deepseek_api_key || Object.values(authData)[0] || "";
        }
      } catch (err) {
        // ignore JSON parse error
      }
    }

    return { ok: true, config: result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeImportedReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "xhigh" || normalized === "xhihg" || normalized === "max") return "max";
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}
