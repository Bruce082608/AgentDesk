import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { clearPreviewCache, readTextPreview } from "./file-previews.js";

describe("file preview cache", () => {
  it("returns the same preview for unchanged files", async () => {
    const filePath = path.join(os.tmpdir(), `agent-window-preview-${Date.now()}.txt`);
    await fs.writeFile(filePath, "hello world", "utf8");
    clearPreviewCache();

    const first = await readTextPreview(filePath, { maxBytes: 100, maxChars: 100 });
    const second = await readTextPreview(filePath, { maxBytes: 100, maxChars: 100 });

    expect(first.content).toBe("hello world");
    expect(second.content).toBe("hello world");
    expect(second.hash).toBe(first.hash);

    await fs.rm(filePath, { force: true });
  });
});
