import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Helper to run git in the app directory
async function runGit(args) {
  const appPath = app.getAppPath();
  const { stdout } = await execFileAsync("git", args, {
    cwd: appPath,
    windowsHide: true,
    maxBuffer: 2_000_000
  });
  return stdout.trim();
}

/**
 * Checks if the local repository is out of sync (behind) the remote repository.
 */
export async function checkGitUpdate() {
  try {
    // 1. Get current branch name
    const branchName = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branchName || branchName === "HEAD") {
      return { updateAvailable: false, reason: "Not on a branch" };
    }

    // 2. Fetch the remote tracking branch
    await runGit(["fetch", "origin", branchName]);

    // 3. Get local and remote hashes
    const localHash = await runGit(["rev-parse", "HEAD"]);
    const remoteHash = await runGit(["rev-parse", `origin/${branchName}`]);

    if (localHash === remoteHash) {
      return { updateAvailable: false, localHash, remoteHash, branch: branchName };
    }

    // 4. Check if the remote branch has commits that are not in our HEAD
    let isBehind = false;
    try {
      // If HEAD is an ancestor of remote, then we are behind.
      await runGit(["merge-base", "--is-ancestor", "HEAD", `origin/${branchName}`]);
      isBehind = true;
    } catch {
      // If merge-base fails or returns non-zero, check commit count difference
      const aheadCount = await runGit(["rev-list", "--count", `HEAD..origin/${branchName}`]);
      if (parseInt(aheadCount, 10) > 0) {
        isBehind = true;
      }
    }

    return {
      updateAvailable: isBehind,
      localHash,
      remoteHash,
      branch: branchName
    };
  } catch (error) {
    console.error("Failed to check git updates:", error);
    return { updateAvailable: false, error: error.message };
  }
}

/**
 * Applies the git update by running git pull and optionally npm install.
 */
export async function applyGitUpdate(event) {
  const sendProgress = (status, detail) => {
    if (event && event.sender) {
      event.sender.send("git:update-progress", { status, detail });
    }
    import("./web-server.js").then(({ broadcastSseEvent }) => {
      broadcastSseEvent("git:update-progress", { status, detail });
    }).catch(() => {});
  };

  try {
    const appPath = app.getAppPath();
    const branchName = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const oldHash = await runGit(["rev-parse", "HEAD"]);

    sendProgress("pulling", "正在从 GitHub 拉取最新代码...");
    await runGit(["pull", "origin", branchName]);

    const newHash = await runGit(["rev-parse", "HEAD"]);

    if (oldHash === newHash) {
      sendProgress("completed", "代码已是最新。");
      return { success: true, npmInstalled: false };
    }

    sendProgress("checking_deps", "检查依赖配置文件变更...");
    // Check if package.json or package-lock.json changed
    const diffFiles = await runGit(["diff", "--name-only", oldHash, newHash]);
    const depsChanged = diffFiles.split(/\r?\n/).some(file =>
      file.includes("package.json") || file.includes("package-lock.json")
    );

    let npmInstalled = false;
    if (depsChanged) {
      sendProgress("installing_deps", "检测到依赖更新，正在下载依赖库 (npm install)...");
      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
      await execFileAsync(npmCmd, ["install"], {
        cwd: appPath,
        windowsHide: true
      });
      npmInstalled = true;
      sendProgress("completed", "更新成功，且已安装最新依赖库！请重启应用。");
    } else {
      sendProgress("completed", "更新成功！代码已同步，依赖库无变化。请重启应用。");
    }

    return { success: true, npmInstalled };
  } catch (error) {
    console.error("Failed to apply git updates:", error);
    sendProgress("error", `更新失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}
