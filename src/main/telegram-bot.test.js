import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { startTelegramBot, stopTelegramBot } from "./telegram-bot.js";
import { runAgentTurn } from "./agent.js";
import { readAttachmentFiles } from "./attachments.js";

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([])
  },
  desktopCapturer: {
    getSources: vi.fn().mockResolvedValue([
      {
        thumbnail: {
          toPNG: () => Buffer.from("mock-png-data")
        }
      }
    ])
  },
  screen: {
    getPrimaryDisplay: () => ({
      size: { width: 1920, height: 1080 }
    })
  }
}));

vi.mock("./agent.js", () => ({
  runAgentTurn: vi.fn().mockImplementation((payload, emit) => {
    return Promise.resolve();
  }),
  resumeAgentContinuation: vi.fn().mockResolvedValue()
}));

vi.mock("./persistence.js", () => ({
  loadPersistedSessions: vi.fn().mockResolvedValue([{ id: "telegram-remote", workspace: "C:/mock/project", messages: [] }]),
  savePersistedSessions: vi.fn().mockResolvedValue()
}));

vi.mock("./config.js", () => ({
  loadAppConfig: vi.fn().mockResolvedValue({ model: "deepseek-chat" })
}));

vi.mock("./attachments.js", () => ({
  readAttachmentFiles: vi.fn().mockResolvedValue([{
    path: "C:/temp/mock_test.py",
    content: "print('hello')",
    status: "ready"
  }])
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
    promises: {
      writeFile: vi.fn().mockResolvedValue()
    }
  }
}));

describe("Telegram Bot Remote Control", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopTelegramBot();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not start polling when telegramEnabled is false", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: [] })
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: false,
      telegramBotToken: "123456:ABCDEF",
      telegramAllowedUserId: "98765432"
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start polling when token or user ID is missing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "",
      telegramAllowedUserId: ""
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts long polling getUpdates on startTelegramBot", async () => {
    let resolveUpdates;
    const promise = new Promise((resolve) => {
      resolveUpdates = resolve;
    });

    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("getUpdates")) {
        resolveUpdates();
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({ ok: true, result: [] })
            });
          }, 100);
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await promise;
    expect(fetchMock).toHaveBeenCalled();
    const hasGetUpdatesCall = fetchMock.mock.calls.some(call => call[0].includes("getUpdates"));
    expect(hasGetUpdatesCall).toBe(true);
  });

  it("processes message with document and caption immediately", async () => {
    let hasReturnedUpdate = false;
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 1001,
                  message: {
                    chat: { id: 12345 },
                    from: { id: 98765432 },
                    document: {
                      file_id: "file_doc_123",
                      file_name: "test.py"
                    },
                    caption: "帮我修改这段代码"
                  }
                }
              ]
            })
          });
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({ ok: true, result: [] })
            });
          }, 100);
        });
      }
      if (url.includes("getFile")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: { file_path: "docs/test.py" } })
        });
      }
      if (url.includes("docs/test.py")) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(10))
        });
      }
      // fallback for other calls like sendMessage
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 999 } })
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    // Let the long polling step run
    await vi.waitFor(() => {
      expect(runAgentTurn).toHaveBeenCalled();
    });

    expect(readAttachmentFiles).toHaveBeenCalled();
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "帮我修改这段代码",
        messages: [],
        permissionMode: "full",
        attachments: expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringContaining("test.py"),
            content: "print('hello')"
          })
        ])
      }),
      expect.any(Function)
    );
  });

  it("processes message with document and no caption by queuing it", async () => {
    let hasReturnedUpdate = false;
    let hasReturnedTextUpdate = false;
    
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 1001,
                  message: {
                    chat: { id: 12345 },
                    from: { id: 98765432 },
                    document: {
                      file_id: "file_doc_123",
                      file_name: "test.py"
                    }
                  }
                }
              ]
            })
          });
        }
        if (!hasReturnedTextUpdate) {
          hasReturnedTextUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 1002,
                  message: {
                    chat: { id: 12345 },
                    from: { id: 98765432 },
                    text: "帮我重构代码"
                  }
                }
              ]
            })
          });
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({ ok: true, result: [] })
            });
          }, 100);
        });
      }
      if (url.includes("getFile")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: { file_path: "docs/test.py" } })
        });
      }
      if (url.includes("docs/test.py")) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(10))
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 999 } })
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await vi.waitFor(() => {
      expect(runAgentTurn).toHaveBeenCalled();
    });

    expect(readAttachmentFiles).toHaveBeenCalled();
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "帮我重构代码",
        messages: [],
        permissionMode: "full",
        attachments: expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringContaining("test.py"),
            content: "print('hello')"
          })
        ])
      }),
      expect.any(Function)
    );
  });

  it("processes plan_update event and updates checklist message", async () => {
    let hasReturnedUpdate = false;
    let capturedEmit = null;

    runAgentTurn.mockImplementation((payload, emit) => {
      capturedEmit = emit;
      return Promise.resolve();
    });

    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 1001,
                  message: {
                    chat: { id: 12345 },
                    from: { id: 98765432 },
                    text: "帮我做一个计划"
                  }
                }
              ]
            })
          });
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({ ok: true, result: [] })
            });
          }, 100);
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 888 } })
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await vi.waitFor(() => {
      expect(capturedEmit).not.toBeNull();
    });

    // 1. Emit plan_update with initial plan
    capturedEmit({
      type: "plan_update",
      items: [
        { step: "Step 1", status: "completed" },
        { step: "Step 2", status: "in_progress" },
        { step: "Step 3", status: "pending" }
      ]
    });

    await vi.waitFor(() => {
      // Find the fetch call for sendMessage
      const sendMessageCall = fetchMock.mock.calls.find(call => {
        if (!call[0].includes("sendMessage")) return false;
        try {
          const body = JSON.parse(call[1].body);
          return body.text.includes("执行计划");
        } catch {
          return false;
        }
      });
      expect(sendMessageCall).toBeDefined();
      const body = JSON.parse(sendMessageCall[1].body);
      expect(body.text).toContain("✅ Step 1");
      expect(body.text).toContain("⏳ Step 2");
      expect(body.text).toContain("⬜ Step 3");
    });

    // Flush microtasks and promise chain to ensure planMessageId is written
    await vi.advanceTimersByTimeAsync(100);

    // Reset calls to focus on editMessageText check
    fetchMock.mockClear();

    // 2. Emit plan_update with updated plan
    capturedEmit({
      type: "plan_update",
      items: [
        { step: "Step 1", status: "completed" },
        { step: "Step 2", status: "completed" },
        { step: "Step 3", status: "in_progress" }
      ]
    });

    await vi.waitFor(() => {
      // Find the fetch call for editMessageText
      const editMessageCall = fetchMock.mock.calls.find(call => {
        if (!call[0].includes("editMessageText")) return false;
        try {
          const body = JSON.parse(call[1].body);
          return body.text.includes("执行计划");
        } catch {
          return false;
        }
      });
      expect(editMessageCall).toBeDefined();
      const body = JSON.parse(editMessageCall[1].body);
      expect(body.text).toContain("✅ Step 1");
      expect(body.text).toContain("✅ Step 2");
      expect(body.text).toContain("⏳ Step 3");
    });
  });

  it("processes /clear command and clears attachments", async () => {
    let hasReturnedUpdate = false;
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 2000,
                  message: {
                    chat: { id: 11111 },
                    from: { id: 98765432 },
                    text: "/clear"
                  }
                }
              ]
            })
          });
        }
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await vi.waitFor(() => {
      const sendMessageCall = fetchMock.mock.calls.find(call => {
        if (!call[0].includes("sendMessage")) return false;
        const body = JSON.parse(call[1].body);
        return body.text.includes("已清空当前所有待处理的附件队列");
      });
      expect(sendMessageCall).toBeDefined();
    });
  });

  it("processes /workspace with directory path to change workspace", async () => {
    let hasReturnedUpdate = false;
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 3000,
                  message: {
                    chat: { id: 11111 },
                    from: { id: 98765432 },
                    text: "/workspace /mock/path"
                  }
                }
              ]
            })
          });
        }
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await vi.waitFor(() => {
      const sendMessageCall = fetchMock.mock.calls.find(call => {
        if (!call[0].includes("sendMessage")) return false;
        const body = JSON.parse(call[1].body);
        return body.text.includes("已成功将控制工作区切换为");
      });
      expect(sendMessageCall).toBeDefined();
    });
  });

  it("retries sendMessage without parse_mode if it fails with Markdown", async () => {
    let hasReturnedUpdate = false;
    let capturedEmit = null;

    runAgentTurn.mockImplementation((payload, emit) => {
      capturedEmit = emit;
      return Promise.resolve();
    });

    const fetchCalls = [];
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 4000,
                  message: {
                    chat: { id: 12345 },
                    from: { id: 98765432 },
                    text: "trigger_error"
                  }
                }
              ]
            })
          });
        }
        return new Promise(() => {});
      }

      if (init && init.body) {
        try {
          fetchCalls.push({ url, body: JSON.parse(init.body) });
        } catch {}
      }

      if (url.includes("sendMessage")) {
        const body = JSON.parse(init.body);
        if (body.parse_mode === "Markdown") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: false, description: "Bad Request: can't parse entities" })
          });
        } else {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, result: { message_id: 123 } })
          });
        }
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 123 } })
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await vi.waitFor(() => {
      expect(capturedEmit).not.toBeNull();
    });

    // Emit error event
    capturedEmit({
      type: "error",
      message: "An error occurred with_underscores_and_[brackets]"
    });

    // Advance timer to trigger cleanUpStreams and sendTelegramMessage
    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => {
      const retryCall = fetchCalls.find(c => c.url.includes("sendMessage") && !c.body.parse_mode && c.body.text.includes("运行出错"));
      expect(retryCall).toBeDefined();
      expect(retryCall.body.text).toContain("An error occurred with\\_underscores\\_and\\_\\[brackets\\]");
    });
  });

  it("retries editTelegramMessage without parse_mode if it fails with Markdown", async () => {
    let hasReturnedUpdate = false;
    let capturedEmit = null;

    runAgentTurn.mockImplementation((payload, emit) => {
      capturedEmit = emit;
      return Promise.resolve();
    });

    const editCalls = [];
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 5000,
                  message: {
                    chat: { id: 12345 },
                    from: { id: 98765432 },
                    text: "trigger_stream"
                  }
                }
              ]
            })
          });
        }
        return new Promise(() => {});
      }

      if (url.includes("editMessageText")) {
        const body = JSON.parse(init.body);
        editCalls.push(body);
        if (body.parse_mode === "Markdown") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: false, description: "Bad Request: can't parse entities" })
          });
        } else {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, result: { message_id: 123 } })
          });
        }
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 123 } })
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await vi.waitFor(() => {
      expect(capturedEmit).not.toBeNull();
    });

    // 1. Emit status to set streamMessageId
    capturedEmit({ type: "status", message: "Starting" });
    await vi.advanceTimersByTimeAsync(2000);

    // 2. Emit stream_delta with some problematic text
    capturedEmit({ type: "stream_delta", text: "text_with_unmatched_markdown" });
    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => {
      const retryCall = editCalls.find(c => !c.parse_mode);
      expect(retryCall).toBeDefined();
      expect(retryCall.text).toContain("text_with_unmatched_markdown");
    });
  });

  it("processes /screenshot command and sends captured image", async () => {
    let hasReturnedUpdate = false;
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (url.includes("getUpdates")) {
        if (!hasReturnedUpdate) {
          hasReturnedUpdate = true;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 6000,
                  message: {
                    chat: { id: 12345 },
                    from: { id: 98765432 },
                    text: "/screenshot"
                  }
                }
              ]
            })
          });
        }
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { message_id: 123 } }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    startTelegramBot({
      telegramEnabled: true,
      telegramBotToken: "123456:TESTTOKEN",
      telegramAllowedUserId: "98765432"
    });

    await vi.waitFor(() => {
      const sendPhotoCall = fetchMock.mock.calls.find(call => call[0].includes("sendPhoto"));
      expect(sendPhotoCall).toBeDefined();
      expect(sendPhotoCall[1].body).toBeInstanceOf(FormData);
    });
  });
});
