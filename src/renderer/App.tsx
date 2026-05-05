import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentEvent, AttachedFile, ChatMessage, GitSummary, PlanItem, ProviderBalanceResult, ProviderConfig, WorkspaceTreeItem } from "./global";
import "./styles.css";

const appName = "Bruce的秘密基地";
const brandIconUrl = new URL("./assets/bruce-secret-base.jpg", import.meta.url).href;

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
  createdAt: number;
  updatedAt: number;
};

type SidebarSection = "files" | "advanced" | "help";
type ThemeMode = "light" | "dark";
type Language = "zh" | "en";

const CHAT_SESSIONS_KEY = "agent-chat-sessions";
const THEME_KEY = "agent-ui-theme";
const LANGUAGE_KEY = "agent-ui-language";
const LEFT_SIDEBAR_WIDTH_KEY = "agent-left-sidebar-width";
const RIGHT_SIDEBAR_WIDTH_KEY = "agent-right-sidebar-width";
const COMPOSER_HEIGHT_KEY = "agent-composer-height";
const MAX_SAVED_SESSIONS = 30;
const MIN_LEFT_SIDEBAR_WIDTH = 220;
const MAX_LEFT_SIDEBAR_WIDTH = 480;
const MIN_RIGHT_SIDEBAR_WIDTH = 260;
const MAX_RIGHT_SIDEBAR_WIDTH = 560;
const MIN_CONVERSATION_WIDTH = 440;
const RESIZE_HANDLE_WIDTH = 7;
const MIN_COMPOSER_HEIGHT = 72;
const MAX_COMPOSER_HEIGHT = 260;

const translations = {
  zh: {
    newChat: "新建",
    chats: "Chats",
    workspace: "Workspace",
    chooseFolder: "选择目录",
    notSelected: "未选择",
    refreshFiles: "刷新文件",
    advancedMenu: "进阶菜单",
    files: "文件",
    advanced: "进阶",
    help: "帮助",
    searchPlaceholder: "搜索文件内容",
    searching: "搜索中",
    search: "搜索",
    noFiles: "暂无文件树",
    git: "Git",
    viewGitDiff: "查看 git diff",
    refreshGit: "刷新 Git",
    noChanges: "No changes",
    gitHint: "选择 Git workspace 后显示分支和变更。",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "Model",
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
    helpTitle: "Help",
    helpChatsTitle: "对话与历史",
    helpChatsBody: `点击“新建”会开启一个新的 agent 会话；左侧 Chats 列表会保留最近 ${MAX_SAVED_SESSIONS} 个对话。选择历史对话会恢复消息和当时的 workspace。`,
    helpWorkspaceTitle: "Workspace 与文件",
    helpWorkspaceBody: "先选择一个项目目录。Files 页面会显示文件树，可以点文件预览，再把文件加入上下文。搜索框会优先使用 rg 搜索内容。",
    helpProviderTitle: "模型与 API",
    helpProviderBody: "进入“进阶”页面，在 Provider 中选择 DeepSeek 或 OpenAI-compatible。切换 provider 会自动填入默认 Base URL、模型名、上下文预算和输出 token。API Key 会用 Electron safeStorage 加密保存，也可以用环境变量提供。",
    helpGitTitle: "Git diff 与变更",
    helpGitBody: "Git 功能在“进阶”页面。它会显示当前分支、变更文件和提交信息草稿。点击“查看 git diff”会把未暂存 diff 输出到右侧 Activity，点击变更文件可以直接预览。",
    helpPatchTitle: "Patch 审批",
    helpPatchBody: "agent 修改文件时会先提交 unified diff，不会立刻写入磁盘。你可以在右侧 Pending Changes 中查看 patch，选择应用或放弃。应用后会自动刷新文件树和 Git 状态。",
    helpCommandTitle: "命令与高危操作",
    helpCommandBody: "只读命令会自动执行；安装依赖、联网、删除文件、重置 Git 等操作会进入 Command Approvals。选择“执行并允许后续”后，本次应用运行期间后续命令会自动执行，也可以随时恢复确认。",
    helpLongTaskTitle: "长时间任务",
    helpLongTaskBody: "agent 会持续进行多轮工具调用，并在顶部显示运行状态。运行中可以点击“停止”取消当前请求。右侧 Activity 会记录工具调用、模型用量、错误和命令结果。",
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
    composerPlaceholder: "让 agent 检查、修改或运行这个 workspace...",
    uploadFiles: "上传文件",
    send: "发送",
    activity: "Activity",
    needsApproval: "Needs Approval",
    pendingChanges: "Pending Changes",
    commandApprovals: "Command Approvals",
    restoreConfirm: "恢复确认",
    autoApprovalBanner: "后续命令请求已自动允许，直到应用重启或手动恢复确认。",
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
    refreshFiles: "Refresh Files",
    advancedMenu: "Advanced",
    files: "Files",
    advanced: "Advanced",
    help: "Help",
    searchPlaceholder: "Search file contents",
    searching: "Searching",
    search: "Search",
    noFiles: "No file tree yet",
    git: "Git",
    viewGitDiff: "View git diff",
    refreshGit: "Refresh Git",
    noChanges: "No changes",
    gitHint: "Select a Git workspace to show branch and changes.",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "Model",
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
    helpTitle: "Help",
    helpChatsTitle: "Chats and History",
    helpChatsBody: `Click New to start a fresh agent chat. The Chats list keeps the latest ${MAX_SAVED_SESSIONS} conversations. Selecting a history item restores its messages and workspace.`,
    helpWorkspaceTitle: "Workspace and Files",
    helpWorkspaceBody: "Choose a project folder first. The Files page shows a file tree, supports previewing files, and lets you attach files as context. Search uses rg first when available.",
    helpProviderTitle: "Models and API",
    helpProviderBody: "Open Advanced and use Provider to switch between DeepSeek and OpenAI-compatible APIs. Switching provider fills default Base URL, model, context budget, and output tokens. API keys are encrypted with Electron safeStorage, or can be provided through environment variables.",
    helpGitTitle: "Git Diff and Changes",
    helpGitBody: "Git lives under Advanced. It shows the current branch, changed files, and a commit-message draft. View git diff writes the unstaged diff to Activity, and changed files can be opened for preview.",
    helpPatchTitle: "Patch Approval",
    helpPatchBody: "When the agent edits files, it proposes a unified diff first and does not write immediately. Review it in Pending Changes, then apply or discard it. Applying refreshes the file tree and Git state.",
    helpCommandTitle: "Commands and High-risk Actions",
    helpCommandBody: "Read-only commands run automatically. Installing dependencies, network access, deleting files, Git resets, and similar actions appear in Command Approvals. Execute and allow future approvals lets later commands run automatically for this app session.",
    helpLongTaskTitle: "Long-running Work",
    helpLongTaskBody: "The agent can keep calling tools across many rounds and shows status at the top. Use Stop to cancel the active request. Activity records tool calls, model usage, errors, and command output.",
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
    composerPlaceholder: "Ask the agent to inspect, modify, or run this workspace...",
    uploadFiles: "Upload",
    send: "Send",
    activity: "Activity",
    needsApproval: "Needs Approval",
    pendingChanges: "Pending Changes",
    commandApprovals: "Command Approvals",
    restoreConfirm: "Restore confirm",
    autoApprovalBanner: "Future command requests are automatically allowed until the app restarts or confirmation is restored.",
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
    createdAt: now,
    updatedAt: now
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
          : [],
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

function MarkdownContent({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = String(content ?? "").split(/\r?\n/);
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let codeLines: string[] = [];
  let codeLanguage = "";
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(paragraph.join("\n"))}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const children = listItems.map((item, index) => <li key={index}>{renderInline(item)}</li>);
    blocks.push(listType === "ol" ? <ol key={`ol-${blocks.length}`}>{children}</ol> : <ul key={`ul-${blocks.length}`}>{children}</ul>);
    listItems = [];
    listType = null;
  };

  const flushCode = () => {
    blocks.push(
      <pre className="markdown-code" key={`code-${blocks.length}`}>
        {codeLanguage && <span className="markdown-code-language">{codeLanguage}</span>}
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
    codeLines = [];
    codeLanguage = "";
  };

  for (const line of lines) {
    const fence = line.match(/^```([\w.-]*)\s*$/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLanguage = fence[1] || "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 4);
      const content = renderInline(heading[2]);
      if (level === 1) blocks.push(<h1 key={`h-${blocks.length}`}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${blocks.length}`}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={`h-${blocks.length}`}>{content}</h3>);
      else blocks.push(<h4 key={`h-${blocks.length}`}>{content}</h4>);
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInline(quote[1])}</blockquote>);
      continue;
    }

    const list = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (list) {
      flushParagraph();
      const nextType = list[2] ? "ol" : "ul";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push(list[3]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();

  return <div className="markdown-content">{blocks.length > 0 ? blocks : <p />}</div>;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = nodes.length;
    if (match[2] && match[3]) {
      const href = safeHref(match[3]);
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer">{match[2]}</a> : match[2]);
    } else if (match[4]) {
      nodes.push(<code key={key}>{match[4]}</code>);
    } else if (match[5]) {
      nodes.push(<strong key={key}>{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={key}>{match[6]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function safeHref(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
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
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [tree, setTree] = useState<WorkspaceTreeItem[]>([]);
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
  const [tokenUsage, setTokenUsage] = useState<TokenUsageStats>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0
  });
  const [commandAutoApproval, setCommandAutoApproval] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const activeRequest = useRef<string | null>(null);
  const streamingMessageActive = useRef(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
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
    const savedSessions = loadChatSessions();
    const initialSession = savedSessions[0] ?? createBlankSession(workspace);
    const nextSessions = savedSessions.length > 0 ? savedSessions : [initialSession];
    setSessions(nextSessions);
    setActiveSessionId(initialSession.id);
    setMessages(initialSession.messages);
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
            updatedAt: Date.now()
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SAVED_SESSIONS);
      saveChatSessions(next);
      return next;
    });
  }, [activeSessionId, messages, sessionsLoaded, workspace]);


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
  }, [messages, events, busy]);

  const providerHint = useMemo(() => {
    if (config.provider === "deepseek") return t.providerHintDeepSeek;
    return t.providerHintCompatible;
  }, [config.provider, t]);

  function handleAgentEvent(event: AgentEvent) {
    if (event.type === "done") {
      setPlanItems((current) => current.map((item) => item.status === "in_progress" ? { ...item, status: "completed" } : item));
      setBusy(false);
      activeRequest.current = null;
      streamingMessageActive.current = false;
      return;
    }

    if (event.type === "stream_delta") {
      setMessages((current) => {
        if (!streamingMessageActive.current || current[current.length - 1]?.role !== "assistant") {
          streamingMessageActive.current = true;
          return [...current, { role: "assistant", content: event.text }];
        }
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + event.text };
        return next;
      });
      return;
    }

    if (event.type === "plan_update") {
      setPlanItems(event.items);
      return;
    }

    if (event.type === "model") {
      if (event.message.trim() && !streamingMessageActive.current) {
        setMessages((current) => [...current, { role: "assistant", content: event.message }]);
      }
      streamingMessageActive.current = false;
      recordTokenUsage(event.usage);
      setEvents((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          title: `${event.provider} / ${event.model}${event.finishReason ? ` / ${event.finishReason}` : ""}`,
          body: JSON.stringify(
            {
              usage: event.usage ?? null,
              reasoning_preview: event.reasoning ? event.reasoning.slice(0, 1200) : ""
            },
            null,
            2
          ),
          kind: "model"
        }
      ]);
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

    if (event.type === "command_pending") {
      setCommands((current) => [
        { id: event.commandId, command: event.command, reason: event.reason, highRisk: Boolean(event.highRisk), status: "pending" },
        ...current
      ]);
      appendEvent("tool", "命令等待确认", event.command);
      return;
    }

    if (event.type === "error") {
      appendEvent("error", "Agent 错误", event.message);
      setMessages((current) => [...current, { role: "assistant", content: `请求失败：${event.message}` }]);
      setBusy(false);
      activeRequest.current = null;
      streamingMessageActive.current = false;
    }

    if (event.type === "cancelled") {
      appendEvent("status", "请求已取消", event.message);
      setMessages((current) => [...current, { role: "assistant", content: "请求已取消。" }]);
      setBusy(false);
      activeRequest.current = null;
      streamingMessageActive.current = false;
    }
  }

  function appendEvent(kind: EventLogItem["kind"], title: string, body: string) {
    setEvents((current) => [...current, { id: crypto.randomUUID(), title, body, kind }]);
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
    setPlanItems([]);
    setAttachedFiles([]);
    setPreviewFile(null);
    setSearchResults([]);
    setFileSearch("");
    streamingMessageActive.current = false;
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
    resetTransientState();
  }

  async function selectSession(sessionId: string) {
    if (busy || sessionId === activeSessionId) return;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(session.id);
    setMessages(session.messages);
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

  function clearCurrentSession() {
    if (busy) return;
    setMessages([]);
    resetTransientState();
  }

  async function chooseWorkspace() {
    const selected = await window.agentWindow.chooseWorkspace();
    if (selected) {
      setWorkspace(selected);
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
    } catch (error) {
      appendEvent("error", "文件树读取失败", error instanceof Error ? error.message : String(error));
    }
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

    if (!workspace && attachedFiles.length === 0) {
      appendEvent("error", "缺少 workspace", "请先选择一个工作区目录。");
      return;
    }

    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    streamingMessageActive.current = false;
    followOutputRef.current = true;
    setBusy(true);
    setInput("");
    setPlanItems([{ step: t.waitingPlan, status: "in_progress" }]);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);

    await window.agentWindow.sendMessage({
      requestId,
      workspace: workspace || ".",
      input: trimmed,
      providerConfig: config,
      messages,
      attachments: attachedFiles
    });
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
      appendEvent("patch", "Patch 已应用", result.result.summary);
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
    appendEvent("status", "后续命令确认已恢复", "agent 后续高危或副作用命令会再次请求确认。");
  }

  function updateProvider(provider: ProviderConfig["provider"]) {
    const nextDefaults =
      provider === "deepseek"
        ? { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", thinkingMode: "enabled" as const, reasoningEffort: "max" as const, contextTokens: 1000000, maxTokens: 32768 }
        : { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", thinkingMode: "disabled" as const, reasoningEffort: "medium" as const, contextTokens: 128000, maxTokens: 4096 };
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
              <button
                className={`session-item ${session.id === activeSessionId ? "active" : ""}`}
                key={session.id}
                onClick={() => selectSession(session.id)}
                disabled={busy}
              >
                <strong>{session.title}</strong>
                <span>{session.messages.length} {t.messagesUnit} · {formatSessionTime(session.updatedAt, language)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">{t.workspace}</div>
          <button className="primary" onClick={chooseWorkspace}>{t.chooseFolder}</button>
          <div className="path-box">{workspace || t.notSelected}</div>
          <div className="row-actions">
            <button className="secondary" onClick={() => refreshWorkspace()} disabled={!workspace}>{t.refreshFiles}</button>
            <button className="secondary" onClick={() => setSidebarSection("advanced")}>{t.advancedMenu}</button>
          </div>
        </section>

        <nav className="section-tabs" aria-label={t.sidebarNav}>
          <button className={sidebarSection === "files" ? "active" : ""} onClick={() => setSidebarSection("files")}>{t.files}</button>
          <button className={sidebarSection === "advanced" ? "active" : ""} onClick={() => setSidebarSection("advanced")}>{t.advanced}</button>
          <button className={sidebarSection === "help" ? "active" : ""} onClick={() => setSidebarSection("help")}>{t.help}</button>
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
              {tree.map((item) => (
                <button
                  className={`file-node ${item.type}`}
                  key={item.path}
                  style={{ paddingLeft: `${8 + item.depth * 12}px` }}
                  disabled={item.type === "directory"}
                  onClick={() => openFile(item.path)}
                >
                  <span>{item.type === "directory" ? "▸" : "·"}</span>{item.name}
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

        {sidebarSection === "help" && (
          <section className="panel help-panel">
            <div className="panel-title">{t.helpTitle}</div>
            <details open>
              <summary>{t.helpChatsTitle}</summary>
              <p>{t.helpChatsBody}</p>
            </details>
            <details>
              <summary>{t.helpWorkspaceTitle}</summary>
              <p>{t.helpWorkspaceBody}</p>
            </details>
            <details>
              <summary>{t.helpProviderTitle}</summary>
              <p>{t.helpProviderBody}</p>
            </details>
            <details>
              <summary>{t.helpGitTitle}</summary>
              <p>{t.helpGitBody}</p>
            </details>
            <details>
              <summary>{t.helpPatchTitle}</summary>
              <p>{t.helpPatchBody}</p>
            </details>
            <details>
              <summary>{t.helpCommandTitle}</summary>
              <p>{t.helpCommandBody}</p>
            </details>
            <details>
              <summary>{t.helpLongTaskTitle}</summary>
              <p>{t.helpLongTaskBody}</p>
            </details>
          </section>
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
            <button className="secondary" onClick={clearCurrentSession} disabled={busy}>{t.clear}</button>
          </div>
        </header>

        {(attachedFiles.length > 0 || previewFile || planItems.length > 0) && (
          <section className="context-strip">
            {planItems.length > 0 && (
              <div className="plan-view">
                {planItems.map((item, index) => (
                  <span className={`plan-chip ${item.status}`} key={`${item.step}-${index}`}>{item.step}</span>
                ))}
              </div>
            )}
            {attachedFiles.length > 0 && (
              <div className="attachments">
                {attachedFiles.map((file) => (
                  <button key={file.path} onClick={() => detachFile(file.path)} title={t.removeContextTitle}>{file.path} ×</button>
                ))}
              </div>
            )}
            {previewFile && (
              <details className="file-preview">
                <summary>
                  <span>{previewFile.path}</span>
                  <button onClick={(event) => { event.preventDefault(); attachFile(previewFile.path); }}>{t.addContext}</button>
                </summary>
                <pre>{previewFile.content}</pre>
              </details>
            )}
          </section>
        )}

        <div className="message-list" ref={messageListRef} onScroll={updateOutputFollowState}>
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>{t.emptyTitle}</h2>
              <p>{t.emptyBody}</p>
            </div>
          )}
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="role">{message.role === "user" ? t.you : t.agent}</div>
              <div className="message-body">
                <MarkdownContent content={message.content} />
              </div>
            </article>
          ))}
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
          <button className="upload-button" type="button" disabled={busy} onClick={uploadAttachmentFiles}>{t.uploadFiles}</button>
          <textarea
            value={input}
            placeholder={t.composerPlaceholder}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send();
            }}
          />
          <button className="send" disabled={busy || !input.trim()} onClick={send}>{t.send}</button>
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
        <div className="activity-header">{t.activity}</div>
        {(patches.length > 0 || commands.length > 0) && (
          <div className="approval-dock">
            <div className="approval-dock-title">{t.needsApproval}</div>
            {patches.length > 0 && (
            <section className="patch-stack">
              <div className="panel-title">{t.pendingChanges}</div>
              {patches.map((patch) => (
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
            {commands.length > 0 && (
            <section className="patch-stack">
              <div className="panel-title command-title">
                <span>{t.commandApprovals}</span>
                {commandAutoApproval && <button className="secondary tiny" onClick={resetCommandAutoApproval}>{t.restoreConfirm}</button>}
              </div>
              {commandAutoApproval && <div className="approval-banner">{t.autoApprovalBanner}</div>}
              {commands.map((command) => (
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
        )}
        <div className="event-list">
          {events.length === 0 && patches.length === 0 && commands.length === 0 && <div className="muted">{t.activityEmpty}</div>}
          {events.map((event) => (
            <details className={`event ${event.kind}`} key={event.id} open={event.kind === "error"}>
              <summary>{event.title}</summary>
              <pre>{event.body}</pre>
            </details>
          ))}
        </div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
