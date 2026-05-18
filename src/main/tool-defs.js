export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "update_plan",
      description: "Update the visible execution plan before and during the task.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] }
              },
              required: ["step", "status"]
            }
          }
        },
        required: ["items"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in the current workspace. In full access mode, directory may also be an absolute path, ~ path, or parent-traversal path outside the workspace. Use this before reading files when the target path is unknown.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Workspace-relative directory. Empty means workspace root. Full access mode also accepts absolute paths, ~ paths, and paths outside the workspace." },
          max_files: { type: "number", description: "Maximum number of files to return, default 120." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file or a PDF. Default mode is limited to the workspace plus exact absolute paths attached by the user. Full access mode accepts absolute paths, ~ paths, and parent-traversal paths outside the workspace. PDF files are detected by the .pdf extension and text is extracted. Binary files other than PDF cannot be read.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path, exact attached absolute path, or any filesystem path in full access mode." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file. Default mode is limited to the workspace and produces a reviewable patch. Full access mode accepts absolute paths, ~ paths, and parent-traversal paths outside the workspace, and writes immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path, or any filesystem path in full access mode." },
          content: { type: "string", description: "Complete file content." },
          summary: { type: "string", description: "Short summary shown to the user if approval is needed." }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file. Default mode is limited to the workspace and produces a reviewable deletion patch. Full access mode accepts absolute paths, ~ paths, and parent-traversal paths outside the workspace, and deletes immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path, or any filesystem path in full access mode." },
          summary: { type: "string", description: "Short summary shown to the user if approval is needed." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Ask the user a concise multiple-choice question when required information is missing or a decision is needed. Provide 2-6 clear options whenever possible.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to show to the user." },
          context: { type: "string", description: "Optional short context explaining why the answer is needed." },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Two to six user-facing options. Example: [\"Yes\", \"No\"]."
          }
        },
        required: ["question"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "Propose a unified diff patch. In default permission mode the user reviews it in the UI and paths must stay inside the workspace. In full access mode it is applied automatically and may target paths outside the workspace.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Short human-readable summary of the intended change." },
          patch: {
            type: "string",
            description: "A complete unified diff, suitable for git apply. Use workspace-relative paths by default; full access mode also permits unsafe paths outside the workspace."
          }
        },
        required: ["patch"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search text files in the workspace for a plain text query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number", description: "Default 50." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current or external information. Use this when the user asks for latest/current facts, online information, documentation, news, prices, or anything not available in the workspace. Returns deduplicated results with titles, URLs, snippets, and best-effort page excerpts for the top results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          max_results: { type: "number", description: "Default 5, maximum 10." },
          fetch_pages: { type: "boolean", description: "Whether to fetch page excerpts for top results. Default true." },
          max_fetch_pages: { type: "number", description: "How many top result pages to fetch for excerpts. Default 3, maximum 5." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "system_clipboard",
      description: "Read, write, or clear the operating system clipboard text. Use only when the user asks for clipboard-level desktop behavior.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["read_text", "write_text", "clear"], description: "Clipboard operation. Default is read_text." },
          text: { type: "string", description: "Text to write when action is write_text." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "system_window_info",
      description: "Inspect AgentDesk window/display state and best-effort foreground window information from the operating system.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "system_notify",
      description: "Show a native desktop notification. Use for user-visible desktop reminders or important background status.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          silent: { type: "boolean" }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "background_task",
      description: "Create, list, or cancel persistent background notification tasks. Scheduled tasks survive app restarts while AgentDesk is installed.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "schedule", "cancel"], description: "Task action. Default is list." },
          id: { type: "string", description: "Task id for cancel." },
          title: { type: "string", description: "Notification title for a scheduled task." },
          body: { type: "string", description: "Notification body for a scheduled task." },
          run_at: { type: "string", description: "ISO timestamp for when the task should fire." },
          delay_minutes: { type: "number", description: "Delay before firing if run_at is not supplied." },
          interval_minutes: { type: "number", description: "Repeat interval. Omit or set 0 for a one-time task." },
          include_completed: { type: "boolean", description: "Include completed/cancelled tasks when listing." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace and return stdout/stderr. Uses PowerShell on Windows and bash on macOS/Linux. High-risk or side-effecting commands require user approval unless future approvals were enabled.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeout_ms: { type: "number", description: "Default 30000, maximum 120000." }
        },
        required: ["command"]
      }
    }
  }
];
