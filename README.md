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

You can provide the API key in the UI or through an environment variable:

```powershell
$env:DEEPSEEK_API_KEY="your-key"
npm run dev
```

## Configuration

Non-secret provider settings live in `agent-config.json`.

API keys are intentionally not written to that file. Use the UI or environment variables for secrets.
