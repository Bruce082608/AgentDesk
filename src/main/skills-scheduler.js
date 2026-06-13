import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadPersistedSkills, savePersistedSkills, loadPersistedSessions } from "./persistence.js";
import { loadAppConfig } from "./config.js";
import { runAgentTurn } from "./agent.js";

let timers = new Map();

export async function initSkillsScheduler() {
  await syncSkillsScheduler().catch((err) => console.error("[Skills Scheduler] Init error:", err));
}

export async function syncSkillsScheduler() {
  // Clear all existing timers
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();

  const skills = await loadPersistedSkills().catch(() => []);
  const now = Date.now();
  let changed = false;

  for (const skill of skills) {
    if (!skill.enabled) continue;

    // If runAt is 0, schedule it to run in 5 seconds to prevent execution spikes on startup
    if (skill.runAt === 0) {
      skill.runAt = now + 5000;
      changed = true;
    } else if (skill.runAt < now) {
      // If it missed its window (e.g. app was closed), run it in 5 seconds
      skill.runAt = now + 5000;
      changed = true;
    }

    scheduleSkill(skill);
  }

  if (changed) {
    await savePersistedSkills(skills).catch(() => {});
  }
}

function scheduleSkill(skill) {
  const delay = Math.max(0, skill.runAt - Date.now());
  const timer = setTimeout(async () => {
    timers.delete(skill.id);
    await executeSkill(skill);
  }, delay);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
  timers.set(skill.id, timer);
}

async function executeSkill(skill) {
  console.log(`[Skills Scheduler] Executing skill: ${skill.title} (${skill.id})`);
  const now = Date.now();

  // Run the skill based on its type
  if (skill.type === "prompt") {
    void runPromptSkill(skill);
  } else if (skill.type === "code") {
    void runCodeSkill(skill);
  }

  // Update schedule
  const skills = await loadPersistedSkills().catch(() => []);
  const idx = skills.findIndex(s => s.id === skill.id);
  if (idx !== -1) {
    skills[idx].lastRunAt = now;
    if (skills[idx].intervalMinutes > 0) {
      skills[idx].runAt = now + skills[idx].intervalMinutes * 60_000;
      skills[idx].updatedAt = now;
      await savePersistedSkills(skills).catch(() => {});
      scheduleSkill(skills[idx]);
    } else {
      skills[idx].enabled = false;
      skills[idx].updatedAt = now;
      await savePersistedSkills(skills).catch(() => {});
    }
  }
}

async function runPromptSkill(skill) {
  const config = await loadAppConfig().catch(() => ({}));
  const sessions = await loadPersistedSessions().catch(() => []);
  const session = sessions.find(s => s.id === "telegram-remote") || sessions[0];
  const workspace = session?.workspace || process.cwd();

  const requestId = randomUUID();
  const emit = createBackgroundEmit(skill.title);

  try {
    await runAgentTurn(
      {
        requestId,
        sessionId: "telegram-remote",
        workspace,
        input: skill.prompt,
        providerConfig: config,
        messages: [],
        attachments: [],
        permissionMode: "full",
        language: "zh"
      },
      emit
    );
  } catch (error) {
    emit({ type: "error", message: error.message });
  }
}

async function runCodeSkill(skill) {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `skill_${skill.id}_${Date.now()}.js`);
  const emit = createBackgroundEmit(skill.title);

  try {
    await fs.writeFile(tempFilePath, skill.code, "utf8");
    const child = spawn("node", [tempFilePath]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      // Clean up temp file
      fs.unlink(tempFilePath).catch(() => {});

      if (code === 0) {
        emit({ type: "stream_delta", text: stdout || "执行成功，无标准输出。" });
        emit({ type: "done" });
      } else {
        emit({ type: "error", message: stderr || `执行失败，退出码: ${code}` });
      }
    });
  } catch (error) {
    fs.unlink(tempFilePath).catch(() => {});
    emit({ type: "error", message: error.message });
  }
}

function createBackgroundEmit(skillTitle) {
  let textBuffer = "";
  return async (event) => {
    if (event.type === "stream_delta") {
      textBuffer += event.text;
    } else if (event.type === "done") {
      try {
        const { sendTelegramPushNotification } = await import("./telegram-bot.js");
        await sendTelegramPushNotification(`📋 **[技能运行成功: ${skillTitle}]**\n\n${textBuffer}`);
      } catch (err) {
        console.error("Failed to send skill notification:", err);
      }
    } else if (event.type === "error") {
      try {
        const { sendTelegramPushNotification } = await import("./telegram-bot.js");
        await sendTelegramPushNotification(`❌ **[技能运行失败: ${skillTitle}]**\n\n错误信息: ${event.message}`);
      } catch (err) {
        console.error("Failed to send skill error:", err);
      }
    }
  };
}
