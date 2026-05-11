import { describe, expect, it } from "vitest";
import {
  validateAgentSendPayload,
  validateAttachmentPathsPayload,
  validateBackgroundTaskPayload,
  validateDesktopNotificationPayload,
  validateFileReadPayload,
  validateOpenPathsPayload,
  validateTokenCountPayload
} from "./ipc-validation.js";

describe("IPC payload validation", () => {
  it("accepts a normal agent request without trimming message content", () => {
    const payload = validateAgentSendPayload({
      requestId: "request-1",
      sessionId: "session-1",
      language: "zh",
      workspace: "C:/work/project",
      input: "  keep user spacing  ",
      providerConfig: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        summaryModel: "deepseek-v4-flash",
        apiKey: "",
        temperature: 0.2,
        maxTokens: 32768,
        contextTokens: 1000000,
        maxAgentSteps: 64,
        thinkingMode: "enabled",
        reasoningEffort: "max"
      },
      messages: [{ role: "user", content: "  keep history spacing  " }],
      attachments: [{ path: "notes.txt", content: "  keep attachment spacing  " }]
    });

    expect(payload.input).toBe("  keep user spacing  ");
    expect(payload.messages[0].content).toBe("  keep history spacing  ");
    expect(payload.attachments[0].content).toBe("  keep attachment spacing  ");
  });

  it("rejects malformed renderer payloads before they reach main-process services", () => {
    expect(() => validateFileReadPayload({ workspace: "", path: "README.md" })).toThrow(/Invalid IPC payload/);
    expect(() => validateTokenCountPayload({ messages: [{ role: "admin", content: "x" }], input: "", attachments: [] })).toThrow(/Invalid IPC payload/);
    expect(() => validateAgentSendPayload({ requestId: "x" })).toThrow(/Invalid IPC payload/);
  });

  it("validates dropped attachment paths without accepting renderer file contents", () => {
    expect(validateAttachmentPathsPayload({ paths: ["C:/work/a.txt", "C:/work/b.txt"] })).toEqual({
      paths: ["C:/work/a.txt", "C:/work/b.txt"]
    });
    expect(() => validateAttachmentPathsPayload({ paths: [{ path: "C:/work/a.txt", content: "renderer content" }] })).toThrow(/Invalid IPC payload/);
  });

  it("validates desktop integration payloads", () => {
    expect(validateDesktopNotificationPayload({ title: "Done", body: "Task completed" })).toEqual({
      title: "Done",
      body: "Task completed",
      silent: false
    });
    expect(validateOpenPathsPayload({ paths: ["C:/work/a.txt"] })).toEqual({ paths: ["C:/work/a.txt"] });
    expect(validateBackgroundTaskPayload({ title: "Ping", delayMinutes: 5, intervalMinutes: 0 })).toMatchObject({
      title: "Ping",
      delayMinutes: 5,
      intervalMinutes: 0
    });
  });
});
