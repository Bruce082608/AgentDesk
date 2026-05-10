import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const previewCache = new Map();
const MAX_CACHE_ENTRIES = 200;

export async function readTextPreview(filePath, options = {}) {
  const absolutePath = path.resolve(String(filePath));
  const stat = await fs.stat(absolutePath);
  const signature = `${stat.size}:${stat.mtimeMs}`;
  const maxBytes = Number(options.maxBytes) || 0;
  const maxChars = Number(options.maxChars) || 0;
  const cached = previewCache.get(absolutePath);
  if (cached && cached.signature === signature && cached.maxBytes === maxBytes && cached.maxChars === maxChars) {
    return { ...cached.result };
  }

  let result;
  if (stat.size > maxBytes) {
    result = {
      content: renderPreviewMessage(options.largeMessage, {
        size: stat.size,
        maxBytes,
        path: absolutePath
      }),
      status: "large",
      size: stat.size,
      truncated: false,
      hash: signature
    };
  } else {
    const buffer = await fs.readFile(absolutePath);
    const hash = createHash("sha1").update(buffer).digest("hex");
    if (looksBinary(buffer)) {
      result = {
        content: renderPreviewMessage(options.binaryMessage, {
          size: stat.size,
          maxBytes,
          path: absolutePath
        }),
        status: "binary",
        size: stat.size,
        truncated: false,
        hash
      };
    } else {
      let content = buffer.toString("utf8");
      let truncated = false;
      if (maxChars > 0 && content.length > maxChars) {
        content = `${content.slice(0, maxChars)}\n\n${renderPreviewMessage(options.truncatedMessage, {
          size: stat.size,
          maxChars,
          path: absolutePath
        })}`;
        truncated = true;
      }
      result = {
        content,
        status: truncated ? "truncated" : "ready",
        size: stat.size,
        chars: content.length,
        truncated,
        hash
      };
    }
  }

  cachePreview(absolutePath, signature, maxBytes, maxChars, result);
  return { ...result };
}

export function clearPreviewCache() {
  previewCache.clear();
}

function cachePreview(absolutePath, signature, maxBytes, maxChars, result) {
  previewCache.set(absolutePath, { signature, maxBytes, maxChars, result: { ...result } });
  if (previewCache.size <= MAX_CACHE_ENTRIES) return;
  const oldestKey = previewCache.keys().next().value;
  if (oldestKey) previewCache.delete(oldestKey);
}

function renderPreviewMessage(message, values) {
  if (typeof message === "function") return String(message(values));
  return String(message || "");
}

function looksBinary(buffer) {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.08;
}
