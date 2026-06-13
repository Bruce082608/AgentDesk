import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { initSkillsScheduler, syncSkillsScheduler } from "./skills-scheduler.js";
import { loadPersistedSkills, savePersistedSkills } from "./persistence.js";
import { runAgentTurn } from "./agent.js";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { sendTelegramPushNotification } from "./telegram-bot.js";

vi.mock("./persistence.js", () => ({
  loadPersistedSkills: vi.fn(),
  savePersistedSkills: vi.fn().mockResolvedValue({ ok: true }),
  loadPersistedSessions: vi.fn().mockResolvedValue([{ id: "telegram-remote", workspace: "/mock/workspace" }])
}));

vi.mock("./config.js", () => ({
  loadAppConfig: vi.fn().mockResolvedValue({ apiKey: "mock-key" })
}));

vi.mock("./agent.js", () => ({
  runAgentTurn: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

vi.mock("./telegram-bot.js", () => ({
  sendTelegramPushNotification: vi.fn().mockResolvedValue({ ok: true })
}));

describe("Skills Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules enabled skills and runs them when due", async () => {
    const mockSkills = [
      {
        id: "skill_1",
        title: "Test Prompt Skill",
        description: "A test prompt skill",
        enabled: true,
        type: "prompt",
        prompt: "Check the price of BTC",
        intervalMinutes: 10,
        runAt: Date.now() + 60000,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: "skill_2",
        title: "Disabled Skill",
        description: "Should not be scheduled",
        enabled: false,
        type: "prompt",
        prompt: "Check the price of ETH",
        intervalMinutes: 10,
        runAt: Date.now() + 60000,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];

    vi.mocked(loadPersistedSkills).mockResolvedValue(mockSkills);

    await initSkillsScheduler();

    // Verify it doesn't run agent turn immediately
    expect(runAgentTurn).not.toHaveBeenCalled();

    // Fast-forward time by 60 seconds
    await vi.advanceTimersByTimeAsync(65000);

    // Verify runAgentTurn was triggered for skill_1
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "telegram-remote",
        input: "Check the price of BTC",
        permissionMode: "full"
      }),
      expect.any(Function)
    );
  });

  it("handles code skills by writing to temp file and spawning node process", async () => {
    const mockSkills = [
      {
        id: "skill_code",
        title: "Test Code Skill",
        description: "A test code skill",
        enabled: true,
        type: "code",
        code: "console.log('hello from test code')",
        intervalMinutes: 5,
        runAt: Date.now() + 30000,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];

    vi.mocked(loadPersistedSkills).mockResolvedValue(mockSkills);

    // Setup child process spawn mock
    const mockStdoutOn = vi.fn();
    const mockStderrOn = vi.fn();
    const mockOn = vi.fn();

    const mockChildProcess = {
      stdout: { on: mockStdoutOn },
      stderr: { on: mockStderrOn },
      on: mockOn
    };

    vi.mocked(spawn).mockReturnValue(mockChildProcess);

    // Capture the write file call
    const writeFileSpy = vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
    const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

    await initSkillsScheduler();

    // Advance time to run the code skill
    await vi.advanceTimersByTimeAsync(35000);

    // Verify file was written
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining("skill_skill_code"),
      "console.log('hello from test code')",
      "utf8"
    );

    // Verify child process was spawned
    expect(spawn).toHaveBeenCalledWith("node", [expect.stringContaining("skill_skill_code")]);

    // Simulate stdout data
    const stdoutListener = mockStdoutOn.mock.calls.find(c => c[0] === "data")[1];
    stdoutListener(Buffer.from("Output data from code skill\n"));

    // Simulate exit/close event
    const closeListener = mockOn.mock.calls.find(c => c[0] === "close")[1];
    closeListener(0);

    // Flush pending promises/microtasks
    await vi.advanceTimersByTimeAsync(50);

    // Verify notification was sent
    expect(sendTelegramPushNotification).toHaveBeenCalledWith(
      expect.stringContaining("Output data from code skill")
    );
    expect(sendTelegramPushNotification).toHaveBeenCalledWith(
      expect.stringContaining("Test Code Skill")
    );

    // Verify temp file was cleaned up
    expect(unlinkSpy).toHaveBeenCalled();
  });
});
