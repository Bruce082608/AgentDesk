import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github.css";
import type { ChatMessage, ChatToolCall, WorkspaceTreeItem } from "./global";
import type { Language } from "./i18n";
import type { AttachedFile, ChatSession, TokenUsageStats } from "./types";
import { MAX_SAVED_SESSIONS, emptyTokenUsage } from "./types";
import { translations } from "./i18n";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

/* ---- Session persistence ---- */

export function normalizeTokenUsage(value: unknown): TokenUsageStats {
  const data = value && typeof value === "object" ? value as Partial<TokenUsageStats> : {};
  return {
    promptTokens: Number(data.promptTokens) || 0,
    completionTokens: Number(data.completionTokens) || 0,
    totalTokens: Number(data.totalTokens) || 0,
    requests: Number(data.requests) || 0
  };
}

export function loadChatSessions(): ChatSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("agent-chat-sessions") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session) => typeof session?.id === "string")
      .map((session) => ({
        id: session.id,
        title: String(session.title || translations.zh.untitledChat),
        titleEdited: Boolean(session.titleEdited),
        workspace: String(session.workspace || ""),
        messages: normalizeStoredMessages(session.messages),
        tokenUsage: normalizeTokenUsage(session.tokenUsage),
        createdAt: Number(session.createdAt) || Date.now(),
        updatedAt: Number(session.updatedAt) || Date.now()
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SAVED_SESSIONS);
  } catch {
    return [];
  }
}

function normalizeStoredMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ChatMessage[] = [];
  for (const item of value) {
    const normalized = normalizeStoredMessage(item);
    if (normalized) messages.push(normalized);
  }
  return messages;
}

function normalizeStoredMessage(value: unknown): ChatMessage | null {
  const message = value && typeof value === "object" ? value as Partial<ChatMessage> : null;
  if (!message || !message.role || !["user", "assistant", "tool", "system"].includes(message.role)) return null;
  const normalized: ChatMessage = {
    role: message.role,
    content: String(message.content || "")
  };
  if (typeof message.reasoning === "string") normalized.reasoning = message.reasoning;
  const toolCalls = normalizeStoredToolCalls(message.tool_calls);
  if (toolCalls.length > 0) normalized.tool_calls = toolCalls;
  if (typeof message.tool_call_id === "string" && message.tool_call_id.trim()) normalized.tool_call_id = message.tool_call_id;
  if (typeof message.name === "string" && message.name.trim()) normalized.name = message.name;
  if (normalized.role === "tool" && !normalized.tool_call_id) return null;
  if (!normalized.content && normalized.role !== "assistant") return null;
  if (!normalized.content && !normalized.reasoning && !normalized.tool_calls?.length) return null;
  return normalized;
}

function normalizeStoredToolCalls(value: unknown): ChatToolCall[] {
  if (!Array.isArray(value)) return [];
  const toolCalls: ChatToolCall[] = [];
  for (const toolCall of value) {
    if (!toolCall || typeof toolCall !== "object") continue;
    const raw = toolCall as ChatToolCall;
    const id = String(raw.id || "").trim();
    if (!id) continue;
    toolCalls.push({
      id,
      type: raw.type || "function",
      function: {
        name: String(raw.function?.name || ""),
        arguments: String(raw.function?.arguments || "")
      }
    });
  }
  return toolCalls;
}

export function saveChatSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem("agent-chat-sessions", JSON.stringify(sessions));
  } catch (error) {
    try {
      localStorage.setItem("agent-chat-sessions", JSON.stringify(compactSessionsForStorage(sessions)));
      console.warn("Chat sessions were compacted before saving.", error);
    } catch (fallbackError) {
      console.warn("Failed to save chat sessions.", fallbackError);
    }
  }
}

function compactSessionsForStorage(sessions: ChatSession[]): ChatSession[] {
  return sessions.slice(0, 10).map((session) => ({
    ...session,
    messages: session.messages.slice(-40).map((message) => ({
      ...message,
      content: String(message.content || "").slice(-20000),
      reasoning: message.reasoning ? String(message.reasoning).slice(-8000) : undefined,
      tool_calls: normalizeStoredToolCalls(message.tool_calls)
    }))
  }));
}

export function deriveSessionTitle(messages: ChatMessage[], fallback: string) {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUserMessage) return fallback || translations.zh.newChatTitle;
  return firstUserMessage.replace(/\s+/g, " ").slice(0, 42);
}

export function createBlankSession(workspace = ""): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: translations.zh.newChatTitle,
    titleEdited: false,
    workspace,
    messages: [],
    tokenUsage: emptyTokenUsage(),
    createdAt: now,
    updatedAt: now
  };
}

/* ---- Formatting ---- */

export function formatSessionTime(timestamp: number, language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

export function formatInteger(value: number, language: Language) {
  return Math.round(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US");
}

export function formatBalanceAmount(value: string, currency: string, language: Language) {
  const amount = Number(value);
  const displayValue = Number.isFinite(amount)
    ? amount.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      })
    : value;
  return `${currency} ${displayValue}`;
}

export function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(localStorage.getItem(key));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function estimatePendingInputTokens(messages: ChatMessage[], input: string, attachments: AttachedFile[], currentTokenCount: number) {
  const hasPendingInput = Boolean(input.trim() || attachments.length > 0 || messages.length === 0);
  return hasPendingInput ? currentTokenCount : 0;
}

/* ---- File tree helpers ---- */

export function isTreeItemVisible(item: WorkspaceTreeItem, expandedDirs: Set<string>) {
  const parts = item.path.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!expandedDirs.has(current)) return false;
  }
  return true;
}

export function getInitialExpandedDirs(items: WorkspaceTreeItem[]) {
  const expanded = new Set<string>();
  for (const item of items) {
    if (item.type === "directory" && item.depth === 0) expanded.add(item.path);
  }
  return expanded;
}

export function hasTreeChildren(items: WorkspaceTreeItem[], directoryPath: string) {
  const prefix = `${directoryPath}/`;
  return items.some((item) => item.path.startsWith(prefix));
}

/* ---- Activity events ---- */

export function trimActivityEvents<T extends { id: string }>(events: T[]): T[] {
  return events.length > 5000 ? events.slice(-5000) : events;
}

export function filterActivityEvents(
  events: { id: string; title: string; body: string; kind: string }[],
  filter: "all" | "tool" | "error" | "approval" | "system",
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();
  return events.filter((event) => {
    if (!matchesActivityFilter(event, filter)) return false;
    if (!normalizedQuery) return true;
    return `${event.title}\n${event.body}\n${event.kind}`.toLowerCase().includes(normalizedQuery);
  });
}

function matchesActivityFilter(
  event: { kind: string },
  filter: "all" | "tool" | "error" | "approval" | "system"
) {
  if (filter === "all") return true;
  if (filter === "tool") return event.kind === "tool";
  if (filter === "error") return event.kind === "error";
  if (filter === "approval") return event.kind === "patch";
  return event.kind === "status" || event.kind === "model";
}

/* ---- Tool draft ---- */

export function formatToolDraftText(value: string) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.patch === "string") return parsed.patch;
    if (typeof parsed.content === "string") return parsed.content;
    if (typeof parsed.command === "string") return parsed.command;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw
      .replace(/\\r\\n|\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
}

/* ---- Code / Markdown helpers ---- */

export function safeHref(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function languageFromClassName(className: string) {
  const match = className.match(/(?:^|\s)language-([^\s]+)/);
  return match?.[1] || "";
}

export function extractReactText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractReactText).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractReactText(props.children);
  }
  return "";
}

function normalizeCodeLanguage(language: string) {
  const value = String(language || "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    ps1: "powershell",
    py: "python",
    md: "markdown",
    yml: "yaml"
  };
  return aliases[value] || value;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

/* ---- CodeBlock component ---- */

export function CodeBlock({ code, language, copyLabel, copiedLabel }: { code: string; language: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const lineCount = Math.max(1, String(code || "").split(/\r?\n/).length);
  const [expanded, setExpanded] = useState(lineCount <= 40);
  const previousLineCount = useRef(lineCount);
  const collapsed = !expanded && lineCount > 40;
  const highlighted = useMemo(() => {
    const normalized = normalizeCodeLanguage(language);
    try {
      if (normalized && hljs.getLanguage(normalized)) {
        return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, language]);

  useEffect(() => {
    if (previousLineCount.current <= 40 && lineCount > 40) setExpanded(false);
    previousLineCount.current = lineCount;
  }, [lineCount]);

  async function copyCode() {
    await copyText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className={`markdown-code-wrap ${collapsed ? "collapsed" : ""}`}>
      <div className="markdown-code-toolbar">
        <div className="markdown-code-meta">
          {language && <span className="markdown-code-language">{language}</span>}
          <span className="markdown-code-lines">{lineCount} lines</span>
        </div>
        <div className="markdown-code-actions">
          {lineCount > 40 && (
            <button type="button" className="code-toggle" onClick={() => setExpanded((value) => !value)} title={expanded ? "Collapse" : "Expand"} aria-label={expanded ? "Collapse" : "Expand"}>
              {expanded ? "↥" : "↧"}
            </button>
          )}
          <button type="button" className="code-copy" onClick={copyCode}>{copied ? copiedLabel : copyLabel}</button>
        </div>
      </div>
      <pre className="markdown-code">
        <span className="markdown-code-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
        </span>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

/* ---- MarkdownContent component ---- */

export function MarkdownContent({ content, copyLabel = translations.zh.copy, copiedLabel = translations.zh.copied }: { content: string; copyLabel?: string; copiedLabel?: string }) {
  const components = useMemo<Components>(() => ({
    a({ href, children }) {
      const safe = safeHref(href);
      return safe ? <a href={safe} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
    },
    pre({ children }) {
      const child = React.Children.toArray(children)[0];
      if (React.isValidElement(child)) {
        const props = child.props as { className?: string; children?: React.ReactNode };
        const language = languageFromClassName(props.className || "");
        const code = extractReactText(props.children).replace(/\n$/, "");
        return <CodeBlock code={code} language={language} copyLabel={copyLabel} copiedLabel={copiedLabel} />;
      }
      return <pre>{children}</pre>;
    },
    code({ className, children }) {
      return <code className={className}>{children}</code>;
    }
  }), [copiedLabel, copyLabel]);

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {String(content ?? "")}
      </ReactMarkdown>
    </div>
  );
}
