# AgentDesk

AgentDesk is a local desktop coding agent built with Electron, React, and TypeScript. It is designed for DeepSeek by default and also supports OpenAI-compatible Chat Completions providers.

AgentDesk 是一个本地桌面 coding agent 应用，使用 Electron、React 和 TypeScript 构建。它默认面向 DeepSeek API，同时兼容 OpenAI Chat Completions 风格的网关。

The goal is to provide an installable local window where you can choose a workspace, attach files, ask an agent to read or modify code, run commands, review diffs, and keep task context organized by project.

项目目标是提供一个可安装的本地桌面窗口，让你可以选择工作目录、添加上下文文件、让 agent 阅读或修改代码、运行命令、查看 diff，并按项目管理任务上下文。

## Features / 主要能力

- Local desktop app with Windows installer, portable build, and zip package.
- 本地桌面应用，支持 Windows 安装版、便携版和 zip 压缩包。
- DeepSeek-first provider setup, with OpenAI-compatible provider support.
- DeepSeek 优先，同时支持 OpenAI-compatible provider。
- Chat sessions grouped by workspace in the left sidebar.
- 左侧聊天列表按工作目录分组。
- New-session guide page with workspace selection and quick-start prompts.
- 新会话初始引导页，可选择工作目录并使用快捷任务提示。
- File tree, search, file preview, and attachment support.
- 文件树、搜索、文件预览和上下文附件支持。
- Drag-and-drop file attachments when the app is launched from a compatible Windows context.
- 在兼容的 Windows 启动环境下支持拖拽文件作为附件。
- Streaming model output, task status bar, tool cards, plan panel, and activity log.
- 支持流式模型输出、任务状态条、工具卡片、计划面板和活动日志。
- Git status, changed-file list, diff view, and commit message draft.
- 支持 Git 状态、变更文件、diff 查看和 commit message 草稿。
- Default permission mode asks before writes, deletes, patches, and high-risk commands.
- 默认权限模式会在写入、删除、patch 和高风险命令前请求确认。
- Full access mode lets command and file-change tools run without approval for the current app session, while preserving `ask_user` for clarifying requirements.
- 完全访问权限模式会在当前应用会话内自动执行命令和文件变更，同时保留 `ask_user` 用于需求澄清。
- Local persistence for sessions, theme, language, sidebar width, and provider settings.
- 本地保存会话、主题、语言、侧栏宽度和 provider 设置。
- Encoding check, typecheck, tests, and production build are combined in `npm run check`.
- `npm run check` 集成编码检查、类型检查、测试和生产构建。

## Quick Start / 快速开始

### Install dependencies / 安装依赖

```powershell
npm install
```

### Start development app / 启动开发版

```powershell
npm run dev
```

Development mode starts the Vite frontend and the Electron window. The frontend uses port `5173` with strict port mode.

开发模式会启动 Vite 前端服务和 Electron 窗口。默认前端端口为 `5173`，并启用 strict port。

If an old dev process is occupying the port:

如果旧的 dev 进程占用了端口：

```powershell
npm run dev:clean
npm run dev
```

### Configure API Key / 配置 API Key

You can enter the API key in the app settings panel, or provide it through an environment variable:

你可以在应用设置面板中填写 API key，也可以使用环境变量：

```powershell
$env:DEEPSEEK_API_KEY="your-key"
npm run dev
```

Non-secret settings are stored in `agent-config.json`. API keys are not written to that file.

非密钥配置会保存到 `agent-config.json`。API key 不会写入该文件。

## User Guide / 使用引导

### 1. Create or select a session / 创建或选择会话

After opening AgentDesk, the left sidebar shows chats by default. Sessions are grouped by their bound workspace. New sessions without a workspace appear under the unselected workspace group.

打开 AgentDesk 后，左侧默认显示聊天栏。会话会按绑定的工作目录分组；未选择目录的新会话会显示在未选择工作目录分组下。

Click the `+` button in the sidebar to create a new session. A new session does not inherit the previous workspace. The center panel shows the initial guide page.

点击左侧 `+` 可以创建新会话。新会话不会继承旧工作目录，中间会话区会显示初始引导页。

### 2. Choose a workspace / 选择工作目录

On the guide page, click the folder selection button and choose the project directory you want the agent to work in.

在引导页点击选择目录按钮，选择你希望 agent 操作的项目目录。

After selection:

选择后：

- The current session is bound to that workspace.
- 当前会话会绑定该工作目录。
- File tree and Git status refresh.
- 文件树和 Git 状态会刷新。
- The session appears under that workspace group in the sidebar.
- 该会话之后会在左侧按这个目录分组。

### 3. Start a task / 开始任务

Type a task directly, for example:

你可以直接输入任务，例如：

```text
Read the README and tell me how to start this project.
```

You can also click a quick task on the guide page to fill the input box.

也可以点击引导页上的快捷任务，让输入框自动填入常见任务提示。

### 4. Add context files / 添加上下文文件

There are three ways to add files:

有三种方式可以添加文件：

- Click the `+` button near the input box.
- 点击输入框附近的 `+` 上传文件。
- Drag files from Windows Explorer into the input area.
- 从系统文件管理器拖拽文件到输入区。
- Open a file in the Files view and add it to context.
- 在 Files 视图中打开文件后加入上下文。

Attachments are read through the main process. AgentDesk marks oversized, binary, truncated, and duplicated attachments in the UI.

附件会通过主进程统一读取。AgentDesk 会在界面中标记超大、二进制、截断和重复附件等状态。

### 5. Use sidebar sections / 切换左侧功能页

The top of the sidebar contains three buttons:

左侧顶部包含三个按钮：

- `Chats`: chat sessions grouped by workspace.
- `Chats`：按工作目录分组的聊天列表。
- `Files`: file tree, search, and preview entry for the current workspace.
- `Files`：当前工作目录的文件树、搜索和预览入口。
- `Settings`: provider, model, API key, token budget, and agent step settings.
- `Settings`：provider、模型、API key、token、上下文预算和 agent 步数设置。

### 6. Permission modes / 权限模式

The permission switch is near the input box.

权限切换位于输入框附近。

- Default access: read-only and low-risk commands can run automatically; writes, deletes, patches, and high-risk commands ask for approval.
- 默认权限：只读和低风险命令可自动运行；写入、删除、patch 和高风险命令会请求确认。
- Full access: command and file-change tools run automatically for the current app session and workspace, without permission popups.
- 完全访问权限：当前应用会话和工作目录内，命令和文件变更会自动执行，不再弹出权限审批。

`ask_user` is not a permission approval. Even in full access mode, the agent can still ask you clarifying questions when requirements are unclear.

`ask_user` 不属于权限审批。即使启用完全访问权限，agent 仍可以在需求不清楚时向你提问。

## Windows Drag-and-Drop Notes / Windows 拖拽说明

Native Windows file drag-and-drop is affected by process integrity level. If Electron is launched from a sandbox host, elevated terminal, MSIX container, or a context that differs from Explorer, Windows may block the drop before the page receives any drag event. In that case the cursor shows the forbidden symbol.

Windows 原生文件拖拽会受到启动进程完整性级别影响。如果 Electron 从沙盒宿主、管理员终端、MSIX 容器，或与 Explorer 不同权限上下文中启动，系统可能会在页面收到拖拽事件前阻止拖放，鼠标会显示“禁止”符号。

Recommended launch method:

推荐启动方式：

```powershell
.\start-agent-window.cmd
```

Or start from a normal PowerShell window:

或者从普通 PowerShell 窗口启动：

```powershell
npm run dev
```

Avoid testing drag-and-drop from an administrator terminal, sandbox host, or special automation environment.

避免从管理员终端、沙盒宿主或特殊自动化环境中直接启动应用来测试拖拽。

## Build Windows Packages / 打包 Windows 安装包

Normal Windows build:

普通 Windows 构建：

```powershell
npm run dist:win
```

If the current Windows environment cannot create signing-tool symlinks, use the unsigned build:

如果当前 Windows 环境无法创建签名工具所需的符号链接，可以使用未签名构建：

```powershell
npm run dist:win:unsigned
```

Artifacts are written to `release/`:

产物输出到 `release/`：

- `AgentDesk-0.1.0-Setup-x64.exe`: installer.
- `AgentDesk-0.1.0-Setup-x64.exe`：安装器。
- `AgentDesk-0.1.0-Portable-x64.exe`: portable app.
- `AgentDesk-0.1.0-Portable-x64.exe`：便携版。
- `AgentDesk-0.1.0-win-x64.zip`: Windows x64 zip package.
- `AgentDesk-0.1.0-win-x64.zip`：Windows x64 压缩包。

Unsigned packages may trigger Windows SmartScreen or unknown publisher warnings.

未签名安装包可能触发 Windows SmartScreen 或“未知发布者”提示。

## Installer vs Portable / 安装版与便携版

Installer:

安装版：

- Installs into the system user app directory.
- 会安装到系统用户应用目录。
- Provides an uninstall entry.
- 有卸载入口。
- Better for long-term use.
- 更适合长期使用。

Portable:

便携版：

- Runs directly without installation.
- 不需要安装，双击运行。
- Useful for quick testing or removable drives.
- 适合临时测试或放在移动盘。
- Does not fully register a system uninstall entry.
- 不会完整注册系统卸载项。

## Development Scripts / 开发脚本

```powershell
npm run dev               # start development app / 启动开发版
npm run dev:clean         # clean old dev process on port 5173 / 清理占用 5173 的旧 dev 进程
npm run build             # Vite production build / Vite 生产构建
npm run pack              # create unpacked Electron app / 生成 unpacked Electron 应用
npm run dist:win          # build Windows installer, portable app, and zip / 构建 Windows 产物
npm run dist:win:unsigned # build unsigned Windows artifacts / 构建未签名 Windows 产物
npm run check             # encoding check + typecheck + tests + build / 编码检查 + 类型检查 + 测试 + 构建
```

## Project Structure / 项目结构

```text
src/
  main/        Electron main process, IPC, agent loop, tools, config, packaging logic
  renderer/    React UI, sessions, file tree, settings, approvals, activity panels
  shared/      Shared path safety, token, context budget, and provider logic
scripts/       Dev/build preflight and encoding checks
dist/          Vite build output, ignored by git
release/       electron-builder artifacts, ignored by git
```

## Quality Checks / 质量检查

Before committing or releasing:

提交或发布前运行：

```powershell
npm run check
```

This runs:

该命令会依次执行：

- `npm run check:encoding`
- `npm run typecheck`
- `npm test`
- `npm run build`

The encoding check scans for common mojibake markers so damaged Chinese strings do not silently break UI text or logic.

编码检查会扫描常见 mojibake 标记，避免中文源码字符串损坏后影响显示或逻辑判断。

## Release Flow / 发布流程

1. Run local checks.
2. Build Windows artifacts.
3. Commit source changes.
4. Push to GitHub.
5. Create or update a GitHub Release and upload installer, portable app, and zip package.

1. 确认本地检查通过。
2. 构建 Windows 安装包。
3. 提交源码改动。
4. 推送到 GitHub。
5. 创建或更新 GitHub Release，并上传安装器、便携版和 zip 包。

Example:

示例：

```powershell
npm run check
npm run dist:win:unsigned
git add .
git commit -m "Release AgentDesk v0.1.0"
git push agentdesk main:main --force-with-lease
gh release create v0.1.0 --repo Bruce082608/AgentDesk --title "AgentDesk v0.1.0" --notes-file release/release-notes-v0.1.0.md
```

## Current Limits / 当前限制

- Unsigned Windows packages may show system security warnings.
- Windows 未签名安装包会出现系统安全提示。
- The Vite JavaScript chunk is currently larger than 500 KB. This is a build warning and does not block runtime.
- Vite 输出的 JS chunk 当前超过 500 KB，这只是构建警告，不影响运行。
- Full access mode is an in-process app state. After restarting AgentDesk, permissions return to default mode.
- 完全访问权限是当前应用进程内状态。重启 AgentDesk 后会恢复默认权限。
- Cross-platform packaging may require each target platform's native toolchain.
- 跨平台打包仍可能需要对应平台工具链。
