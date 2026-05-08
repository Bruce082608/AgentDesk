# Agent Window Demo

A local desktop coding-agent demo built with Electron, React, and TypeScript. It is DeepSeek-first, while keeping the provider layer open for other OpenAI-compatible APIs.

## Features

- DeepSeek/OpenAI-compatible provider configuration
- Workspace file tree and file preview
- Attach files as context for the next agent turn
- Streaming model output
- Tool activity log
- Plan view
- Git summary, changed files, diff viewer, and commit message draft
- Patch approval flow before file changes are applied
- Command approval flow for commands with side effects

## Setup

```powershell
npm install
npm run dev
```

If the dev server reports that port `5173` is already in use, stop the old process or run:

```powershell
npm run dev:clean
```

### Windows drag-and-drop note

Windows native file drag-and-drop is sensitive to the process that launches Electron. If the app is started from a sandboxed host, an elevated terminal, or another process with a different integrity level than Explorer, Windows can block drops before the web page receives any drag event. The cursor will show a "not allowed" symbol everywhere in the window.

Start the app from a normal PowerShell window or by double-clicking `start-agent-window.cmd` so Electron runs in the same desktop context as Explorer:

```powershell
.\start-agent-window.cmd
```

If drag-and-drop works from normal PowerShell but not from another host, the app code is receiving a Windows process-boundary restriction rather than a React drag handler failure.

You can provide the API key in the UI or through an environment variable:

```powershell
$env:DEEPSEEK_API_KEY="your-key"
npm run dev
```

## Configuration

Non-secret provider settings live in `agent-config.json`.

API keys are intentionally not written to that file. Use the UI or environment variables for secrets.

## Packaging

Build distributable desktop packages with electron-builder:

```powershell
npm run dist:win
npm run dist:mac
```

The generated installers and archives are written to `release/`.

- macOS targets: `dmg` and `zip` for `x64` and `arm64`
- Windows targets: `nsis`, `portable`, and `zip` for `x64`

`npm run pack` creates an unpacked app directory for quick packaging checks.
`npm run dist` requests macOS, Windows, and Linux targets from electron-builder; some cross-platform targets may require platform-specific tooling such as Wine on macOS/Linux for Windows installers.

Packaging commands run a preflight check first. If a previous app build is still open and locks files under `release/`, close that app before packaging again.

## Checks

```powershell
npm run check
```

`npm run check:encoding` scans source files for common mojibake markers so UTF-8 regressions are caught before they reach the UI.
