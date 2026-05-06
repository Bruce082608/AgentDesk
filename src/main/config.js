import fs from "node:fs/promises";
import path from "node:path";
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
  temperature: 0.2
};

export async function loadAppConfig() {
  const apiKeyState = await loadApiKey();
  const apiKey = apiKeyState.apiKey;
  const configPath = getConfigPath();

  try {
    const raw = await readConfigFile();
    const trimmed = raw.trim();
    if (!trimmed) {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey, ...getSafeStorageStatus(), apiKeyStorage: apiKeyState.storage };
    }
    const parsed = normalizeConfig(JSON.parse(trimmed));
    if (configPath !== LEGACY_CONFIG_PATH) {
      await writeConfigFile(toPersistedConfig(parsed));
    }
    return { ...DEFAULT_CONFIG, ...parsed, apiKey, ...getSafeStorageStatus(), apiKeyStorage: apiKeyState.storage };
  } catch (error) {
    if (error?.code === "ENOENT") {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey, ...getSafeStorageStatus(), apiKeyStorage: apiKeyState.storage };
    }

    await saveAppConfig(DEFAULT_CONFIG);
    return {
      ...DEFAULT_CONFIG,
      apiKey,
      ...getSafeStorageStatus(),
      apiKeyStorage: apiKeyState.storage,
      recoveredFromError: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function saveAppConfig(config) {
  let apiKeyStorage = "unchanged";
  if (Object.prototype.hasOwnProperty.call(config, "apiKey")) {
    apiKeyStorage = await saveApiKey(config.apiKey);
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
    temperature: config.temperature
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

async function loadApiKey() {
  try {
    const raw = await fs.readFile(getSecretsPath(), "utf8");
    const data = JSON.parse(raw);
    if (!data.apiKey) return { apiKey: "", storage: "empty" };
    if (data.storage === "safeStorage") {
      if (!safeStorage.isEncryptionAvailable()) {
        return { apiKey: "", storage: "safeStorage-unavailable" };
      }
      return {
        apiKey: safeStorage.decryptString(Buffer.from(data.apiKey, "base64")),
        storage: "safeStorage"
      };
    }
    return { apiKey: "", storage: "unknown" };
  } catch (error) {
    if (error?.code === "ENOENT") return { apiKey: "", storage: "empty" };
    return { apiKey: "", storage: "unreadable" };
  }
}

async function saveApiKey(apiKey) {
  const value = String(apiKey ?? "");
  const secretsPath = getSecretsPath();
  await fs.mkdir(path.dirname(secretsPath), { recursive: true });

  if (!value) {
    await fs.rm(secretsPath, { force: true }).catch(() => {});
    return "empty";
  }

  if (!safeStorage.isEncryptionAvailable()) {
    await fs.rm(secretsPath, { force: true }).catch(() => {});
    return "safeStorage-unavailable";
  }

  const encrypted = safeStorage.encryptString(value).toString("base64");
  const tempPath = `${secretsPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify({ storage: "safeStorage", apiKey: encrypted }, null, 2)}\n`, "utf8");
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
