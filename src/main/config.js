import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";

const CONFIG_PATH = path.join(process.cwd(), "agent-config.json");

const DEFAULT_CONFIG = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  contextTokens: 1000000,
  maxTokens: 32768,
  thinkingMode: "enabled",
  reasoningEffort: "max",
  temperature: 0.2
};

export async function loadAppConfig() {
  const apiKey = await loadApiKey();

  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey };
    }
    return { ...DEFAULT_CONFIG, ...JSON.parse(trimmed), apiKey };
  } catch (error) {
    if (error?.code === "ENOENT") {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey };
    }

    await saveAppConfig(DEFAULT_CONFIG);
    return {
      ...DEFAULT_CONFIG,
      apiKey,
      recoveredFromError: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function saveAppConfig(config) {
  if (Object.prototype.hasOwnProperty.call(config, "apiKey")) {
    await saveApiKey(config.apiKey);
  }

  const persisted = {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    contextTokens: Number(config.contextTokens),
    maxTokens: Number(config.maxTokens),
    thinkingMode: config.thinkingMode,
    reasoningEffort: config.reasoningEffort,
    temperature: Number(config.temperature)
  };

  const tempPath = `${CONFIG_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, CONFIG_PATH);
  return { ok: true, path: CONFIG_PATH };
}

export function getConfigPath() {
  return CONFIG_PATH;
}

async function loadApiKey() {
  try {
    const raw = await fs.readFile(getSecretsPath(), "utf8");
    const data = JSON.parse(raw);
    if (!data.apiKey) return "";
    if (data.storage === "safeStorage") {
      return safeStorage.decryptString(Buffer.from(data.apiKey, "base64"));
    }
    return "";
  } catch {
    return "";
  }
}

async function saveApiKey(apiKey) {
  const value = String(apiKey ?? "");
  const secretsPath = getSecretsPath();
  await fs.mkdir(path.dirname(secretsPath), { recursive: true });

  if (!value) {
    await fs.rm(secretsPath, { force: true }).catch(() => {});
    return;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统不支持 Electron safeStorage，API key 未保存。请改用环境变量。");
  }

  const encrypted = safeStorage.encryptString(value).toString("base64");
  const tempPath = `${secretsPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify({ storage: "safeStorage", apiKey: encrypted }, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, secretsPath);
}

function getSecretsPath() {
  return path.join(app.getPath("userData"), "secrets.json");
}
