import fs from "node:fs/promises";
import path from "node:path";
import { readTextPreview } from "./file-previews.js";

const MAX_ATTACHMENT_BYTES = 1_000_000;
const MAX_ATTACHMENT_CHARS = 120_000;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export async function readUploadedFiles(filePaths = []) {
  return readAttachmentFiles(filePaths);
}

export async function readAttachmentFiles(filePaths = []) {
  const files = [];
  for (const filePath of filePaths) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        const buffer = await fs.readFile(filePath);
        const mimeMap = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
          ".bmp": "image/bmp"
        };
        const mimeType = mimeMap[ext] || "image/png";
        const base64Data = buffer.toString("base64");
        const content = `data:${mimeType};base64,${base64Data}`;
        files.push({
          path: String(filePath),
          content,
          status: "ready",
          size: buffer.length,
          chars: content.length,
          truncated: false,
          isImage: true,
          mimeType
        });
      } else {
        const preview = await readTextPreview(filePath, {
          maxBytes: MAX_ATTACHMENT_BYTES,
          maxChars: MAX_ATTACHMENT_CHARS,
          largeMessage: ({ size, maxBytes }) => `文件过大，未读取正文。大小：${size} bytes；当前上传分析限制：${maxBytes} bytes。`,
          binaryMessage: ({ size }) => `二进制文件，未读取正文。大小：${size} bytes。当前版本支持文本类文件分析。`,
          truncatedMessage: ({ maxChars }) => `内容已截断：最多读取 ${maxChars} 字符。`
        });
        files.push({
          path: String(filePath),
          content: preview.content,
          status: preview.status,
          size: preview.size,
          chars: preview.chars,
          truncated: preview.truncated
        });
      }
    } catch {
      continue;
    }
  }
  return files;
}

