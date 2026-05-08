const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const lockedCandidates = [
  path.join(releaseDir, "win-unpacked", "resources", "app.asar"),
  path.join(releaseDir, "win-unpacked", "DeepSeek Agent Window.exe")
];

let failed = false;

for (const filePath of lockedCandidates) {
  if (!fs.existsSync(filePath)) continue;
  try {
    const handle = fs.openSync(filePath, "r+");
    fs.closeSync(handle);
  } catch (error) {
    failed = true;
    console.error(`Packaging preflight failed: ${path.relative(root, filePath)} appears to be locked.`);
    console.error(`Close the running app or remove the old release output, then retry.`);
    console.error(error.message);
  }
}

if (failed) process.exit(1);
console.log("Packaging preflight passed.");
