import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentEvent, AttachedFile, ChatMessage, GitSummary, PlanItem, ProviderConfig, WorkspaceTreeItem } from "./global";
import "./styles.css";

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
  status: "pending" | "approved" | "discarded" | "failed";
  result?: string;
  error?: string;
};

const defaultConfig: ProviderConfig = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 32768,
  contextTokens: 1000000,
  thinkingMode: "enabled",
  reasoningEffort: "max"
};

function App() {
  const [workspace, setWorkspace] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [tree, setTree] = useState<WorkspaceTreeItem[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [previewFile, setPreviewFile] = useState<AttachedFile | null>(null);
  const [gitSummary, setGitSummary] = useState<GitSummary | null>(null);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [config, setConfig] = useState<ProviderConfig>(defaultConfig);
  const [busy, setBusy] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const activeRequest = useRef<string | null>(null);
  const streamingMessageActive = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.agentWindow.loadConfig().then(({ config: fileConfig, path }) => {
      const savedKey = localStorage.getItem("agent-api-key") || "";
      setConfig({ ...defaultConfig, ...fileConfig, apiKey: savedKey });
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
    localStorage.setItem("agent-api-key", config.apiKey);
    window.agentWindow.saveConfig(config).catch((error) => {
      appendEvent("error", "配置保存失败", error instanceof Error ? error.message : String(error));
    });
  }, [config, configLoaded]);

  useEffect(() => {
    return window.agentWindow.onAgentEvent((event) => {
      if (event.requestId !== activeRequest.current) return;
      handleAgentEvent(event);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, events, busy]);

  const providerHint = useMemo(() => {
    if (config.provider === "deepseek") return "DeepSeek 参数从配置文件读取，API key 可用环境变量或本机临时保存。";
    return "适合任何 OpenAI Chat Completions 兼容网关。";
  }, [config.provider]);

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
        { id: event.commandId, command: event.command, reason: event.reason, status: "pending" },
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
  }

  function appendEvent(kind: EventLogItem["kind"], title: string, body: string) {
    setEvents((current) => [...current, { id: crypto.randomUUID(), title, body, kind }]);
  }

  async function chooseWorkspace() {
    const selected = await window.agentWindow.chooseWorkspace();
    if (selected) {
      setWorkspace(selected);
      setAttachedFiles([]);
      setPreviewFile(null);
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
    if (attachedFiles.some((file) => file.path === path)) return;
    const file = await window.agentWindow.readFile({ workspace, path });
    setAttachedFiles((current) => [...current, file]);
  }

  function detachFile(path: string) {
    setAttachedFiles((current) => current.filter((file) => file.path !== path));
  }

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    if (!workspace) {
      appendEvent("error", "缺少 workspace", "请先选择一个工作区目录。");
      return;
    }

    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    streamingMessageActive.current = false;
    setBusy(true);
    setInput("");
    setPlanItems([{ step: "等待模型生成计划", status: "in_progress" }]);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);

    await window.agentWindow.sendMessage({
      requestId,
      workspace,
      input: trimmed,
      providerConfig: config,
      messages,
      attachments: attachedFiles
    });
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

  async function applyPatch(patchId: string) {
    setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "pending", error: undefined } : patch));
    const result = await window.agentWindow.applyPatch(patchId);
    if (result.ok) {
      setPatches((current) => current.map((patch) => patch.id === patchId ? { ...patch, status: "applied" } : patch));
      appendEvent("patch", "Patch 已应用", result.result.summary);
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

  async function approveCommand(commandId: string) {
    const result = await window.agentWindow.approveCommand(commandId);
    if (result.ok) {
      setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "approved", result: result.result.result } : command));
      appendEvent("tool", `命令已执行：${result.result.command}`, result.result.result);
    } else {
      setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "failed", error: result.error } : command));
      appendEvent("error", "命令执行失败", result.error);
    }
  }

  async function discardCommand(commandId: string) {
    await window.agentWindow.discardCommand(commandId);
    setCommands((current) => current.map((command) => command.id === commandId ? { ...command, status: "discarded" } : command));
  }

  function updateProvider(provider: ProviderConfig["provider"]) {
    const nextDefaults =
      provider === "deepseek"
        ? { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", thinkingMode: "enabled" as const, reasoningEffort: "max" as const, contextTokens: 1000000, maxTokens: 32768 }
        : { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", thinkingMode: "disabled" as const, reasoningEffort: "medium" as const, contextTokens: 128000, maxTokens: 4096 };
    setConfig((current) => ({ ...current, provider, ...nextDefaults }));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <h1>Agent Window</h1>
            <p>DeepSeek-first desktop demo</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-title">Workspace</div>
          <button className="primary" onClick={chooseWorkspace}>选择目录</button>
          <div className="path-box">{workspace || "未选择"}</div>
          <div className="row-actions">
            <button className="secondary" onClick={() => refreshWorkspace()} disabled={!workspace}>刷新文件</button>
            <button className="secondary" onClick={() => refreshGit()} disabled={!workspace}>刷新 Git</button>
          </div>
        </section>

        <section className="panel compact-panel">
          <div className="panel-title">Git</div>
          {gitSummary ? (
            <>
              <div className="metric">Branch <strong>{gitSummary.branch}</strong></div>
              <button className="secondary full" onClick={showGitDiff}>查看 git diff</button>
              <div className="commit-draft">{gitSummary.commitDraft}</div>
              <div className="changed-list">
                {gitSummary.changedFiles.length === 0 && <span className="muted">No changes</span>}
                {gitSummary.changedFiles.map((file) => (
                  <button key={`${file.status}-${file.path}`} onClick={() => openFile(file.path.replace(/^"|"$/g, ""))}>
                    <span>{file.status}</span>{file.path}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">选择 Git workspace 后显示分支和变更。</p>
          )}
        </section>

        <section className="panel compact-panel">
          <div className="panel-title">Files</div>
          <div className="file-tree">
            {tree.length === 0 && <span className="muted">暂无文件树</span>}
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

        <section className="panel">
          <div className="panel-title">Provider</div>
          <select value={config.provider} onChange={(event) => updateProvider(event.target.value as ProviderConfig["provider"])}>
            <option value="deepseek">DeepSeek</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
          <label>
            Base URL
            <input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />
          </label>
          <label>
            Model
            <input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={config.apiKey}
              placeholder="可留空使用环境变量"
              onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
            />
          </label>
          <button className="secondary full" onClick={testApi} disabled={busy || testingApi}>
            {testingApi ? "检测中..." : "检测 API"}
          </button>
          <label>
            Context Budget
            <input
              type="number"
              min="4096"
              step="4096"
              value={config.contextTokens}
              onChange={(event) => setConfig({ ...config, contextTokens: Number(event.target.value) })}
            />
          </label>
          <label>
            Max Output Tokens
            <input
              type="number"
              min="1"
              step="1024"
              value={config.maxTokens}
              onChange={(event) => setConfig({ ...config, maxTokens: Number(event.target.value) })}
            />
          </label>
          <label>
            Thinking Mode
            <select
              value={config.thinkingMode}
              onChange={(event) => setConfig({ ...config, thinkingMode: event.target.value as ProviderConfig["thinkingMode"] })}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            Reasoning Effort
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
            Temperature
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
          {configPath && <p className="hint file-hint">Config: {configPath}</p>}
        </section>
      </aside>

      <main className="conversation">
        <header className="topbar">
          <div>
            <strong>Agent Session</strong>
            <span>{busy ? "运行中" : "就绪"}</span>
          </div>
          <button className="secondary" onClick={() => { setMessages([]); setEvents([]); setPatches([]); setCommands([]); setPlanItems([]); }} disabled={busy}>清空</button>
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
                  <button key={file.path} onClick={() => detachFile(file.path)} title="点击移除上下文附件">{file.path} ×</button>
                ))}
              </div>
            )}
            {previewFile && (
              <details className="file-preview">
                <summary>
                  <span>{previewFile.path}</span>
                  <button onClick={(event) => { event.preventDefault(); attachFile(previewFile.path); }}>加入上下文</button>
                </summary>
                <pre>{previewFile.content}</pre>
              </details>
            )}
          </section>
        )}

        <div className="message-list">
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>选择工作区后开始任务</h2>
              <p>例如：列出这个项目的文件结构，读 README，然后告诉我如何启动。</p>
            </div>
          )}
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="role">{message.role === "user" ? "You" : "Agent"}</div>
              <pre>{message.content}</pre>
            </article>
          ))}
          {busy && <div className="thinking">Agent 正在处理...</div>}
          <div ref={bottomRef} />
        </div>

        <footer className="composer">
          <textarea
            value={input}
            placeholder="让 agent 检查、修改或运行这个 workspace..."
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send();
            }}
          />
          <button className="send" disabled={busy || !input.trim()} onClick={send}>发送</button>
        </footer>
      </main>

      <aside className="activity">
        <div className="activity-header">Activity</div>
        <div className="event-list">
          {patches.length > 0 && (
            <section className="patch-stack">
              <div className="panel-title">Pending Changes</div>
              {patches.map((patch) => (
                <details className={`patch-card ${patch.status}`} key={patch.id} open={patch.status === "pending" || patch.status === "failed"}>
                  <summary>
                    <span>{patch.summary}</span>
                    <small>{patch.status}</small>
                  </summary>
                  <pre>{patch.patch}</pre>
                  {patch.error && <div className="patch-error">{patch.error}</div>}
                  <div className="patch-actions">
                    <button className="primary small" disabled={patch.status !== "pending"} onClick={() => applyPatch(patch.id)}>应用</button>
                    <button className="secondary small" disabled={patch.status !== "pending"} onClick={() => discardPatch(patch.id)}>放弃</button>
                  </div>
                </details>
              ))}
            </section>
          )}
          {commands.length > 0 && (
            <section className="patch-stack">
              <div className="panel-title">Command Approvals</div>
              {commands.map((command) => (
                <details className={`patch-card command-card ${command.status}`} key={command.id} open={command.status === "pending" || command.status === "failed"}>
                  <summary>
                    <span>{command.command}</span>
                    <small>{command.status}</small>
                  </summary>
                  <div className="patch-error">{command.error || command.reason}</div>
                  {command.result && <pre>{command.result}</pre>}
                  <div className="patch-actions">
                    <button className="primary small" disabled={command.status !== "pending"} onClick={() => approveCommand(command.id)}>执行</button>
                    <button className="secondary small" disabled={command.status !== "pending"} onClick={() => discardCommand(command.id)}>放弃</button>
                  </div>
                </details>
              ))}
            </section>
          )}
          {events.length === 0 && patches.length === 0 && commands.length === 0 && <div className="muted">工具调用、模型用量和错误会显示在这里。</div>}
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
