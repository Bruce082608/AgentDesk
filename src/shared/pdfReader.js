import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const MAX_PDF_BYTES = 10_000_000;       // 10 MB
const MAX_EXTRACTED_CHARS = 80_000;     // safety cap on returned text
const EXTRACTION_TIMEOUT_MS = 30_000;

/**
 * Extract text content from a PDF file.
 *
 * Returns { text, pageCount, info, truncated, hash }.
 * On failure returns { error, reason }.
 */
export async function extractPdfText(absolutePath) {
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    return { error: "Not a file", reason: "not_a_file" };
  }

  if (stat.size > MAX_PDF_BYTES) {
    return {
      error: `PDF too large (${formatSize(stat.size)}). Maximum supported: ${formatSize(MAX_PDF_BYTES)}.`,
      reason: "too_large",
      size: stat.size
    };
  }

  const buffer = await fs.readFile(absolutePath);
  const hash = createHash("sha1").update(buffer).digest("hex");

  let pdfData;
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      pdfData = await withTimeout(parser.getText(), EXTRACTION_TIMEOUT_MS);
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("timeout") || message.includes("Timeout")) {
      return {
        error: `PDF extraction timed out after ${EXTRACTION_TIMEOUT_MS / 1000}s.`,
        reason: "timeout",
        hash
      };
    }

    // Detect encrypted / password-protected PDFs
    if (
      /encrypt|password|bad decrypt|no decrypt/i.test(message) ||
      /PDF is encrypted/i.test(message)
    ) {
      return {
        error: "This PDF is encrypted or password-protected and cannot be read.",
        reason: "encrypted",
        hash
      };
    }

    // Detect corrupt PDF
    if (/invalid pdf|not a pdf|no pdf header/i.test(message)) {
      return {
        error: "This file does not appear to be a valid PDF.",
        reason: "invalid_pdf",
        hash
      };
    }

    return {
      error: `PDF extraction failed: ${message}`,
      reason: "extraction_error",
      hash
    };
  }

  if (!pdfData || typeof pdfData.text !== "string") {
    return { error: "PDF extraction produced no text content.", reason: "empty_result", hash };
  }

  let text = pdfData.text;
  const truncated = text.length > MAX_EXTRACTED_CHARS;

  if (truncated) {
    text =
      text.slice(0, MAX_EXTRACTED_CHARS) +
      `\n\n---\n[PDF text truncated at ${MAX_EXTRACTED_CHARS.toLocaleString("en-US")} characters. ` +
      `Full extracted length: ${text.length.toLocaleString("en-US")} characters. ` +
      `File: ${path.basename(absolutePath)}]`;
  }

  return {
    text,
    pageCount: Number.isFinite(pdfData.total) ? pdfData.total : Number.isFinite(pdfData.numpages) ? pdfData.numpages : 0,
    info: pdfData.info || {},
    truncated,
    hash,
    size: stat.size
  };
}

/**
 * Check whether a file extension suggests PDF.
 */
export function isPdfExtension(filePath) {
  return path.extname(String(filePath)).toLowerCase() === ".pdf";
}

/**
 * Simple binary-or-not heuristic – mirrors the logic in file-previews.js.
 * Used by tool-runner when we don't have the buffer yet.
 */
export function looksBinaryBuffer(buffer) {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.08;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
