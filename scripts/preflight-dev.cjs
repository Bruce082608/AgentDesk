const { execFileSync } = require("node:child_process");
const net = require("node:net");

const PORT = Number(process.env.VITE_PORT || 5173);
const HOST = "127.0.0.1";
const mode = process.argv[2] || "check";

if (mode === "clean") {
  cleanPort(PORT);
} else {
  checkPort(PORT).then((available) => {
    if (available) {
      console.log(`Dev preflight passed: ${HOST}:${PORT} is free.`);
      return;
    }
    const pids = findPortPids(PORT);
    const owner = pids.length > 0 ? ` PIDs: ${pids.join(", ")}.` : "";
    console.error(`Port ${PORT} is already in use.${owner}`);
    console.error(`Run "npm run dev:clean" or close the old dev server, then retry.`);
    process.exit(1);
  });
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, HOST);
  });
}

function cleanPort(port) {
  const pids = findPortPids(port);
  if (pids.length === 0) {
    console.log(`No process is listening on port ${port}.`);
    return;
  }

  for (const pid of pids) {
    if (pid === String(process.pid)) continue;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "inherit" });
      } else {
        process.kill(Number(pid), "SIGTERM");
      }
    } catch (error) {
      console.error(`Failed to stop PID ${pid}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

function findPortPids(port) {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
      const suffix = `:${port}`;
      return [...new Set(output
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 5 && parts[1]?.endsWith(suffix) && parts[3] === "LISTENING")
        .map((parts) => parts[4])
        .filter(Boolean))];
    }

    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}
