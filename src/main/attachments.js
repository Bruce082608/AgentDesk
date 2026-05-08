import fs from "node:fs/promises";
import path from "node:path";

const MAX_ATTACHMENT_BYTES = 1_000_000;
const MAX_ATTACHMENT_CHARS = 120_000;

export async function readUploadedFiles(filePaths = []) {
  return readAttachmentFiles(filePaths);
}

export async function readAttachmentFiles(filePaths = []) {
  const files = [];
  for (const filePath of filePaths) {
    const absolutePath = path.resolve(String(filePath));
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) continue;

    if (stat.size > MAX_ATTACHMENT_BYTES) {
      files.push({
        path: absolutePath,
        content: `[文件过大，未读取正文。大小：${stat.size} bytes；当前上传分析限制：${MAX_ATTACHMENT_BYTES} bytes。]`,
        status: "large",
        size: stat.size,
        truncated: false
      });
      continue;
    }

    const buffer = await fs.readFile(absolutePath);
    if (looksBinary(buffer)) {
      files.push({
        path: absolutePath,
        content: `[二进制文件，未读取正文。大小：${stat.size} bytes。当前版本支持文本类文件分析。]`,
        status: "binary",
        size: stat.size,
        truncated: false
      });
      continue;
    }

    let content = buffer.toString("utf8");
    let truncated = false;
    if (content.length > MAX_ATTACHMENT_CHARS) {
      content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n\n[内容已截断：最多读取 ${MAX_ATTACHMENT_CHARS} 字符。]`;
      truncated = true;
    }
    files.push({
      path: absolutePath,
      content,
      status: truncated ? "truncated" : "ready",
      size: stat.size,
      chars: content.length,
      truncated
    });
  }
  return files;
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
