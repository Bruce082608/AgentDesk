import { describe, expect, it } from "vitest";
import { parseImportedCodexConfig } from "./config.js";

describe("Codex config import", () => {
  it("imports Codex desktop OpenAI-compatible gateway config for AgentDesk conversations", () => {
    const config = parseImportedCodexConfig({
      tomlContent: `
model_provider = "codex"
model = "gpt-5.4"
model_reasoning_effort = "high"

[model_providers.codex]
name = "codex"
base_url = "https://console.mirrorcoding.xyz/v1"
wire_api = "responses"
requires_openai_auth = true
`,
      authContent: JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-test"
      })
    });

    expect(config).toEqual({
      provider: "openai",
      model: "gpt-5.4",
      baseUrl: "https://console.mirrorcoding.xyz/v1",
      reasoningEffort: "high",
      wireApi: "responses",
      apiKey: "sk-test"
    });
  });

  it("does not treat non-key auth metadata as an imported API key", () => {
    const config = parseImportedCodexConfig({
      tomlContent: `
model_provider = "codex"
model = "gpt-5.4"

[model_providers.codex]
base_url = "https://console.mirrorcoding.xyz/v1"
wire_api = "responses"
`,
      authContent: JSON.stringify({
        auth_mode: "apikey"
      })
    });

    expect(config.apiKey).toBeUndefined();
  });
});
