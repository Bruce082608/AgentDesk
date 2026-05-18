# AgentDesk

> A local desktop coding agent — runs on your machine, works in your workspace.

> 一个本地桌面 coding agent — 运行在你的电脑上，操作你的项目目录。

---

# 中文文档

## 上手使用

### 第一步：安装 Node.js

需要 Node.js 20+。macOS 推荐：

```bash
brew install node
```

Windows 去 [nodejs.org](https://nodejs.org) 下载安装包。

### 第二步：克隆项目 & 安装依赖

```bash
git clone https://github.com/Bruce082608/AgentDesk.git
cd AgentDesk
npm install
```

`npm install` 会根据 `package-lock.json` 安装项目启动所需的依赖库，主要包括：

- Electron：桌面应用运行时
- React + React DOM：前端界面
- Vite + TypeScript：开发服务器、构建和类型检查
- Vitest：单元测试
- Playwright：本地浏览器验证工具
- lucide-react、react-markdown、rehype-highlight、remark-gfm：界面图标与 Markdown 渲染
- gpt-tokenizer、pdf-parse：上下文 token 统计与 PDF 文本提取
- electron-builder、electron-updater：桌面应用打包和更新能力
- concurrently、wait-on：开发环境同时启动 Vite 和 Electron

如果浏览器验证工具提示 Chromium 运行时缺失，请额外执行：

```bash
npx playwright install chromium
```

Linux 环境如缺少浏览器系统依赖，可执行：

```bash
npx playwright install --with-deps chromium
```

### 第三步：配置 API Key

在应用内的设置面板填写，或者设置环境变量：

```bash
# macOS / Linux
export DEEPSEEK_API_KEY="你的-key"

# Windows (PowerShell)
$env:DEEPSEEK_API_KEY="你的-key"
```

API Key 使用操作系统级加密存储（macOS Keychain / Windows DPAPI），不会以明文写入配置文件。

### 第四步：启动开发版

```bash
npm run dev
```

默认前端端口 `5173`。如果端口被占用：

```bash
npm run dev:clean
npm run dev
```

### 第五步：选择工作目录

应用打开后，点击左侧"文件"标签页 → "选择目录"，选一个你想让 agent 操作的项目文件夹。

### 第六步：开始对话

在底部输入框中直接输入任务，例如：

> 阅读 README，告诉我如何启动这个项目。

或者拖拽代码文件到对话框，agent 会把它作为上下文。

---

## 项目完整说明

### 是什么

AgentDesk 是一个使用 Electron + React + TypeScript 构建的本地桌面 coding agent。你选择一个工作目录，agent 可以读取文件、搜索代码、修改代码（生成 diff patch）、运行命令，所有操作都在你的电脑上完成。

默认使用 DeepSeek API（`deepseek-v4-pro`，100 万 context、65536 max tokens、thinking mode），也兼容任何 OpenAI Chat Completions 风格的 API 网关。

### 核心能力

**代码操作**
- 文件树浏览、全文搜索（基于 ripgrep）
- 读取文件（UTF-8 文本 + PDF 自动文本提取）、批量读取、范围读取
- 修改文件（精确文本替换、unified diff patch，审核后应用或自动应用）
- 创建 / 删除文件
- 执行 shell 命令（bash / PowerShell）和长任务命令会话
- 本地浏览器验证：打开页面、点击、输入、截图、检查 console/page errors

**Agent 智能**
- 执行前制定 2-5 步计划，实时显示进度
- 上下文过长时自动压缩早期对话为记忆摘要
- 流式输出中断后自动从断点续接（最多 2 次）
- 工具调用连续失败时主动提示 agent 换策略
- 大工具结果自动分页，避免长输出塞满上下文
- workspace map 开局快速理解项目结构、脚本、框架和 Git 状态
- Thinking chain（推理链）折叠/展开/预览

**权限与安全**
- 默认模式：写入、删除、patch、高风险命令需要审批
- 完全访问模式：当前会话内自动执行，但仍保留需求澄清
- 默认路径沙箱限制在 workspace 内；完全访问模式可使用绝对路径和 workspace 外路径
- API Key 用 OS 级安全存储加密（非明文）

**Git 集成**
- 当前分支显示
- 变更文件列表
- 可视化 diff 查看
- 自动生成 commit message 草稿

**桌面体验**
- 聊天会话按工作目录分组，可重命名、删除
- 文件树、搜索和预览
- 拖拽文件加入上下文
- 双主题（明/暗/跟随系统）+ 中英双语
- 两侧 sidebar 和底部输入框均可拖拽调整大小
- 工具调用卡片（可折叠，带参数、结果和耗时）
- Activity 日志面板
- 计划面板
- 模型接口测试和 DeepSeek 余额查询
- 全局快捷键 `Ctrl+Shift+Space`（macOS: `Command+Shift+Space`）
- 窗口关闭时可隐藏到系统托盘
- 系统桌面通知
- 后台提醒任务

**工程质量**
- TypeScript 类型检查
- 52 个单元测试覆盖核心模块
- 编码检查（mojibake 扫描）
- 一条命令 `npm run check` 完成全量质检

### 项目结构

```
src/
  main/          Electron 主进程：IPC、Agent 循环、工具执行、Provider、配置、持久化
  renderer/      React UI：会话管理、文件树、设置面板、审批、Activity 面板
  shared/        共享模块：路径安全、Token 计数、上下文预算、PDF 提取
scripts/         开发/构建预检和编码检查
.hooks/          Git hooks
```

### AI 模型配置

| 设置 | 默认值 | 说明 |
|------|--------|------|
| Provider | DeepSeek | 也支持 OpenAI-compatible |
| Model | `deepseek-v4-pro` | 100 万 context，最高 65536 输出 |
| Summary Model | `deepseek-v4-flash` | 用于上下文压缩（更快更便宜） |
| Thinking Mode | enabled | 推理链 |
| Reasoning Effort | max | 推理深度 |
| Temperature | 0.2 | 代码类任务建议低温 |
| Max Agent Steps | 64 | 工具调用最大轮次（可调 8-256） |

### 可用工具

| 工具 | 说明 |
|------|------|
| `list_files` | 列出工作区文件 |
| `read_file` | 读取文本文件或 PDF（自动提取文本） |
| `read_files` | 一次读取多个文件 |
| `read_file_range` | 读取指定行范围 |
| `read_result_chunk` | 读取大型工具结果的后续分页 |
| `workspace_map` | 返回项目摘要、脚本、入口文件、框架和 Git 状态 |
| `write_file` | 创建或覆写文件 |
| `replace_text` | 精确替换已有文件中的文本 |
| `delete_file` | 删除文件 |
| `apply_patch` | 应用 unified diff patch |
| `search_files` | 全文搜索 |
| `web_search` | 联网搜索 |
| `run_command` | 执行 shell 命令 |
| `start_command` | 启动长任务命令会话 |
| `read_command_output` | 增量读取后台命令输出 |
| `stop_command` | 停止后台命令 |
| `browser_page` | 用 Playwright 打开页面、交互、截图和检查错误 |
| `ask_user` | 向用户提问澄清需求 |
| `update_plan` | 更新执行计划 |

### NPM 脚本

```bash
npm run dev               # 启动开发版
npm run dev:clean         # 清理 dev 端口占用
npm run build             # Vite 生产构建
npm run pack              # 生成 unpacked Electron 应用
npm run dist:win          # 构建 Windows 安装版的安装器和便携版
npm run dist:win:unsigned # 构建未签名 Windows 产物
npm run dist:mac          # 构建 macOS 产物
npm run dist:linux        # 构建 Linux 产物
npm run check             # 编码检查 + 类型检查 + 测试 + 构建
```

---

# English

## Quick Start

### Step 1: Install Node.js

Requires Node.js 20+. On macOS:

```bash
brew install node
```

On Windows, download from [nodejs.org](https://nodejs.org).

### Step 2: Clone & Install

```bash
git clone https://github.com/Bruce082608/AgentDesk.git
cd AgentDesk
npm install
```

`npm install` installs the startup dependencies from `package-lock.json`, including:

- Electron: desktop runtime
- React + React DOM: renderer UI
- Vite + TypeScript: dev server, build, and type checking
- Vitest: unit tests
- Playwright: local browser validation tool
- lucide-react, react-markdown, rehype-highlight, remark-gfm: icons and Markdown rendering
- gpt-tokenizer, pdf-parse: token counting and PDF text extraction
- electron-builder, electron-updater: desktop packaging and update plumbing
- concurrently, wait-on: start Vite and Electron together during development

If the browser validation tool reports a missing Chromium runtime, run:

```bash
npx playwright install chromium
```

On Linux, if browser system dependencies are missing, run:

```bash
npx playwright install --with-deps chromium
```

### Step 3: Configure API Key

Enter the key in the app settings panel, or set it via environment variable:

```bash
# macOS / Linux
export DEEPSEEK_API_KEY="your-key"

# Windows (PowerShell)
$env:DEEPSEEK_API_KEY="your-key"
```

API keys are stored using OS-level encryption (macOS Keychain / Windows DPAPI) and are never written to the config file in plaintext.

### Step 4: Start the Dev App

```bash
npm run dev
```

The frontend runs on port `5173` with strict port mode. If the port is occupied:

```bash
npm run dev:clean
npm run dev
```

### Step 5: Choose a Workspace

In the app, click the "Files" tab → "Choose Folder," and pick the project directory you want the agent to work in.

### Step 6: Start Chatting

Type a task in the input box at the bottom, for example:

> Read the README and tell me how to start this project.

You can also drag and drop source files into the chat area — the agent reads them as context.

---

## Full Project Description

### What It Is

AgentDesk is a local desktop coding agent built with Electron, React, and TypeScript. Pick a workspace directory, and the agent can read files, search code, apply patches, run commands — all on your machine, nothing leaves your computer (except API calls to the model provider).

It defaults to the DeepSeek API (`deepseek-v4-pro`, 1M context window, 65536 max output tokens, thinking mode on), and also supports any OpenAI Chat Completions–compatible gateway.

### Capabilities

**Code Operations**
- File tree browsing and full‑text search (powered by ripgrep)
- File reading: UTF‑8 text files, automatic PDF text extraction, batch reads, and line-range reads
- File editing via exact text replacement or unified diff patches (review‑and‑approve or auto‑apply)
- Create / delete files
- Shell command execution (bash on macOS/Linux, PowerShell on Windows) and long-running command sessions
- Local browser validation: open pages, click, type, screenshot, and inspect console/page errors

**Agent Intelligence**
- Plan‑before‑act: 2–5 step plan shown in a live panel
- Context compression: auto‑summarizes early conversation history when tokens run low
- Stream recovery: resumes streaming from interruption (up to 2 attempts)
- Tool failure recovery: informs the agent to change strategy after repeated failures
- Large tool results are automatically paginated to avoid filling the context window
- Workspace map gives the agent a fast project summary, scripts, entry files, frameworks, and Git state
- Thinking chain display: collapsible, preview, and full‑view modes

**Permissions & Security**
- Default mode: writes, deletes, patches, and high‑risk commands require user approval
- Full access mode: commands and file changes auto‑execute for the current session only
- Default path sandbox stays inside the workspace; full access mode can use absolute paths and paths outside the workspace
- API keys stored with OS‑level encryption (non‑plaintext, atomic writes)

**Git Integration**
- Current branch display
- Changed‑file list
- Visual diff viewer
- Auto‑drafted commit message

**Desktop Experience**
- Chat sessions grouped by workspace, with rename and delete
- File tree, search, and preview
- Drag‑and‑drop file attachments
- Dual theme (light / dark / follow system) + bilingual (Chinese / English)
- Resizable sidebars and composer area
- Tool call cards (collapsible, with args, results, and duration)
- Activity log panel
- Plan panel
- Provider connection test + DeepSeek balance query
- Global shortcut `Ctrl+Shift+Space` (`Command+Shift+Space` on macOS)
- Hide to tray on close
- Native desktop notifications
- Background reminder tasks

**Engineering Quality**
- TypeScript across the stack
- 52 unit tests covering core modules
- Encoding check (mojibake scan for Chinese source strings)
- One‑command quality gate: `npm run check`

### Project Structure

```
src/
  main/          Electron main process: IPC, agent loop, tool execution, providers, config, persistence
  renderer/      React UI: sessions, file tree, settings, approvals, activity panels
  shared/        Shared modules: path security, token counting, context budget, PDF extraction
scripts/         Dev/build preflight and encoding checks
.hooks/          Git hooks
```

### Model Configuration

| Setting | Default | Notes |
|---------|---------|-------|
| Provider | DeepSeek | Also supports OpenAI‑compatible |
| Model | `deepseek-v4-pro` | 1M context, up to 65536 output |
| Summary Model | `deepseek-v4-flash` | Used for context compression (faster, cheaper) |
| Thinking Mode | enabled | Reasoning chain |
| Reasoning Effort | max | Depth of reasoning |
| Temperature | 0.2 | Low temperature recommended for code |
| Max Agent Steps | 64 | Tool call loop limit (adjustable 8–256) |

### Available Tools

| Tool | Description |
|------|-------------|
| `list_files` | List workspace files |
| `read_file` | Read a text file or PDF (auto‑extracts text) |
| `read_files` | Read multiple files in one call |
| `read_file_range` | Read a specific line range |
| `read_result_chunk` | Read follow-up chunks from large paginated tool results |
| `workspace_map` | Return project summary, scripts, entry files, frameworks, and Git state |
| `write_file` | Create or overwrite a file |
| `replace_text` | Replace exact text in an existing file |
| `delete_file` | Delete a file |
| `apply_patch` | Apply a unified diff patch |
| `search_files` | Full‑text workspace search |
| `web_search` | Web search |
| `run_command` | Execute a shell command |
| `start_command` | Start a long-running command session |
| `read_command_output` | Incrementally read background command output |
| `stop_command` | Stop a background command |
| `browser_page` | Use Playwright to open pages, interact, screenshot, and inspect errors |
| `ask_user` | Ask the user a clarifying question |
| `update_plan` | Update the visible execution plan |

### NPM Scripts

```bash
npm run dev               # Start development app
npm run dev:clean         # Kill old process on port 5173
npm run build             # Vite production build
npm run pack              # Create unpacked Electron app
npm run dist:win          # Build Windows installer, portable, and zip
npm run dist:win:unsigned # Build unsigned Windows artifacts
npm run dist:mac          # Build macOS artifacts
npm run dist:linux        # Build Linux artifacts
npm run check             # Encoding check + typecheck + tests + build
```

### Current Limitations

- Unsigned packages may trigger OS security warnings (SmartScreen on Windows, Gatekeeper on macOS).
- Auto‑update requires a hosted update feed; currently disabled.
- File context‑menu registration is implemented for Windows NSIS installers only.
- Full access mode is scoped to the current chat and workspace; restarting the app restores default permissions.
- Cross‑platform packaging may require each target platform's native toolchain.
