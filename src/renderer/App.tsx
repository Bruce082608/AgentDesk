import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
import type { AgentEvent, AttachedFile, ChatMessage, GitSummary, PermissionMode, PlanItem, ProviderBalanceResult, ProviderConfig, WorkspaceTreeItem } from "./global";
import "./styles.css";

const appName = "Bruce的秘密基地";
const brandIconUrl = new URL("./assets/bruce-secret-base.jpg", import.meta.url).href;

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

type EventLogItem = {
  id: string;
  title: string;
  body: string;
  kind: "status" | "tool" | "error" | "model" | "patch";
};

type PatchItem = {
  id: string;
  summary: string;
  patch: string;
  status: "pending" | "applied" | "discarded" | "failed";
  error?: string;
};

type CommandItem = {
  id: string;
  command: string;
  reason: string;
  highRisk: boolean;
  status: "pending" | "approved" | "discarded" | "failed";
  result?: string;
  error?: string;
};

type UserQuestionItem = {
  id: string;
  question: string;
  context?: string;
  status: "pending" | "dismissed";
};

type ToolDraft = {
  name: string;
  text: string;
};

type SearchMatch = {
  file: string;
  line: number;
  text: string;
};

type TokenUsageStats = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
};

type ChatSession = {
  id: string;
  title: string;
  workspace: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsageStats;
  createdAt: number;
  updatedAt: number;
};

type SidebarSection = "files" | "advanced";
type RightSidebarSection = "plan" | "activity";
type ActivityFilter = "all" | "tool" | "error" | "approval" | "system";
type ThemeMode = "light" | "dark";
type Language = "zh" | "en";
type ReasoningView = "preview" | "full" | "collapsed";

const CHAT_SESSIONS_KEY = "agent-chat-sessions";
const THEME_KEY = "agent-ui-theme";
const LANGUAGE_KEY = "agent-ui-language";
const LEFT_SIDEBAR_WIDTH_KEY = "agent-left-sidebar-width";
const RIGHT_SIDEBAR_WIDTH_KEY = "agent-right-sidebar-width";
const COMPOSER_HEIGHT_KEY = "agent-composer-height";
const MAX_SAVED_SESSIONS = 30;
const MAX_ACTIVITY_EVENTS = 5000;
const MIN_LEFT_SIDEBAR_WIDTH = 220;
const MAX_LEFT_SIDEBAR_WIDTH = 480;
const MIN_RIGHT_SIDEBAR_WIDTH = 260;
const MAX_RIGHT_SIDEBAR_WIDTH = 560;
const MIN_CONVERSATION_WIDTH = 440;
const RESIZE_HANDLE_WIDTH = 7;
const MIN_COMPOSER_HEIGHT = 72;
const MAX_COMPOSER_HEIGHT = 260;

const emptyTokenUsage = (): TokenUsageStats => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requests: 0
});

const translations = {
  zh: {
    newChat: "新建",
    chats: "Chats",
    workspace: "Workspace",
    chooseFolder: "选择目录",
    notSelected: "未选择",
    files: "文件",
    advanced: "进阶",
    copy: "复制",
    copied: "已复制",
    regenerate: "重新生成",
    rename: "重命名",
    deleteSession: "删除",
    renameSessionPrompt: "输入新的会话名称",
    deleteSessionConfirm: "确定删除这个会话吗？",
    reasoning: "思考过程",
    expandReasoning: "完全展开",
    collapseReasoning: "完全折叠",
    previewReasoning: "显示三行",
    answerQuestion: "回答",
    dismiss: "忽略",
    contextUsage: "上下文",
    offlineTitle: "网络不可用",
    offlineBody: "当前处于离线状态，请恢复网络后再发送请求。",
    searchPlaceholder: "搜索文件内容",
    searching: "搜索中",
    search: "搜索",
    noFiles: "暂无文件树",
    emptyDir: "空",
    git: "Git",
    viewGitDiff: "查看 git diff",
    refreshGit: "刷新 Git",
    noChanges: "No changes",
    gitHint: "选择 Git workspace 后显示分支和变更。",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "Model",
    summaryModel: "摘要模型",
    summaryModelPlaceholder: "默认 deepseek-v4-flash；留空则使用主模型",
    apiKey: "API Key",
    apiKeyPlaceholder: "可留空使用环境变量",
    testing: "检测中...",
    testApi: "检测 API",
    balanceChecking: "查询中...",
    queryBalance: "查询 API 余额",
    balanceAvailable: "账户可用",
    balanceUnavailable: "余额不足",
    totalBalance: "总余额",
    grantedBalance: "赠金余额",
    toppedUpBalance: "充值余额",
    localTokenUsage: "本地 token 用量",
    promptTokens: "输入 tokens",
    completionTokens: "输出 tokens",
    totalTokens: "总 tokens",
    usageRequests: "请求次数",
    balanceHint: "余额来自 DeepSeek 官方 /user/balance；token 用量为本应用本地累计。",
    contextBudget: "Context Budget",
    maxOutputTokens: "Max Output Tokens",
    maxAgentSteps: "工具调用次数限制",
    thinkingMode: "Thinking Mode",
    reasoningEffort: "Reasoning Effort",
    temperature: "Temperature",
    providerHintDeepSeek: "DeepSeek 参数从配置文件读取，API key 可用环境变量或本机临时保存。",
    providerHintCompatible: "适合任何 OpenAI Chat Completions 兼容网关。",
    agentSession: "Agent Session",
    running: "运行中",
    ready: "就绪",
    stop: "停止",
    clear: "清空",
    emptyTitle: "选择工作区后开始任务",
    emptyBody: "例如：列出这个项目的文件结构，读 README，然后告诉我如何启动。",
    you: "You",
    agent: "Agent",
    thinking: "Agent 正在处理...",
    writingCode: "Agent 正在写代码",
    composerPlaceholder: "让 agent 检查、修改或运行这个 workspace...",
    uploadFiles: "上传文件",
    send: "发送",
    plan: "Plan",
    activity: "Activity",
    activityFilterAll: "全部",
    activityFilterTool: "工具调用",
    activityFilterError: "错误",
    activityFilterApproval: "审批",
    activityFilterSystem: "系统",
    activitySearchPlaceholder: "搜索 Activity",
    planEmpty: "Agent 的计划会显示在这里。",
    needsApproval: "Needs Approval",
    pendingChanges: "Pending Changes",
    commandApprovals: "Command Approvals",
    restoreConfirm: "恢复确认",
    autoApprovalBanner: "后续命令请求已自动允许，直到应用重启或手动恢复确认。",
    permissionMode: "权限模式",
    defaultPermission: "默认权限",
    fullAccessPermission: "完全访问权限",
    defaultPermissionHint: "默认权限：只读命令自动执行，写入、删除、安装、联网和高危操作会请求确认。",
    fullAccessPermissionHint: "完全访问权限：agent 的命令和 patch 将自动执行/应用，适合你信任当前任务时使用。",
    apply: "应用",
    discard: "放弃",
    execute: "执行",
    executeAllowFuture: "执行并允许后续",
    activityEmpty: "工具调用、模型用量和错误会显示在这里。",
    addContext: "加入上下文",
    removeContextTitle: "点击移除上下文附件",
    messagesUnit: "条消息",
    newChatTitle: "新对话",
    untitledChat: "未命名对话",
    light: "浅色",
    dark: "深色",
    language: "语言",
    theme: "主题",
    appSubtitle: "本地桌面 Agent Demo",
    sidebarNav: "侧栏页面",
    branch: "分支",
    config: "配置",
    enabled: "启用",
    disabled: "关闭",
    waitingPlan: "等待模型生成计划"
  },
  en: {
    newChat: "New",
    chats: "Chats",
    workspace: "Workspace",
    chooseFolder: "Choose Folder",
    notSelected: "Not selected",
    files: "Files",
    advanced: "Advanced",
    copy: "Copy",
    copied: "Copied",
    regenerate: "Regenerate",
    rename: "Rename",
    deleteSession: "Delete",
    renameSessionPrompt: "Enter a new chat name",
    deleteSessionConfirm: "Delete this chat?",
    reasoning: "Thinking",
    expandReasoning: "Expand fully",
    collapseReasoning: "Collapse",
    previewReasoning: "Show 3 lines",
    answerQuestion: "Answer",
    dismiss: "Dismiss",
    contextUsage: "Context",
    offlineTitle: "Offline",
    offlineBody: "You appear to be offline. Reconnect before sending a request.",
    searchPlaceholder: "Search file contents",
    searching: "Searching",
    search: "Search",
    noFiles: "No file tree yet",
    emptyDir: "empty",
    git: "Git",
    viewGitDiff: "View git diff",
    refreshGit: "Refresh Git",
    noChanges: "No changes",
    gitHint: "Select a Git workspace to show branch and changes.",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "Model",
    summaryModel: "Summary model",
    summaryModelPlaceholder: "Default deepseek-v4-flash; leave empty to use primary model",
    apiKey: "API Key",
    apiKeyPlaceholder: "Leave empty to use env vars",
    testing: "Testing...",
    testApi: "Test API",
    balanceChecking: "Checking...",
    queryBalance: "Check API Balance",
    balanceAvailable: "Account available",
    balanceUnavailable: "Insufficient balance",
    totalBalance: "Total balance",
    grantedBalance: "Granted balance",
    toppedUpBalance: "Topped-up balance",
    localTokenUsage: "Local token usage",
    promptTokens: "Prompt tokens",
    completionTokens: "Completion tokens",
    totalTokens: "Total tokens",
    usageRequests: "Requests",
    balanceHint: "Balance comes from DeepSeek /user/balance; token usage is accumulated locally in this app.",
    contextBudget: "Context Budget",
    maxOutputTokens: "Max Output Tokens",
    maxAgentSteps: "Tool Call Limit",
    thinkingMode: "Thinking Mode",
    reasoningEffort: "Reasoning Effort",
    temperature: "Temperature",
    providerHintDeepSeek: "DeepSeek settings are loaded from config. API keys can come from env vars or encrypted local storage.",
    providerHintCompatible: "Works with any OpenAI Chat Completions compatible gateway.",
    agentSession: "Agent Session",
    running: "Running",
    ready: "Ready",
    stop: "Stop",
    clear: "Clear",
    emptyTitle: "Choose a workspace to begin",
    emptyBody: "For example: list this project's files, read the README, then tell me how to start it.",
    you: "You",
    agent: "Agent",
    thinking: "Agent is working...",
    writingCode: "Agent is writing code",
    composerPlaceholder: "Ask the agent to inspect, modify, or run this workspace...",
    uploadFiles: "Upload",
    send: "Send",
    plan: "Plan",
    activity: "Activity",
    activityFilterAll: "All",
    activityFilterTool: "Tools",
    activityFilterError: "Errors",
    activityFilterApproval: "Approvals",
    activityFilterSystem: "System",
    activitySearchPlaceholder: "Search Activity",
    planEmpty: "Agent plans appear here.",
    needsApproval: "Needs Approval",
    pendingChanges: "Pending Changes",
    commandApprovals: "Command Approvals",
    restoreConfirm: "Restore confirm",
    autoApprovalBanner: "Future command requests are automatically allowed until the app restarts or confirmation is restored.",
    permissionMode: "Permission mode",
    defaultPermission: "Default",
    fullAccessPermission: "Full access",
    defaultPermissionHint: "Default: read-only commands run automatically; writes, deletes, installs, network, and high-risk actions ask for confirmation.",
    fullAccessPermissionHint: "Full access: agent commands and patches run/apply automatically. Use when you trust the current task.",
    apply: "Apply",
    discard: "Discard",
    execute: "Run",
    executeAllowFuture: "Run and allow future",
    activityEmpty: "Tool calls, model usage, and errors appear here.",
    addContext: "Add context",
    removeContextTitle: "Click to remove this context attachment",
    messagesUnit: "messages",
    newChatTitle: "New chat",
    untitledChat: "Untitled chat",
    light: "Light",
    dark: "Dark",
    language: "Language",
    theme: "Theme",
    appSubtitle: "Local desktop agent demo",
    sidebarNav: "Sidebar sections",
    branch: "Branch",
    config: "Config",
    enabled: "Enabled",
    disabled: "Disabled",
    waitingPlan: "Waiting for model plan"
  }
} as const;

const defaultConfig: ProviderConfig = {
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
};

function createBlankSession(workspace = ""): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: translations.zh.newChatTitle,
    workspace,
    messages: [],
    tokenUsage: emptyTokenUsage(),
    createdAt: now,
    updatedAt: now
  };
}

function normalizeTokenUsage(value: unknown): TokenUsageStats {
  const data = value && typeof value === "object" ? value as Partial<TokenUsageStats> : {};
  return {
    promptTokens: Number(data.promptTokens) || 0,
    completionTokens: Number(data.completionTokens) || 0,
    totalTokens: Number(data.totalTokens) || 0,
    requests: Number(data.requests) || 0
  };
}

function loadChatSessions(): ChatSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session) => typeof session?.id === "string")
      .map((session) => ({
        id: session.id,
        title: String(session.title || translations.zh.untitledChat),
        workspace: String(session.workspace || ""),
        messages: Array.isArray(session.messages)
          ? session.messages.filter((message: ChatMessage) => message?.role === "user" || message?.role === "assistant")
              .map((message: ChatMessage) => ({
                role: message.role,
                content: String(message.content || ""),
                reasoning: typeof message.reasoning === "string" ? message.reasoning : undefined
              }))
          : [],
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

function saveChatSessions(sessions: ChatSession[]) {
  localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
}

function deriveSessionTitle(messages: ChatMessage[], fallback: string) {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUserMessage) return fallback || translations.zh.newChatTitle;
  return firstUserMessage.replace(/\s+/g, " ").slice(0, 42);
}

function formatSessionTime(timestamp: number, language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(localStorage.getItem(key));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function MarkdownContent({ content, copyLabel = translations.zh.copy, copiedLabel = translations.zh.copied }: { content: string; copyLabel?: string; copiedLabel?: string }) {
  const components = useMemo<Components>(() => ({
    a({ href, children }) {
      const safe = href ? safeHref(href) : "";
      return safe ? <a href={safe} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
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

function safeHref(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function languageFromClassName(className: string) {
  const match = className.match(/(?:^|\s)language-([^\s]+)/);
  return match?.[1] || "";
}

function extractReactText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractReactText).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractReactText(props.children);
  }
  return "";
}

function isTreeItemVisible(item: WorkspaceTreeItem, expandedDirs: Set<string>) {
  const parts = item.path.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!expandedDirs.has(current)) return false;
  }
  return true;
}

function getInitialExpandedDirs(items: WorkspaceTreeItem[]) {
  const expanded = new Set<string>();
  for (const item of items) {
    if (item.type === "directory" && item.depth === 0) expanded.add(item.path);
  }
  return expanded;
}

function hasTreeChildren(items: WorkspaceTreeItem[], directoryPath: string) {
  const prefix = `${directoryPath}/`;
  return items.some((item) => item.path.startsWith(prefix));
}

function estimatePendingInputTokens(messages: ChatMessage[], input: string, attachments: AttachedFile[], currentTokenCount: number) {
  const hasPendingInput = Boolean(input.trim() || attachments.length > 0 || messages.length === 0);
  return hasPendingInput ? currentTokenCount : 0;
}

function formatToolDraftText(value: string) {
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

function trimActivityEvents(events: EventLogItem[]) {
  return events.length > MAX_ACTIVITY_EVENTS ? events.slice(-MAX_ACTIVITY_EVENTS) : events;
}

function filterActivityEvents(events: EventLogItem[], filter: ActivityFilter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return events.filter((event) => {
    if (!matchesActivityFilter(event, filter)) return false;
    if (!normalizedQuery) return true;
    return `${event.title}\n${event.body}\n${event.kind}`.toLowerCase().includes(normalizedQuery);
  });
}

function matchesActivityFilter(event: EventLogItem, filter: ActivityFilter) {
  if (filter === "all") return true;
  if (filter === "tool") return event.kind === "tool";
  if (filter === "error") return event.kind === "error";
  if (filter === "approval") return event.kind === "patch";
  return event.kind === "status" || event.kind === "model";
}

function CodeBlock({ code, language, copyLabel, copiedLabel }: { code: string; language: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
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

  async function copyCode() {
    await copyText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="markdown-code-wrap">
      <div className="markdown-code-toolbar">
        {language && <span className="markdown-code-language">{language}</span>}
        <button type="button" className="code-copy" onClick={copyCode}>{copied ? copiedLabel : copyLabel}</button>
      </div>
      <pre className="markdown-code">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
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

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function App() {
  const [workspace, setWorkspace] = useState("");
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("files");
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "dark" ? "dark" : "light";
  });
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return saved === "en" ? "en" : "zh";
  });
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredNumber(LEFT_SIDEBAR_WIDTH_KEY, 292, MIN_LEFT_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH)
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readStoredNumber(RIGHT_SIDEBAR_WIDTH_KEY, 340, MIN_RIGHT_SIDEBAR_WIDTH, MAX_RIGHT_SIDEBAR_WIDTH)
  );
  const [composerHeight, setComposerHeight] = useState(() =>
    readStoredNumber(COMPOSER_HEIGHT_KEY, 78, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT)
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renamingTitle, setRenamingTitle] = useState("");
  const [reasoningViews, setReasoningViews] = useState<Record<string, ReasoningView>>({});
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const [rightSidebarSection, setRightSidebarSection] = useState<RightSidebarSection>("plan");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [questions, setQuestions] = useState<UserQuestionItem[]>([]);
  const [toolDraft, setToolDraft] = useState<ToolDraft | null>(null);
  const [tree, setTree] = useState<WorkspaceTreeItem[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [fileSearch, setFileSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [previewFile, setPreviewFile] = useState<AttachedFile | null>(null);
  const [gitSummary, setGitSummary] = useState<GitSummary | null>(null);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [config, setConfig] = useState<ProviderConfig>(defaultConfig);
  const [busy, setBusy] = useState(false);
  const [searchingFiles, setSearchingFiles] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [balanceResult, setBalanceResult] = useState<ProviderBalanceResult | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageStats>(() => emptyTokenUsage());
  const [commandAutoApproval, setCommandAutoApproval] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [contextTokenCount, setContextTokenCount] = useState(0);
  const [configPath, setConfigPath] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const activeRequest = useRef<string | null>(null);
  const streamingMessageActive = useRef(false);
  const reasoningMessageActive = useRef(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const activityListRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const followOutputRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const t = translations[language];

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(leftSidebarWidth));
  }, [leftSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(composerHeight));
  }, [composerHeight]);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.agentWindow.countTokens({ messages, input, attachments: attachedFiles })
        .then((result) => {
          if (!cancelled) setContextTokenCount(result.tokens);
        })
        .catch(() => {
          if (!cancelled) setContextTokenCount(0);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [messages, input, attachedFiles]);

  useEffect(() => {
    const savedSessions = loadChatSessions();
    const initialSession = savedSessions[0] ?? createBlankSession(workspace);
    const nextSessions = savedSessions.length > 0 ? savedSessions : [initialSession];
    setSessions(nextSessions);
    setActiveSessionId(initialSession.id);
    setMessages(initialSession.messages);
    setTokenUsage(initialSession.tokenUsage);
    if (initialSession.workspace) {
      setWorkspace(initialSession.workspace);
      refreshWorkspace(initialSession.workspace);
      refreshGit(initialSession.workspace);
    }
    setSessionsLoaded(true);
  }, []);

  useEffect(() => {
    window.agentWindow.loadConfig().then(({ config: fileConfig, path }) => {
      const legacyKey = localStorage.getItem("agent-api-key") || "";
      if (legacyKey) localStorage.removeItem("agent-api-key");
      setConfig({ ...defaultConfig, ...fileConfig, apiKey: legacyKey || fileConfig.apiKey || "" });
      setConfigPath(path);
      setConfigLoaded(true);
      if ("recoveredFromError" in fileConfig && fileConfig.recoveredFromError) {
        appendEvent("status", "配置已恢复", `配置文件损坏，已恢复默认值：${String(fileConfig.recoveredFromError)}`);
      }
    }).catch((error) => {
      appendEvent("error", "配置读取失败", error instanceof Error ? error.message : String(error));
      setConfigLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    window.agentWindow.saveConfig(config).catch((error) => {
      appendEvent("error", "配置保存失败", error instanceof Error ? error.message : String(error));
    });
  }, [config, configLoaded]);

  useEffect(() => {
    if (!sessionsLoaded || !activeSessionId) return;
    setSessions((current) => {
      const next = current
        .map((session) => {
          if (session.id !== activeSessionId) return session;
          return {
            ...session,
            title: deriveSessionTitle(messages, session.title),
            workspace,
            messages,
            tokenUsage,
            updatedAt: Date.now()
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SAVED_SESSIONS);
      saveChatSessions(next);
      return next;
    });
  }, [activeSessionId, messages, sessionsLoaded, tokenUsage, workspace]);


  useEffect(() => {
    return window.agentWindow.onAgentEvent((event) => {
      if (event.requestId !== activeRequest.current) return;
      handleAgentEvent(event);
    });
  }, []);

  useEffect(() => {
    if (!followOutputRef.current) return;
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages, events, patches, commands, questions, busy]);

  useEffect(() => {
    if (rightSidebarSection !== "activity") return;
    const list = activityListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [events, activityFilter, activitySearch, rightSidebarSection]);

  const providerHint = useMemo(() => {
    if (config.provider === "deepseek") return t.providerHintDeepSeek;
    return t.providerHintCompatible;
  }, [config.provider, t]);

  const liveInputTokenEstimate = useMemo(
    () => estimatePendingInputTokens(messages, input, attachedFiles, contextTokenCount),
    [messages, input, attachedFiles, contextTokenCount]
  );
  const sessionContextTokenCount = tokenUsage.totalTokens + liveInputTokenEstimate;
  const contextPercent = Math.min(100, Math.round((sessionContextTokenCount / Math.max(config.contextTokens, 1)) * 100));
  const contextUsageLabel = `${contextPercent}%`;

  const visibleTree = useMemo(
    () => tree.filter((item) => isTreeItemVisible(item, expandedDirs)),
    [tree, expandedDirs]
  );

  const activePatches = useMemo(
    () => patches.filter((patch) => patch.status === "pending" || patch.status === "failed"),
    [patches]
  );

  const activeCommands = useMemo(
    () => commands.filter((command) => command.status === "pending" || command.status === "failed"),
    [commands]
  );

  const activeQuestions = useMemo(
    () => questions.filter((question) => question.status === "pending"),
    [questions]
  );

  const filteredEvents = useMemo(
    () => filterActivityEvents(events, activityFilter, activitySearch),
    [events, activityFilter, activitySearch]
  );

  function handleAgentEvent(event: AgentEvent) {
    if (event.type === "done") {
      setPlanItems((current) => current.map((item) => item.status === "in_progress" ? { ...item, status: "completed" } : item));
      setBusy(false);
      activeRequest.current = null;
      streamingMessageActive.current = false;
      reasoningMessageActive.current = false;
      setToolDraft(null);
      return;
    }

    if (event.type === "stream_delta") {
      setMessages((current) => {
        if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
          streamingMessageActive.current = true;
          return [...current, { role: "assistant", content: event.text }];
        }
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + event.text };
        return next;
      });
      return;
    }

    if (event.type === "reasoning_delta") {
      setMessages((current) => {
        if ((!streamingMessageActive.current && !reasoningMessageActive.current) || current[current.length - 1]?.role !== "assistant") {
          reasoningMessageActive.current = true;
          return [...current, { role: "assistant", content: "", reasoning: event.text }];
        }
        const next = [...current];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, reasoning: `${last.reasoning || ""}${event.text}` };
        return next;
      });
      return;
    }

    if (event.type === "tool_call_delta") {
      setToolDraft((current) => ({
        name: event.name || current?.name || "tool_call",
        text: `${current?.text || ""}${event.text}`
      }));
      return;
    }

    if (event.type === "plan_update") {
      setPlanItems(event.items);
      return;
    }

    if (event.type === "model") {
      if (streamingMessageActive.current || reasoningMessageActive.current) {
        setMessages((current) => {
          if (current[current.length - 1]?.role !== "assistant") return current;
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = {
            ...last,
            content: last.content || event.message || "",
            reasoning: event.reasoning || last.reasoning
          };
          return next;
        });
      } else if (event.message.trim() || event.reasoning?.trim()) {
        setMessages((current) => [...current, { role: "assistant", content: event.message, reasoning: event.reasoning || undefined }]);
      }
      streamingMessageActive.current = false;
      reasoningMessageActive.current = false;
      recordTokenUsage(event.usage);
      appendEvent(
        "model",
        `${event.provider} / ${event.model}${event.finishReason ? ` / ${event.finishReason}` : ""}`,
        JSON.stringify(
          {
            usage: event.usage ?? null,
            reasoning_preview: event.reasoning ? event.reasoning.slice(0, 1200) : ""
          },
          null,
          2
        )
      );
      return;
    }

    if (event.type === "status") {
      appendEvent("status", "状态", event.message);
      return;
    }

    if (event.type === "tool_start") {
      appendEvent("tool", `调用工具：${event.name}`, event.args);
      return;
    }

    if (event.type === "tool_result") {
      appendEvent("tool", `工具结果：${event.name}`, event.result);
      return;
    }

    if (event.type === "tool_error") {
      appendEvent("error", `工具失败：${event.name}`, event.message);
      return;
    }

    if (event.type === "patch_proposed") {
      setPatches((current) => [
        {
          id: event.patchId,
          summary: event.summary || "Proposed patch",
          patch: event.patch,
          status: "pending"
        },
        ...current
      ]);
      appendEvent("patch", "待确认变更", event.summary || "Agent 提交了一个 patch，等待应用。");
      return;
    }

    if (event.type === "patch_applied") {
      appendEvent("patch", "Patch 已自动应用", `${event.summary || event.patchId}${event.strategy ? ` (${event.strategy})` : ""}`);
      refreshWorkspace();
      refreshGit();
      return;
    }

    if (event.type === "command_pending") {
      setCommands((current) => [
        { id: event.commandId, command: event.command, reason: event.reason, highRisk: Boolean(event.highRisk), status: "pending" },
        ...current
      ]);
      appendEvent("patch", "命令等待确认", event.command);
      return;
    }

    if (event.type === "ask_user_pending") {
      setQuestions((current) => [
        { id: crypto.randomUUID(), question: event.question, context: event.context, status: "pending" },
        ...current
      ]);
      appendEvent("patch", "Agent 请求用户输入", event.question);
      return;
    }

    if (event.type === "error") {
      appendEvent("error", "Agent 错误", event.message);
      setMessages((current) => [...current, { role: "assistant", content: `请求失败：${event.message}` }]);
      setBusy(false);
      activeRequest.current = null;
      streamingMessageActive.current = false;
      reasoningMessageActive.current = false;
      setToolDraft(null);
    }

    if (event.type === "cancelled") {
      appendEvent("status", "请求已取消", event.message);
      setMessages((current) => [...current, { role: "assistant", content: "请求已取消。" }]);
      setBusy(false);
      activeRequest.current = null;
      streamingMessageActive.current = false;
      reasoningMessageActive.current = false;
      setToolDraft(null);
    }
  }

  function appendEvent(kind: EventLogItem["kind"], title: string, body: string) {
    setEvents((current) => trimActivityEvents([...current, { id: crypto.randomUUID(), title, body, kind }]));
  }

  function updateOutputFollowState() {
    const list = messageListRef.current;
    if (!list) return;
    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    followOutputRef.current = distanceToBottom < 32;
  }

  function recordTokenUsage(usage: unknown) {
    if (!usage || typeof usage !== "object") return;
    const data = usage as Record<string, unknown>;
    const promptTokens = Number(data.prompt_tokens ?? data.promptTokens ?? 0);
    const completionTokens = Number(data.completion_tokens ?? data.completionTokens ?? 0);
    const totalTokens = Number(data.total_tokens ?? data.totalTokens ?? promptTokens + completionTokens);
    if (![promptTokens, completionTokens, totalTokens].some((value) => Number.isFinite(value) && value > 0)) return;
    setTokenUsage((current) => ({
      promptTokens: current.promptTokens + (Number.isFinite(promptTokens) ? promptTokens : 0),
      completionTokens: current.completionTokens + (Number.isFinite(completionTokens) ? completionTokens : 0),
      totalTokens: current.totalTokens + (Number.isFinite(totalTokens) ? totalTokens : 0),
      requests: current.requests + 1
    }));
  }

  function formatInteger(value: number) {
    return Math.round(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US");
  }

  function formatBalanceAmount(value: string, currency: string) {
    const amount = Number(value);
    const displayValue = Number.isFinite(amount)
      ? amount.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6
        })
      : value;
    return `${currency} ${displayValue}`;
  }

  function resetTransientState() {
    setEvents([]);
    setPatches([]);
    setCommands([]);
    setQuestions([]);
    setPlanItems([]);
    setAttachedFiles([]);
    setPreviewFile(null);
    setSearchResults([]);
    setFileSearch("");
    setReasoningViews({});
    setToolDraft(null);
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
  }

  function resetSessionTokenUsage() {
    setTokenUsage(emptyTokenUsage());
  }

  function persistActiveSession(updates: Partial<ChatSession>) {
    if (!activeSessionId) return;
    setSessions((current) => {
      const next = current.map((session) => {
        if (session.id !== activeSessionId) return session;
        return {
          ...session,
          ...updates,
          messages: updates.messages ?? messages,
          tokenUsage: updates.tokenUsage ?? tokenUsage,
          workspace: updates.workspace ?? workspace,
          updatedAt: Date.now()
        };
      });
      saveChatSessions(next);
      return next;
    });
  }

  function startNewSession() {
    if (busy) return;
    const session = createBlankSession(workspace);
    setSessions((current) => {
      const next = [session, ...current].slice(0, MAX_SAVED_SESSIONS);
      saveChatSessions(next);
      return next;
    });
    setActiveSessionId(session.id);
    setMessages([]);
    resetSessionTokenUsage();
    resetTransientState();
  }

  async function selectSession(sessionId: string) {
    if (busy || sessionId === activeSessionId) return;
    persistActiveSession({ workspace, messages, tokenUsage });
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setTokenUsage(session.tokenUsage);
    setWorkspace(session.workspace);
    resetTransientState();
    if (session.workspace) {
      await refreshWorkspace(session.workspace);
      await refreshGit(session.workspace);
    } else {
      setTree([]);
      setGitSummary(null);
    }
  }

  function startRenameSession(sessionId: string) {
    if (busy) return;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setRenamingSessionId(sessionId);
    setRenamingTitle(session.title);
  }

  function commitRenameSession(sessionId: string) {
    const nextTitle = renamingTitle.trim();
    if (!nextTitle) return;
    setSessions((current) => {
      const next = current.map((item) => item.id === sessionId ? { ...item, title: nextTitle, updatedAt: Date.now() } : item);
      saveChatSessions(next);
      return next;
    });
    setRenamingSessionId("");
    setRenamingTitle("");
  }

  function cancelRenameSession() {
    setRenamingSessionId("");
    setRenamingTitle("");
  }

  function deleteSession(sessionId: string) {
    if (busy) return;
    if (!window.confirm(t.deleteSessionConfirm)) return;
    setSessions((current) => {
      const next = current.filter((item) => item.id !== sessionId);
      const fallback = next[0] ?? createBlankSession(workspace);
      const normalized = next.length > 0 ? next : [fallback];
      saveChatSessions(normalized);
      if (sessionId === activeSessionId) {
        setActiveSessionId(fallback.id);
        setMessages(fallback.messages);
        setTokenUsage(fallback.tokenUsage);
        setWorkspace(fallback.workspace);
        resetTransientState();
        if (fallback.workspace) {
          refreshWorkspace(fallback.workspace);
          refreshGit(fallback.workspace);
        } else {
          setTree([]);
          setGitSummary(null);
        }
      }
      return normalized;
    });
  }

  function clearCurrentSession() {
    if (busy) return;
    setMessages([]);
    resetSessionTokenUsage();
    resetTransientState();
  }

  async function chooseWorkspace() {
    const selected = await window.agentWindow.chooseWorkspace();
    if (selected) {
      setWorkspace(selected);
      persistActiveSession({ workspace: selected, messages, tokenUsage });
      setAttachedFiles([]);
      setPreviewFile(null);
      setSearchResults([]);
      setFileSearch("");
      await refreshWorkspace(selected);
      await refreshGit(selected);
    }
  }

  async function refreshWorkspace(target = workspace) {
    if (!target) return;
    try {
      const result = await window.agentWindow.getWorkspaceTree(target);
      setTree(result.items);
      setExpandedDirs(getInitialExpandedDirs(result.items));
    } catch (error) {
      appendEvent("error", "文件树读取失败", error instanceof Error ? error.message : String(error));
    }
  }

  function toggleDirectory(path: string) {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function refreshGit(target = workspace) {
    if (!target) return;
    try {
      setGitSummary(await window.agentWindow.getGitSummary(target));
    } catch (error) {
      setGitSummary(null);
      appendEvent("error", "Git 状态读取失败", error instanceof Error ? error.message : String(error));
    }
  }

  async function showGitDiff() {
    if (!workspace) return;
    try {
      const { diff } = await window.agentWindow.getGitDiff(workspace);
      appendEvent("tool", "git diff", diff || "No unstaged diff.");
    } catch (error) {
      appendEvent("error", "git diff 失败", error instanceof Error ? error.message : String(error));
    }
  }

  async function openFile(path: string) {
    if (!workspace) return;
    try {
      const file = await window.agentWindow.readFile({ workspace, path });
      setPreviewFile(file);
    } catch (error) {
      appendEvent("error", "文件读取失败", error instanceof Error ? error.message : String(error));
    }
  }

  async function attachFile(path: string) {
    if (!workspace) return;
    if (attachedFiles.some((file) => file.path === path)) return;
    try {
      const file = await window.agentWindow.readFile({ workspace, path });
      setAttachedFiles((current) => [...current, file]);
    } catch (error) {
      appendEvent("error", "文件加入上下文失败", error instanceof Error ? error.message : String(error));
    }
  }

  function detachFile(path: string) {
    setAttachedFiles((current) => current.filter((file) => file.path !== path));
  }

  async function uploadAttachmentFiles() {
    try {
      const files = await window.agentWindow.chooseAttachmentFiles();
      if (files.length === 0) return;
      setAttachedFiles((current) => {
        const seen = new Set(current.map((file) => file.path));
        return [...current, ...files.filter((file) => !seen.has(file.path))];
      });
      appendEvent("tool", "文件已上传", JSON.stringify(files.map((file) => ({ path: file.path, chars: file.content.length })), null, 2));
    } catch (error) {
      appendEvent("error", "文件上传失败", error instanceof Error ? error.message : String(error));
    }
  }

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    await startAgentRequest({
      inputText: trimmed,
      priorMessages: messages,
      nextMessages: [...messages, { role: "user", content: trimmed }],
      clearInput: true
    });
  }

  async function startAgentRequest({
    inputText,
    priorMessages,
    nextMessages,
    clearInput
  }: {
    inputText: string;
    priorMessages: ChatMessage[];
    nextMessages: ChatMessage[];
    clearInput?: boolean;
  }) {
    if (!workspace && attachedFiles.length === 0) {
      appendEvent("error", "缺少 workspace", "请先选择一个工作区目录。");
      return;
    }
    if (!navigator.onLine) {
      setIsOnline(false);
      appendEvent("error", t.offlineTitle, t.offlineBody);
      return;
    }

    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    streamingMessageActive.current = false;
    reasoningMessageActive.current = false;
    setToolDraft(null);
    followOutputRef.current = true;
    setBusy(true);
    if (clearInput) setInput("");
    setPlanItems([{ step: t.waitingPlan, status: "in_progress" }]);
    setMessages(nextMessages);

    await window.agentWindow.sendMessage({
      requestId,
      workspace: workspace || ".",
      input: inputText,
      providerConfig: config,
      messages: priorMessages,
      attachments: attachedFiles
    });
  }

  async function copyMessage(message: ChatMessage) {
    await copyText(message.content || message.reasoning || "");
    appendEvent("status", t.copied, message.role === "user" ? t.you : t.agent);
  }

  async function regenerateMessage(index: number) {
    if (busy) return;
    const userIndex = messages.slice(0, index + 1).map((message) => message.role).lastIndexOf("user");
    if (userIndex < 0) return;
    const prompt = messages[userIndex].content.trim();
    if (!prompt) return;
    await startAgentRequest({
      inputText: prompt,
      priorMessages: messages.slice(0, userIndex),
      nextMessages: messages.slice(0, userIndex + 1)
    });
  }

  function answerQuestion(questionId: string) {
    const question = questions.find((item) => item.id === questionId);
    if (!question) return;
    composerInputRef.current?.focus();
    setQuestions((current) => current.map((item) => item.id === questionId ? { ...item, status: "dismissed" } : item));
  }

  function dismissQuestion(questionId: string) {
    setQuestions((current) => current.map((item) => item.id === questionId ? { ...item, status: "dismissed" } : item));
  }

  function updateReasoningView(key: string, view: ReasoningView) {
    setReasoningViews((current) => ({ ...current, [key]: view }));
  }

  async function cancelActiveRequest() {
    if (!activeRequest.current) return;
    await window.agentWindow.cancelMessage(activeRequest.current);
  }

  async function searchWorkspace() {
    const query = fileSearch.trim();
    if (!workspace || !query || searchingFiles) return;
    setSearchingFiles(true);
    try {
      const result = await window.agentWindow.searchFiles({ workspace, query, maxResults: 50 });
      setSearchResults(result.results);
      appendEvent("tool", "文件搜索", JSON.stringify({ query, matches: result.results.length, engine: result.engine, truncated: result.truncated }, null, 2));
    } catch (error) {
      appendEvent("error", "文件搜索失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSearchingFiles(false);
    }
  }

  async function testApi() {
    if (testingApi || busy) return;
    if (!navigator.onLine) {
      setIsOnline(false);
      appendEvent("error", t.offlineTitle, t.offlineBody);
      return;
    }
    setTestingApi(true);
    appendEvent("status", "API 检测", "正在发送最小 health check 请求...");
    try {
      const result = await window.agentWindow.testProvider(config);
      if (result.ok) {
        appendEvent(
          "status",
          "API 可用",
          JSON.stringify(
            {
              model: result.result.model,
              latency_ms: result.result.latencyMs,
              reply: result.result.content,
              usage: result.result.usage
            },
            null,
            2
          )
        );
      } else {
        appendEvent("error", "API 不可用", result.error);
      }
    } finally {
      setTestingApi(false);
    }
  }

  async function queryBalance() {
    if (checkingBalance || busy) return;
    if (!navigator.onLine) {
      setIsOnline(false);
      appendEvent("error", t.offlineTitle, t.offlineBody);
      return;
    }
    setCheckingBalance(true);
    setBalanceResult(null);
    appendEvent("status", "API 余额查询", "正在请求 DeepSeek 官方余额接口...");
    try {
      const result = await window.agentWindow.getBalance(config);
      if (result.ok) {
        setBalanceResult(result.result);
        appendEvent("status", "API 余额查询成功", JSON.stringify(result.result, null, 2));
      } else {
        appendEvent("error", "API 余额查询失败", result.error);
      }
    } finally {
      setCheckingBalance(false);
    }
  }

  async function applyPatch(patchId: string) {
    setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "pending", error: undefined } : patch));
    const result = await window.agentWindow.applyPatch(patchId);
    if (result.ok) {
      setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "applied" } : patch));
      appendEvent("patch", "Patch 已应用", `${result.result.summary}${result.result.strategy ? ` (${result.result.strategy})` : ""}`);
      await refreshWorkspace();
      await refreshGit();
    } else {
      setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "failed", error: result.error } : patch));
      appendEvent("error", "Patch 应用失败", result.error);
    }
  }

  async function discardPatch(patchId: string) {
    await window.agentWindow.discardPatch(patchId);
    setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "discarded" } : patch));
    appendEvent("patch", "Patch 已放弃", patchId);
  }

  async function approveCommand(commandId: string, allowFuture = false) {
    const result = await window.agentWindow.approveCommand({ commandId, allowFuture });
    if (result.ok) {
      setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "approved", result: result.result.result } : command));
      appendEvent("tool", `命令已执行：${result.result.command}`, result.result.result);
      setCommandAutoApproval(result.result.autoApproveFutureCommands);
      setPermissionMode(result.result.permissionMode === "full" ? "full" : "default");
      if (result.result.autoApproveFutureCommands) {
        appendEvent("status", "后续命令已允许", "本次应用运行期间，agent 后续命令请求将自动执行。");
      }
    } else {
      setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "failed", error: result.error } : command));
      appendEvent("error", "命令执行失败", result.error);
    }
  }

  async function discardCommand(commandId: string) {
    await window.agentWindow.discardCommand(commandId);
    setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "discarded" } : command));
  }

  async function resetCommandAutoApproval() {
    const result = await window.agentWindow.setCommandAutoApproval(false);
    setCommandAutoApproval(result.autoApproveFutureCommands);
    setPermissionMode(result.permissionMode === "full" ? "full" : "default");
    appendEvent("status", "后续命令确认已恢复", "agent 后续高危或副作用命令会再次请求确认。");
  }

  async function updatePermissionMode(nextMode: PermissionMode) {
    const result = await window.agentWindow.setCommandAutoApproval(nextMode === "full");
    setPermissionMode(result.permissionMode === "full" ? "full" : "default");
    setCommandAutoApproval(result.autoApproveFutureCommands);
    appendEvent(
      "status",
      nextMode === "full" ? "已启用完全访问权限" : "已启用默认权限",
      nextMode === "full" ? t.fullAccessPermissionHint : t.defaultPermissionHint
    );
  }

  function updateProvider(provider: ProviderConfig["provider"]) {
    const nextDefaults =
      provider === "deepseek"
        ? { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", summaryModel: "deepseek-v4-flash", thinkingMode: "enabled" as const, reasoningEffort: "max" as const, contextTokens: 1000000, maxTokens: 32768 }
        : { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", summaryModel: "", thinkingMode: "disabled" as const, reasoningEffort: "medium" as const, contextTokens: 128000, maxTokens: 4096 };
    setConfig((current) => ({ ...current, provider, ...nextDefaults }));
  }

  function startColumnResize(side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startLeftWidth = leftSidebarWidth;
    const startRightWidth = rightSidebarWidth;

    const move = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const availableWidth = window.innerWidth - MIN_CONVERSATION_WIDTH - RESIZE_HANDLE_WIDTH * 2;
      if (side === "left") {
        const maxWidth = Math.min(MAX_LEFT_SIDEBAR_WIDTH, Math.max(MIN_LEFT_SIDEBAR_WIDTH, availableWidth - startRightWidth));
        setLeftSidebarWidth(Math.min(Math.max(startLeftWidth + deltaX, MIN_LEFT_SIDEBAR_WIDTH), maxWidth));
      } else {
        const maxWidth = Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, availableWidth - startLeftWidth));
        setRightSidebarWidth(Math.min(Math.max(startRightWidth - deltaX, MIN_RIGHT_SIDEBAR_WIDTH), maxWidth));
      }
    };

    const stop = () => {
      document.body.classList.remove("resizing-columns");
      window.removeEventListener("pointermove", move);
    };

    document.body.classList.add("resizing-columns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function startComposerResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = composerHeight;

    const move = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxHeight = Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, window.innerHeight - 220));
      setComposerHeight(Math.min(Math.max(startHeight + deltaY, MIN_COMPOSER_HEIGHT), maxHeight));
    };

    const stop = () => {
      document.body.classList.remove("resizing-rows");
      window.removeEventListener("pointermove", move);
    };

    document.body.classList.add("resizing-rows");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <div
      className="app-shell"
      style={{ gridTemplateColumns: `${leftSidebarWidth}px ${RESIZE_HANDLE_WIDTH}px minmax(${MIN_CONVERSATION_WIDTH}px, 1fr) ${RESIZE_HANDLE_WIDTH}px ${rightSidebarWidth}px` }}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={brandIconUrl} alt="" />
          </div>
          <div>
            <h1>{appName}</h1>
            <p>{t.appSubtitle}</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-title row-title">
            <span>{t.chats}</span>
            <button className="secondary tiny" onClick={startNewSession} disabled={busy}>{t.newChat}</button>
          </div>
          <div className="session-list">
            {sessions.map((session) => (
              <div className={`session-row ${session.id === activeSessionId ? "active" : ""}`} key={session.id}>
                {renamingSessionId === session.id ? (
                  <input
                    className="session-edit-input"
                    value={renamingTitle}
                    autoFocus
                    aria-label={t.renameSessionPrompt}
                    onChange={(event) => setRenamingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRenameSession(session.id);
                      if (event.key === "Escape") cancelRenameSession();
                    }}
                  />
                ) : (
                  <button
                    className="session-item"
                    onClick={() => selectSession(session.id)}
                    disabled={busy}
                  >
                    <strong>{session.title}</strong>
                    <span>{session.messages.length} {t.messagesUnit} · {formatSessionTime(session.updatedAt, language)}</span>
                  </button>
                )}
                <div className="session-actions">
                  {renamingSessionId === session.id ? (
                    <>
                      <button type="button" disabled={!renamingTitle.trim()} onClick={() => commitRenameSession(session.id)} title={t.rename} aria-label={t.rename}>✓</button>
                      <button type="button" onClick={cancelRenameSession} title={t.discard} aria-label={t.discard}>×</button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={busy} onClick={() => startRenameSession(session.id)} title={t.rename} aria-label={t.rename}>✎</button>
                      <button type="button" disabled={busy || sessions.length <= 1} onClick={() => deleteSession(session.id)} title={t.deleteSession} aria-label={t.deleteSession}>×</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">{t.workspace}</div>
          <button className="primary" onClick={chooseWorkspace}>{t.chooseFolder}</button>
          <div className="path-box">{workspace || t.notSelected}</div>
        </section>

        <nav className="section-tabs" aria-label={t.sidebarNav}>
          <button className={sidebarSection === "files" ? "active" : ""} onClick={() => setSidebarSection("files")}>{t.files}</button>
          <button className={sidebarSection === "advanced" ? "active" : ""} onClick={() => setSidebarSection("advanced")}>{t.advanced}</button>
        </nav>

        {sidebarSection === "files" && (
          <section className="panel compact-panel">
            <div className="panel-title">{t.files}</div>
            <div className="file-search">
              <input
                value={fileSearch}
                placeholder={t.searchPlaceholder}
                disabled={!workspace}
                onChange={(event) => setFileSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") searchWorkspace();
                }}
              />
              <button className="secondary" disabled={!workspace || !fileSearch.trim() || searchingFiles} onClick={searchWorkspace}>
                {searchingFiles ? t.searching : t.search}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((match) => (
                  <button key={`${match.file}:${match.line}:${match.text}`} onClick={() => openFile(match.file)}>
                    <strong>{match.file}:{match.line}</strong>
                    <span>{match.text}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="file-tree">
              {tree.length === 0 && <span className="muted">{t.noFiles}</span>}
              {visibleTree.map((item) => (
                <button
                  className={`file-node ${item.type} ${item.type === "directory" && expandedDirs.has(item.path) ? "expanded" : ""}`}
                  key={item.path}
                  style={{ paddingLeft: `${8 + item.depth * 12}px` }}
                  onClick={() => item.type === "directory" ? toggleDirectory(item.path) : openFile(item.path)}
                >
                  <span>{item.type === "directory" ? (expandedDirs.has(item.path) ? "▾" : "▸") : "·"}</span>
                  {item.name}
                  {item.type === "directory" && !hasTreeChildren(tree, item.path) && <small>{t.emptyDir}</small>}
                </button>
              ))}
            </div>
          </section>
        )}

        {sidebarSection === "advanced" && (
          <>
            <section className="panel compact-panel">
              <div className="panel-title">{t.git}</div>
              {gitSummary ? (
                <>
                  <div className="metric">{t.branch} <strong>{gitSummary.branch}</strong></div>
                  <button className="secondary full" onClick={showGitDiff}>{t.viewGitDiff}</button>
                  <button className="secondary full" onClick={() => refreshGit()} disabled={!workspace}>{t.refreshGit}</button>
                  <div className="commit-draft">{gitSummary.commitDraft}</div>
                  <div className="changed-list">
                    {gitSummary.changedFiles.length === 0 && <span className="muted">{t.noChanges}</span>}
                    {gitSummary.changedFiles.map((file) => (
                      <button key={`${file.status}-${file.path}`} onClick={() => openFile(file.path.replace(/^"|"$/g, ""))}>
                        <span>{file.status}</span>{file.path}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="hint">{t.gitHint}</p>
              )}
            </section>

            <section className="panel">
              <div className="panel-title">{t.provider}</div>
              <select value={config.provider} onChange={(event) => updateProvider(event.target.value as ProviderConfig["provider"])}>
                <option value="deepseek">DeepSeek</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
              <label>
                {t.baseUrl}
                <input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />
              </label>
              <label>
                {t.model}
                <input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} />
              </label>
              <label>
                {t.summaryModel}
                <input
                  value={config.summaryModel}
                  placeholder={t.summaryModelPlaceholder}
                  onChange={(event) => setConfig({ ...config, summaryModel: event.target.value })}
                />
              </label>
              <label>
                {t.apiKey}
                <input
                  type="password"
                  value={config.apiKey}
                  placeholder={t.apiKeyPlaceholder}
                  onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
                />
              </label>
              <button className="secondary full" onClick={testApi} disabled={busy || testingApi}>
                {testingApi ? t.testing : t.testApi}
              </button>
              <button className="secondary full" onClick={queryBalance} disabled={busy || checkingBalance || config.provider !== "deepseek"}>
                {checkingBalance ? t.balanceChecking : t.queryBalance}
              </button>
              {balanceResult && (
                <div className="balance-card">
                  <div className={`balance-status ${balanceResult.is_available ? "available" : "unavailable"}`}>
                    {balanceResult.is_available ? t.balanceAvailable : t.balanceUnavailable}
                  </div>
                  {balanceResult.balance_infos.map((info) => (
                    <div className="balance-currency" key={info.currency}>
                      <div className="metric">{t.totalBalance} <strong>{formatBalanceAmount(info.total_balance, info.currency)}</strong></div>
                      <div className="metric">{t.grantedBalance} <strong>{formatBalanceAmount(info.granted_balance, info.currency)}</strong></div>
                      <div className="metric">{t.toppedUpBalance} <strong>{formatBalanceAmount(info.topped_up_balance, info.currency)}</strong></div>
                    </div>
                  ))}
                </div>
              )}
              <div className="usage-card">
                <div className="panel-title">{t.localTokenUsage}</div>
                <div className="metric">{t.promptTokens} <strong>{formatInteger(tokenUsage.promptTokens)}</strong></div>
                <div className="metric">{t.completionTokens} <strong>{formatInteger(tokenUsage.completionTokens)}</strong></div>
                <div className="metric">{t.totalTokens} <strong>{formatInteger(tokenUsage.totalTokens)}</strong></div>
                <div className="metric">{t.usageRequests} <strong>{formatInteger(tokenUsage.requests)}</strong></div>
                <p className="hint">{t.balanceHint}</p>
              </div>
              <label>
                {t.contextBudget}
                <input
                  type="number"
                  min="4096"
                  step="4096"
                  value={config.contextTokens}
                  onChange={(event) => setConfig({ ...config, contextTokens: Number(event.target.value) })}
                />
              </label>
              <label>
                {t.maxOutputTokens}
                <input
                  type="number"
                  min="1"
                  step="1024"
                  value={config.maxTokens}
                  onChange={(event) => setConfig({ ...config, maxTokens: Number(event.target.value) })}
                />
              </label>
              <label>
                {t.maxAgentSteps}
                <input
                  type="number"
                  min="8"
                  max="256"
                  step="1"
                  value={config.maxAgentSteps}
                  onChange={(event) => {
                    const nextValue = Math.min(Math.max(Math.floor(Number(event.target.value) || 64), 8), 256);
                    setConfig({ ...config, maxAgentSteps: nextValue });
                  }}
                />
              </label>
              <label>
                {t.thinkingMode}
                <select
                  value={config.thinkingMode}
                  onChange={(event) => setConfig({ ...config, thinkingMode: event.target.value as ProviderConfig["thinkingMode"] })}
                >
                  <option value="enabled">{t.enabled}</option>
                  <option value="disabled">{t.disabled}</option>
                </select>
              </label>
              <label>
                {t.reasoningEffort}
                <select
                  value={config.reasoningEffort}
                  onChange={(event) => setConfig({ ...config, reasoningEffort: event.target.value as ProviderConfig["reasoningEffort"] })}
                >
                  <option value="max">Max</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                {t.temperature}
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })}
                />
              </label>
              <p className="hint">{providerHint}</p>
              {configPath && <p className="hint file-hint">{t.config}: {configPath}</p>}
            </section>
          </>
        )}

      </aside>

      <div
        className="column-resize-handle left"
        role="separator"
        aria-orientation="vertical"
        aria-label={language === "zh" ? "调整左侧边栏宽度" : "Resize left sidebar"}
        onPointerDown={(event) => startColumnResize("left", event)}
      />

      <main className="conversation">
        <header className="topbar">
          <div>
            <strong>{t.agentSession}</strong>
            <span>{busy ? t.running : t.ready}</span>
          </div>
          <div className="topbar-actions">
            <label className="topbar-control">
              <span>{t.theme}</span>
              <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeMode)}>
                <option value="light">{t.light}</option>
                <option value="dark">{t.dark}</option>
              </select>
            </label>
            <label className="topbar-control">
              <span>{t.language}</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            {busy && <button className="secondary danger" onClick={cancelActiveRequest}>{t.stop}</button>}
          </div>
        </header>

        {previewFile && (
          <section className="context-strip">
            <details className="file-preview">
              <summary>
                <span>{previewFile.path}</span>
                <button onClick={(event) => { event.preventDefault(); attachFile(previewFile.path); }}>{t.addContext}</button>
              </summary>
              <pre>{previewFile.content}</pre>
            </details>
          </section>
        )}

        <div className="message-list" ref={messageListRef} onScroll={updateOutputFollowState}>
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>{t.emptyTitle}</h2>
              <p>{t.emptyBody}</p>
            </div>
          )}
          {messages.map((message, index) => {
            const reasoningKey = `${message.role}-${index}`;
            const reasoningView = reasoningViews[reasoningKey] || "preview";
            return (
              <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="message-meta">
                  <div className="role">{message.role === "user" ? t.you : t.agent}</div>
                  <div className="message-actions">
                    <button type="button" onClick={() => copyMessage(message)} title={t.copy} aria-label={t.copy}>⧉</button>
                    {message.role === "assistant" && (
                      <button type="button" onClick={() => regenerateMessage(index)} disabled={busy} title={t.regenerate} aria-label={t.regenerate}>↻</button>
                    )}
                  </div>
                </div>
                <div className="message-body">
                  {message.reasoning && (
                    <section className={`reasoning-block ${reasoningView}`}>
                      <div className="reasoning-header">
                        <button
                          type="button"
                          className="reasoning-title"
                          onClick={() => updateReasoningView(reasoningKey, reasoningView === "collapsed" ? "preview" : "collapsed")}
                          title={t.reasoning}
                          aria-label={t.reasoning}
                        >
                          💡
                        </button>
                        <div className="reasoning-actions">
                          {reasoningView === "full" ? (
                            <button type="button" onClick={() => updateReasoningView(reasoningKey, "preview")} title={t.previewReasoning} aria-label={t.previewReasoning}>≡</button>
                          ) : (
                            <button type="button" onClick={() => updateReasoningView(reasoningKey, "full")} title={t.expandReasoning} aria-label={t.expandReasoning}>↕</button>
                          )}
                          <button
                            type="button"
                            onClick={() => updateReasoningView(reasoningKey, reasoningView === "collapsed" ? "preview" : "collapsed")}
                            title={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                            aria-label={reasoningView === "collapsed" ? t.previewReasoning : t.collapseReasoning}
                          >
                            {reasoningView === "collapsed" ? "≡" : "×"}
                          </button>
                        </div>
                      </div>
                      {reasoningView !== "collapsed" && <pre>{message.reasoning}</pre>}
                    </section>
                  )}
                  {message.content ? <MarkdownContent content={message.content} copyLabel={t.copy} copiedLabel={t.copied} /> : null}
                </div>
              </article>
            );
          })}
          {toolDraft && busy && (
            <article className="message assistant tool-draft-message">
              <div className="message-meta">
                <div className="role">{t.writingCode}{toolDraft.name ? ` · ${toolDraft.name}` : ""}</div>
              </div>
              <div className="message-body">
                <div className="markdown-content">
                  <CodeBlock code={formatToolDraftText(toolDraft.text)} language="json" copyLabel={t.copy} copiedLabel={t.copied} />
                </div>
              </div>
            </article>
          )}
          {(activePatches.length > 0 || activeCommands.length > 0 || activeQuestions.length > 0) && (
            <section className="conversation-approvals" aria-live="polite">
              <div className="role">{t.needsApproval}</div>
              <div className="approval-thread">
                {activeQuestions.length > 0 && (
                  <section className="patch-stack">
                    <div className="panel-title">{language === "zh" ? "Agent 提问" : "Agent Questions"}</div>
                    {activeQuestions.map((question) => (
                      <div className="question-card" key={question.id}>
                        {question.context && <div className="question-context">{question.context}</div>}
                        <div className="question-text">{question.question}</div>
                        <div className="patch-actions">
                          <button className="primary small" onClick={() => answerQuestion(question.id)}>{t.answerQuestion}</button>
                          <button className="secondary small" onClick={() => dismissQuestion(question.id)}>{t.dismiss}</button>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                {activePatches.length > 0 && (
                  <section className="patch-stack">
                    <div className="panel-title">{t.pendingChanges}</div>
                    {activePatches.map((patch) => (
                      <details className={`patch-card ${patch.status}`} key={patch.id} open={patch.status === "pending" || patch.status === "failed"}>
                        <summary>
                          <span>{patch.summary}</span>
                          <small>{patch.status}</small>
                        </summary>
                        <pre>{patch.patch}</pre>
                        {patch.error && <div className="patch-error">{patch.error}</div>}
                        <div className="patch-actions">
                          <button className="primary small" disabled={patch.status !== "pending"} onClick={() => applyPatch(patch.id)}>{t.apply}</button>
                          <button className="secondary small" disabled={patch.status !== "pending"} onClick={() => discardPatch(patch.id)}>{t.discard}</button>
                        </div>
                      </details>
                    ))}
                  </section>
                )}
                {activeCommands.length > 0 && (
                  <section className="patch-stack">
                    <div className="panel-title command-title">
                      <span>{t.commandApprovals}</span>
                      {commandAutoApproval && <button className="secondary tiny" onClick={resetCommandAutoApproval}>{t.restoreConfirm}</button>}
                    </div>
                    {commandAutoApproval && <div className="approval-banner">{t.autoApprovalBanner}</div>}
                    {activeCommands.map((command) => (
                      <details className={`patch-card command-card ${command.highRisk ? "high-risk" : ""} ${command.status}`} key={command.id} open={command.status === "pending" || command.status === "failed"}>
                        <summary>
                          <span>{command.command}</span>
                          <small>{command.highRisk ? `high / ${command.status}` : command.status}</small>
                        </summary>
                        <div className="patch-error">{command.error || command.reason}</div>
                        {command.result && <pre>{command.result}</pre>}
                        <div className="patch-actions">
                          <button className="primary small" disabled={command.status !== "pending"} onClick={() => approveCommand(command.id)}>{t.execute}</button>
                          <button className="primary small allow-future" disabled={command.status !== "pending"} onClick={() => approveCommand(command.id, true)}>{t.executeAllowFuture}</button>
                          <button className="secondary small" disabled={command.status !== "pending"} onClick={() => discardCommand(command.id)}>{t.discard}</button>
                        </div>
                      </details>
                    ))}
                  </section>
                )}
              </div>
            </section>
          )}
          {busy && <div className="thinking">{t.thinking}</div>}
          <div ref={bottomRef} />
        </div>

        <footer className="composer" style={{ height: `${composerHeight + 30}px` }}>
          <div
            className="composer-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label={language === "zh" ? "调整底部对话框高度" : "Resize composer height"}
            onPointerDown={startComposerResize}
          />
          <div className="composer-surface">
            {attachedFiles.length > 0 && (
              <div className="composer-attachments">
                {attachedFiles.map((file) => (
                  <button key={file.path} type="button" onClick={() => detachFile(file.path)} title={t.removeContextTitle}>{file.path} ×</button>
                ))}
              </div>
            )}
            <textarea
              ref={composerInputRef}
              value={input}
              placeholder={t.composerPlaceholder}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-controls">
              <label className="permission-inline" title={permissionMode === "full" ? t.fullAccessPermissionHint : t.defaultPermissionHint}>
                <span>{t.permissionMode}</span>
                <select value={permissionMode} onChange={(event) => updatePermissionMode(event.target.value as PermissionMode)}>
                  <option value="default">{t.defaultPermission}</option>
                  <option value="full">{t.fullAccessPermission}</option>
                </select>
              </label>
              <div className="composer-actions">
                {!isOnline && <span className="offline-pill">{t.offlineTitle}</span>}
                <span className={`context-meter ${contextPercent >= 90 ? "danger" : contextPercent >= 70 ? "warn" : ""}`} title={`${t.contextUsage}: ${sessionContextTokenCount.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} / ${config.contextTokens.toLocaleString(language === "zh" ? "zh-CN" : "en-US")} tokens`}>
                  {contextUsageLabel}
                </span>
                <button className="composer-icon" type="button" disabled={busy} onClick={uploadAttachmentFiles} title={t.uploadFiles} aria-label={t.uploadFiles}>+</button>
                {busy && <button className="composer-icon danger" type="button" onClick={cancelActiveRequest} title={t.stop} aria-label={t.stop}>■</button>}
                <button className="send composer-send" type="button" disabled={busy || !input.trim()} onClick={send} title={t.send} aria-label={t.send}>↑</button>
              </div>
            </div>
          </div>
        </footer>
      </main>

      <div
        className="column-resize-handle right"
        role="separator"
        aria-orientation="vertical"
        aria-label={language === "zh" ? "调整右侧边栏宽度" : "Resize right sidebar"}
        onPointerDown={(event) => startColumnResize("right", event)}
      />

      <aside className="activity">
        <nav className="right-tabs" aria-label={language === "zh" ? "右侧栏页面" : "Right sidebar sections"}>
          <button className={rightSidebarSection === "plan" ? "active" : ""} onClick={() => setRightSidebarSection("plan")}>{t.plan}</button>
          <button className={rightSidebarSection === "activity" ? "active" : ""} onClick={() => setRightSidebarSection("activity")}>{t.activity}</button>
        </nav>

        {rightSidebarSection === "plan" && (
          <div className="right-panel plan-panel">
            {planItems.length === 0 && <div className="muted">{t.planEmpty}</div>}
            {planItems.length > 0 && (
              <ol className="plan-list">
                {planItems.map((item, index) => (
                  <li className={`plan-row ${item.status}`} key={`${item.step}-${index}`}>
                    <span className="plan-check">{item.status === "completed" ? "✓" : item.status === "in_progress" ? "•" : ""}</span>
                    <span>{item.step}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {rightSidebarSection === "activity" && (
          <>
            <div className="activity-controls">
              <div className="activity-filter-tabs" role="tablist" aria-label={t.activity}>
                {([
                  ["all", t.activityFilterAll],
                  ["tool", t.activityFilterTool],
                  ["error", t.activityFilterError],
                  ["approval", t.activityFilterApproval],
                  ["system", t.activityFilterSystem]
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={activityFilter === value ? "active" : ""}
                    type="button"
                    onClick={() => setActivityFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={activitySearch}
                onChange={(event) => setActivitySearch(event.target.value)}
                placeholder={t.activitySearchPlaceholder}
              />
            </div>
            <div className="event-list" ref={activityListRef}>
              {filteredEvents.length === 0 && <div className="muted">{events.length === 0 ? t.activityEmpty : t.activitySearchPlaceholder}</div>}
              {filteredEvents.map((event) => (
                <details className={`event ${event.kind}`} key={event.id} open={event.kind === "error"}>
                  <summary>{event.title}</summary>
                  <pre>{event.body}</pre>
                </details>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
