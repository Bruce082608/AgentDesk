import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankSession, loadChatSessions, safeHref } from "./utils";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    }
  });
}

describe("safeHref", () => {
  it("allows common safe URL protocols", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("mailto:test@example.com")).toBe("mailto:test@example.com");
  });

  it("blocks script and local file URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("file:///etc/passwd")).toBe("");
  });
});

describe("chat session storage", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("loads normalized legacy localStorage sessions", () => {
    const session = {
      ...createBlankSession("/tmp/workspace"),
      title: "Example",
      messages: [{ role: "user" as const, content: "hello" }]
    };
    localStorage.setItem("agent-chat-sessions", JSON.stringify([session]));
    const loaded = loadChatSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe("Example");
    expect(loaded[0].workspace).toBe("/tmp/workspace");
    expect(loaded[0].messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("drops malformed stored messages", () => {
    localStorage.setItem("agent-chat-sessions", JSON.stringify([
      {
        id: "s1",
        title: "Bad",
        messages: [
          { role: "tool", content: "orphaned" },
          { role: "assistant", content: "kept" }
        ]
      }
    ]));
    const loaded = loadChatSessions();
    expect(loaded[0].messages).toEqual([{ role: "assistant", content: "kept" }]);
  });
});
