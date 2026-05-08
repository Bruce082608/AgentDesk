const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".ts",
  ".tsx"
]);
const SKIP_DIRS = new Set([".git", "dist", "node_modules", "release"]);
const SUSPICIOUS_PATTERNS = [
  new RegExp("\\uFFFD"),
  new RegExp("\\u9225"),
  new RegExp("\\u9428"),
  new RegExp("\\u93c4"),
  new RegExp("\\u935a"),
  new RegExp("\\u6d93[^\\u4e00-\\u9fff]?"),
  new RegExp("\\u7487"),
  new RegExp("\\u59dd"),
  new RegExp("\\u93b4"),
  new RegExp("\\u7edb"),
  new RegExp("\\u5bee"),
  new RegExp("\\u7035"),
  new RegExp("\\u9369"),
  new RegExp("\\u9286"),
  new RegExp("\\u951b")
];

const findings = [];

walk(ROOT);

if (findings.length > 0) {
  console.error("Suspicious mojibake-like text was found:");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.text}`);
  }
  process.exit(1);
}

console.log("Encoding check passed.");

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
    checkFile(path.join(directory, entry.name));
  }
}

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const relative = path.relative(ROOT, filePath).replaceAll("\\", "/");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(line))) {
      findings.push({
        file: relative,
        line: index + 1,
        text: line.trim().slice(0, 240)
      });
    }
  }
}
