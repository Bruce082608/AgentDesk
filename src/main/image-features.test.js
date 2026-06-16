import { describe, expect, it, vi } from "vitest";
import { getModelCapability } from "../shared/providerCapabilities.js";
import { countChatMessageTokens, countAttachmentsTokens } from "../shared/tokenCounter.js";
import { readAttachmentFiles } from "./attachments.js";
import fs from "node:fs/promises";
import path from "node:path";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/mock/userData"
  }
}));

describe("Vision and Image Features", () => {
  describe("Model Capabilities", () => {
    it("should resolve vision capability based on model names", () => {
      const configA = { provider: "openai-compatible", model: "gpt-4o" };
      const capA = getModelCapability(configA);
      expect(capA.capability.supportsVision).toBe(true);

      const configB = { provider: "openai-compatible", model: "claude-3-5-sonnet" };
      const capB = getModelCapability(configB);
      expect(capB.capability.supportsVision).toBe(true);

      const configC = { provider: "deepseek", model: "deepseek-chat" };
      const capC = getModelCapability(configC);
      expect(capC.capability.supportsVision).toBe(false);
    });

    it("uses a 1M context window for imported unknown OpenAI/Codex models", () => {
      const cap = getModelCapability({ provider: "openai", model: "gpt-5.4" });
      expect(cap.model).toBe("gpt-5.4");
      expect(cap.capability.contextTokens).toBe(1_000_000);
    });
  });

  describe("Token Counter for Arrays and Images", () => {
    it("should count array message content tokens with standard image cost", () => {
      const message = {
        role: "user",
        content: [
          { type: "text", text: "Hello world" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
        ]
      };

      const tokens = countChatMessageTokens(message);
      // overhead (4) + role "user" (1*1.15) + "Hello world" (2*1.15) + image cost (200) -> approx 208
      expect(tokens).toBeGreaterThan(200);
      expect(tokens).toBeLessThan(220);
    });

    it("should count image attachments as 200 tokens flat rate", () => {
      const attachments = [
        { path: "image.png", isImage: true },
        { path: "doc.txt", content: "hello text content" }
      ];

      const tokens = countAttachmentsTokens(attachments);
      // path "image.png" tokens + 200 + path "doc.txt" tokens + content tokens
      expect(tokens).toBeGreaterThan(200);
    });
  });

  describe("Attachment Reading for Images", () => {
    it("should parse image extensions as Base64 Data URLs", async () => {
      const mockBuffer = Buffer.from("mock image data content");
      vi.spyOn(fs, "readFile").mockResolvedValue(mockBuffer);

      const result = await readAttachmentFiles(["/path/to/test_image.png"]);
      expect(result.length).toBe(1);
      expect(result[0].isImage).toBe(true);
      expect(result[0].mimeType).toBe("image/png");
      expect(result[0].content).toContain("data:image/png;base64,");
      
      vi.restoreAllMocks();
    });
  });
});
