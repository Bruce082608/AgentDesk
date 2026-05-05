import fs from "node:fs/promises";
import path from "node:path";

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
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey: "" };
    }
    return { ...DEFAULT_CONFIG, ...JSON.parse(trimmed), apiKey: "" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      await saveAppConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG, apiKey: "" };
    }

    await saveAppConfig(DEFAULT_CONFIG);
    return {
      ...DEFAULT_CONFIG,
      apiKey: "",
      recoveredFromError: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function saveAppConfig(config) {
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

  const tempPath = `${CONFIG_PATH}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, CONFIG_PATH);
  return { ok: true, path: CONFIG_PATH };
}

export function getConfigPath() {
  return CONFIG_PATH;
}
