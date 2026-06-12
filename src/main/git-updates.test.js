import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkGitUpdate, applyGitUpdate } from "./git-updates.js";
import { execFile } from "node:child_process";
import { app } from "electron";

// Mock electron
vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/mock/app/path"
  }
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  exec: vi.fn()
}));

describe("git-updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects no updates when hashes match", async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      const argsStr = args.join(" ");
      if (argsStr.includes("rev-parse --abbrev-ref")) {
        callback(null, { stdout: "main\n", stderr: "" });
      } else if (argsStr.includes("fetch")) {
        callback(null, { stdout: "", stderr: "" });
      } else if (argsStr.includes("rev-parse HEAD") || argsStr.includes("rev-parse origin/main")) {
        callback(null, { stdout: "ae12525dba2c8b12368c12745f2abfc847100e80\n", stderr: "" });
      } else {
        callback(new Error(`Unknown args: ${argsStr}`));
      }
    });

    const result = await checkGitUpdate();
    expect(result.updateAvailable).toBe(false);
    expect(result.localHash).toBe("ae12525dba2c8b12368c12745f2abfc847100e80");
    expect(result.remoteHash).toBe("ae12525dba2c8b12368c12745f2abfc847100e80");
  });

  it("detects update when local commit is behind remote", async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      const argsStr = args.join(" ");
      if (argsStr.includes("rev-parse --abbrev-ref")) {
        callback(null, { stdout: "main\n", stderr: "" });
      } else if (argsStr.includes("fetch")) {
        callback(null, { stdout: "", stderr: "" });
      } else if (argsStr.includes("rev-parse HEAD")) {
        callback(null, { stdout: "local_hash\n", stderr: "" });
      } else if (argsStr.includes("rev-parse origin/main")) {
        callback(null, { stdout: "remote_hash\n", stderr: "" });
      } else if (argsStr.includes("merge-base --is-ancestor")) {
        callback(null, { stdout: "", stderr: "" });
      } else {
        callback(new Error(`Unknown args: ${argsStr}`));
      }
    });

    const result = await checkGitUpdate();
    expect(result.updateAvailable).toBe(true);
    expect(result.localHash).toBe("local_hash");
    expect(result.remoteHash).toBe("remote_hash");
  });

  it("applies git pull and checks for dependency installation", async () => {
    const mockSend = vi.fn();
    const event = { sender: { send: mockSend } };

    let callCount = 0;
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callCount++;
      const argsStr = args.join(" ");
      if (argsStr.includes("rev-parse --abbrev-ref")) {
        callback(null, { stdout: "main\n", stderr: "" });
      } else if (argsStr.includes("rev-parse HEAD")) {
        callback(null, { stdout: callCount < 4 ? "local_hash\n" : "remote_hash\n", stderr: "" });
      } else if (argsStr.includes("pull")) {
        callback(null, { stdout: "Already up to date\n", stderr: "" });
      } else if (argsStr.includes("diff --name-only")) {
        callback(null, { stdout: "src/main.js\npackage.json\n", stderr: "" });
      } else if (cmd === "npm" || cmd === "npm.cmd") {
        callback(null, { stdout: "npm install completed\n", stderr: "" });
      } else {
        callback(new Error(`Unknown args: ${argsStr}`));
      }
    });

    const result = await applyGitUpdate(event);
    expect(result.success).toBe(true);
    expect(result.npmInstalled).toBe(true);

    expect(mockSend).toHaveBeenCalledWith("git:update-progress", { status: "pulling", detail: "正在从 GitHub 拉取最新代码..." });
    expect(mockSend).toHaveBeenCalledWith("git:update-progress", { status: "checking_deps", detail: "检查依赖配置文件变更..." });
    expect(mockSend).toHaveBeenCalledWith("git:update-progress", { status: "installing_deps", detail: "检测到依赖更新，正在下载依赖库 (npm install)..." });
    expect(mockSend).toHaveBeenCalledWith("git:update-progress", { status: "completed", detail: "更新成功，且已安装最新依赖库！请重启应用。" });
  });

  it("applies git pull with forceReset option and executes reset and clean", async () => {
    const mockSend = vi.fn();
    const event = { sender: { send: mockSend } };
    const executedCommands = [];

    execFile.mockImplementation((cmd, args, opts, callback) => {
      const argsStr = args.join(" ");
      executedCommands.push(`${cmd} ${argsStr}`);
      if (argsStr.includes("rev-parse --abbrev-ref")) {
        callback(null, { stdout: "main\n", stderr: "" });
      } else if (argsStr.includes("rev-parse HEAD")) {
        callback(null, { stdout: "hash\n", stderr: "" });
      } else if (argsStr.includes("reset --hard")) {
        callback(null, { stdout: "HEAD is now at hash\n", stderr: "" });
      } else if (argsStr.includes("clean -fd")) {
        callback(null, { stdout: "Removing files\n", stderr: "" });
      } else if (argsStr.includes("pull")) {
        callback(null, { stdout: "Already up to date\n", stderr: "" });
      } else {
        callback(new Error(`Unknown args: ${argsStr}`));
      }
    });

    const result = await applyGitUpdate(event, { forceReset: true });
    expect(result.success).toBe(true);

    const hasReset = executedCommands.some(cmd => cmd.includes("reset --hard HEAD"));
    const hasClean = executedCommands.some(cmd => cmd.includes("clean -fd"));
    expect(hasReset).toBe(true);
    expect(hasClean).toBe(true);

    expect(mockSend).toHaveBeenCalledWith("git:update-progress", { status: "pulling", detail: "正在丢弃本地修改并重置工作区..." });
    expect(mockSend).toHaveBeenCalledWith("git:update-progress", { status: "pulling", detail: "正在从 GitHub 拉取最新代码..." });
  });
});
