# DeepSeek Agent Window

DeepSeek Agent Window 是一个本地桌面 coding agent 应用。它使用 Electron、React 和 TypeScript 构建，默认面向 DeepSeek API，同时兼容 OpenAI Chat Completions 风格的网关。

这个项目的目标是提供一个可安装、可拖拽文件、可选择工作目录、可让 agent 阅读/修改/运行项目的本地窗口。

## 主要能力

- 本地桌面窗口，支持 Windows 安装包和便携版。
- DeepSeek 优先，也支持 OpenAI-compatible provider。
- 多会话聊天，左侧栏按工作目录分组。
- 新会话中间引导页，可直接选择工作目录并开始任务。
- 文件树、文件搜索、文件预览和上下文附件。
- 支持拖拽文件到输入区作为上下文。
- 流式模型输出、工具调用卡片、计划面板和活动日志。
- Git 状态、变更文件、diff 查看和 commit message 草稿。
- 默认权限模式下，写文件、删文件、patch、高风险命令会请求确认。
- 完全访问权限模式下，命令与文件变更自动执行；`ask_user` 仍保留用于需求澄清。
- 会话历史、主题、语言、侧栏宽度等本地保存。
- 编码扫描、类型检查、测试和生产构建集成到 `npm run check`。

## 快速开始

### 安装依赖

```powershell
npm install
```

### 启动开发版

```powershell
npm run dev
```

开发模式会启动 Vite 前端服务和 Electron 窗口。默认前端端口是 `5173`，并启用 strict port。

如果旧的 dev 进程占用了端口：

```powershell
npm run dev:clean
npm run dev
```

### 配置 API Key

你可以在应用设置面板里填写 API key，也可以使用环境变量：

```powershell
$env:DEEPSEEK_API_KEY="your-key"
npm run dev
```

非密钥配置保存在 `agent-config.json`。API key 不会写入这个文件。

## 使用引导

### 1. 创建或选择会话

打开应用后，左侧默认是聊天栏。会话会按绑定的工作目录分组，未选择目录的新会话会显示在“未选择工作目录”分组下。

点击左侧 `+` 可以创建新会话。新会话不会继承旧工作目录，中间会话区会显示初始引导页。

### 2. 选择工作目录

在中间引导页点击“选择目录”，选择你希望 agent 操作的项目目录。

选择后：

- 当前会话会绑定该工作目录。
- 文件树和 Git 状态会刷新。
- 之后这个会话会在左侧按该目录分组。

### 3. 开始任务

你可以直接输入任务，例如：

```text
阅读 README，告诉我这个项目如何启动。
```

也可以点击引导页上的快捷任务，让输入框自动填入常见任务提示。

### 4. 添加上下文文件

有三种方式：

- 点击输入框旁边的 `+` 上传文件。
- 从系统文件管理器拖拽文件到输入区。
- 在文件视图里打开文件后加入上下文。

应用会在主进程统一读取附件，并标记超大、二进制、截断、重复添加等状态。

### 5. 切换左侧功能页

左侧顶部按钮包含：

- `Chats`：默认聊天栏，按工作目录分组。
- `Files`：当前工作目录的文件树、搜索和预览入口。
- `Settings`：provider、模型、API key、token、余额和 agent 步数设置。

### 6. 权限模式

输入框附近有权限切换：

- 默认权限：只读/低风险命令可自动运行；写入、删除、patch、高风险命令会请求确认。
- 完全访问权限：当前会话和工作目录内，命令与文件变更自动执行，不再弹权限审批。

注意：`ask_user` 不属于权限审批。即使启用完全访问权限，agent 仍可以在需求不清时向你提问。

## Windows 拖拽说明

Windows 原生文件拖拽受启动进程的完整性级别影响。如果 Electron 是从沙盒宿主、提权终端、MSIX 容器或与 Explorer 不同权限上下文中启动，系统可能在页面收到拖拽事件前就阻止拖放，鼠标会显示“禁止”符号。

推荐方式：

```powershell
.\start-agent-window.cmd
```

或者从普通 PowerShell 窗口启动：

```powershell
npm run dev
```

避免从管理员终端、沙盒宿主或特殊自动化环境直接启动应用来测试拖拽。

## 打包 Windows 安装包

普通 Windows 构建：

```powershell
npm run dist:win
```

如果当前 Windows 环境没有创建符号链接权限，electron-builder 解压签名工具时可能失败。可以使用未签名构建：

```powershell
npm run dist:win:unsigned
```

产物输出到 `release/`：

- `DeepSeek Agent Window-0.1.0-Setup-x64.exe`：安装器。
- `DeepSeek Agent Window-0.1.0-Portable-x64.exe`：便携版。
- `DeepSeek Agent Window-0.1.0-win-x64.zip`：压缩包。

未签名安装包可能触发 Windows SmartScreen 或“未知发布者”提示。

## 便携版与安装版

安装版：

- 会安装到系统目录。
- 有卸载入口。
- 更适合长期使用。

便携版：

- 不需要安装，双击运行。
- 适合临时测试或放在移动盘。
- 不会完整注册系统卸载项。

## 开发脚本

```powershell
npm run dev              # 启动开发版
npm run dev:clean        # 清理占用 5173 的旧 dev 进程
npm run build            # Vite 生产构建
npm run pack             # 生成 unpacked Electron 应用
npm run dist:win         # 构建 Windows 安装/便携/zip 产物
npm run dist:win:unsigned# 构建未签名 Windows 产物
npm run check            # 编码检查 + 类型检查 + 测试 + 构建
```

## 项目结构

```text
src/
  main/        Electron 主进程、IPC、agent loop、工具执行、配置、打包相关逻辑
  renderer/    React UI、会话、文件树、设置、审批面板、活动面板
  shared/      前后端共享的路径安全、token、context budget 等逻辑
scripts/       dev/build preflight 和编码检查脚本
dist/          Vite 构建输出，已被 git ignore
release/       electron-builder 产物，已被 git ignore
```

## 质量检查

提交或发布前运行：

```powershell
npm run check
```

这个命令会依次执行：

- `npm run check:encoding`
- `npm run typecheck`
- `npm test`
- `npm run build`

编码检查会扫描常见 mojibake 标记，避免中文源码字符串损坏后影响显示或逻辑判断。

## 发布流程

1. 确认本地检查通过。
2. 构建 Windows 安装包。
3. 提交源码改动。
4. 推送到 GitHub。
5. 创建 GitHub Release 并上传安装器/便携版。

示例：

```powershell
npm run check
npm run dist:win:unsigned
git add .
git commit -m "Release v0.1.0"
git push bruce-test main:main --force-with-lease
gh release create v0.1.0 --repo Bruce082608/Bruce-test --title "v0.1.0" --notes "Initial Windows release."
```

## 当前限制

- Windows 未签名安装包会有系统安全提示。
- Vite 输出 JS chunk 目前超过 500 KB，只是构建警告，不影响运行。
- 完全访问权限是当前应用进程内状态，重启应用后会恢复默认权限。
- 跨平台打包仍可能需要对应平台工具链。
