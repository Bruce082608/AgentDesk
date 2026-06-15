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
      name: "read_files",
      description: "Read multiple UTF-8 text files or PDFs in one call. Use this when several known files are needed for the same task. Respects the same path permissions as read_file and returns per-file success or error details.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "File paths to read. Default mode accepts workspace-relative paths and exact attached absolute paths; full access mode accepts any filesystem path."
          },
          max_chars: { type: "number", description: "Total content budget across all files. Default 60000, maximum 200000." },
          per_file_max_chars: { type: "number", description: "Per-file content budget. Default 40000, maximum 120000." }
        },
        required: ["paths"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file_range",
      description: "Read a line range from a UTF-8 text file. Use this for large files or precise patch context. PDFs are not supported by this range reader.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read." },
          start_line: { type: "number", description: "1-based start line. Default 1." },
          end_line: { type: "number", description: "1-based end line, inclusive. Default start_line + 200. Maximum span 1000 lines." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_result_chunk",
      description: "Read another chunk from a large paginated tool result. Use this when a previous tool result returned result_id/resultId, hasMore, or paginated=true.",
      parameters: {
        type: "object",
        properties: {
          result_id: { type: "string", description: "Result id returned by a previous paginated tool result." },
          resultId: { type: "string", description: "Camel-case alias for result_id." },
          offset: { type: "number", description: "Character offset to read from. Use nextOffset from the previous chunk. Default 0." },
          max_chars: { type: "number", description: "Maximum characters to return. Default 40000, maximum 120000." }
        }
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
      name: "replace_text",
      description: "Replace exact text in a UTF-8 file. Strongly prefer replace_text for precise, small edits (where old_text can be matched exactly once) instead of apply_patch or whole-file rewrites. Default permission mode produces a reviewable patch; full access mode writes immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to edit." },
          old_text: { type: "string", description: "Exact text to replace. Must match once unless replace_all or expected_replacements is supplied." },
          new_text: { type: "string", description: "Replacement text." },
          replace_all: { type: "boolean", description: "Replace all occurrences of old_text. Default false." },
          expected_replacements: { type: "number", description: "Expected number of replacements. Default 1, or all matches when replace_all is true." },
          summary: { type: "string", description: "Short summary shown to the user if approval is needed." }
        },
        required: ["path", "old_text", "new_text"]
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
      description: "Propose a unified diff patch. Use apply_patch only for larger structural edits or multi-location changes where replace_text is not expressive enough. In default permission mode the user reviews it in the UI and paths must stay inside the workspace. In full access mode it is applied automatically and may target paths outside the workspace.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Short human-readable summary of the intended change." },
          patch: {
            type: "string",
            description: "A complete unified diff suitable for git apply. Use workspace-relative paths by default; full access mode also permits unsafe paths outside the workspace. CRITICAL Patch Rules: 1. Always use read_file/read_file_range to get LATEST content of target file before generating diff. 2. Every line of context (starting with a space) MUST exactly match existing file contents. 3. Hunk header (@@ -a,b +c,d @@) line numbers must be accurate. 4. Use diff --git format with proper a/ and b/ path prefixes."
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
      name: "browser_page",
      description: "Use a local Playwright browser page to validate web UI. Open localhost/file/http pages, click selectors, type into fields, take screenshots, evaluate JavaScript, and report console/page errors. Prefer this after frontend changes instead of relying only on build output.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["open", "click", "type", "screenshot", "evaluate", "close"], description: "Browser action. Default open when url is supplied, otherwise screenshot." },
          session_id: { type: "string", description: "Browser session id returned by open." },
          url: { type: "string", description: "URL to open. localhost without a scheme is treated as http://. Existing file paths are opened as file:// URLs." },
          selector: { type: "string", description: "CSS/text selector for click or type." },
          text: { type: "string", description: "Text to type/fill when action is type." },
          clear: { type: "boolean", description: "For type action, fill the field after clearing it. Default true." },
          script: { type: "string", description: "JavaScript expression/function body for evaluate action." },
          wait_ms: { type: "number", description: "Optional wait after the action. Default 250ms, maximum 10000ms." },
          wait_until: { type: "string", enum: ["load", "domcontentloaded", "networkidle", "commit"], description: "Navigation wait mode for open. Default networkidle." },
          screenshot: { type: "boolean", description: "Take a screenshot after open/click/type/evaluate. Default false." },
          screenshot_path: { type: "string", description: "Optional path for screenshot PNG. Default .agentdesk/browser-screenshots/<timestamp>.png." },
          full_page: { type: "boolean", description: "Capture full page screenshot. Default true." },
          headless: { type: "boolean", description: "Run browser headless. Default true." },
          viewport_width: { type: "number", description: "Viewport width. Default 1280." },
          viewport_height: { type: "number", description: "Viewport height. Default 800." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_map",
      description: "Return a compact project map for the current workspace: detected frameworks, package scripts, likely entry files, important directories, git branch/status, and suggested validation commands. Use this early for project orientation.",
      parameters: {
        type: "object",
        properties: {
          include_files: { type: "boolean", description: "Include a compact top-level file/directory sample. Default true." },
          max_files: { type: "number", description: "Maximum file/directory sample count. Default 80, maximum 200." }
        }
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
  },
  {
    type: "function",
    function: {
      name: "start_command",
      description: "Start a long-running shell command in the workspace and return a command session id. Use this for dev servers, watch tests, or commands whose output should be read incrementally. High-risk or side-effecting commands require approval unless full access or future command approval is enabled.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string", description: "Optional working directory. Default workspace. Full access mode may use paths outside the workspace." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_command_output",
      description: "Read buffered output from a background command session started by start_command. Pass output_offset from the previous read to get only new output.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Command session id returned by start_command." },
          output_offset: { type: "number", description: "Character offset returned by a previous read. Default 0." },
          max_chars: { type: "number", description: "Maximum output chars to return. Default 20000, maximum 100000." }
        },
        required: ["session_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "stop_command",
      description: "Stop a background command session started by start_command.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Command session id returned by start_command." }
        },
        required: ["session_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "take_screenshot",
      description: "Take a screenshot of the user's primary desktop display screen. This tool captures the screen, returns a local preview URL, and pushes the image directly to the user's phone if Telegram bot is active.",
      parameters: {
        type: "object",
        properties: {
          caption: { type: "string", description: "Optional caption for the screenshot." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_image",
      description: "Send an existing image file from the workspace to the user. This tool reads the file, generates a local preview URL, and pushes the image directly to the user's phone if Telegram bot is active.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The workspace-relative or absolute path to the image file." },
          caption: { type: "string", description: "Optional caption for the image." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_skills",
      description: "Manage periodic background skills (prompts or custom Node.js code scripts) in the application.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "create", "toggle", "delete"],
            description: "The action to perform: 'list' to see current skills, 'create' to create a new skill, 'toggle' to enable/disable an existing skill, 'delete' to remove a skill."
          },
          id: {
            type: "string",
            description: "Required for toggle and delete actions. Optional for create (auto-generated as skill_timestamp if omitted)."
          },
          title: {
            type: "string",
            description: "Title of the skill (required for create)."
          },
          description: {
            type: "string",
            description: "Brief description of the skill."
          },
          type: {
            type: "string",
            enum: ["prompt", "code"],
            description: "Type of skill: 'prompt' to run an agent instruction headlessly, or 'code' to run a Node.js script."
          },
          prompt: {
            type: "string",
            description: "The prompt instruction for 'prompt' type skill (required if type is prompt)."
          },
          code: {
            type: "string",
            description: "The Node.js code block for 'code' type skill (required if type is code)."
          },
          interval_minutes: {
            type: "number",
            description: "The interval in minutes at which to run the skill (0 or omit for one-off/manual run)."
          },
          enabled: {
            type: "boolean",
            description: "Whether the skill should be enabled (defaults to true on create)."
          }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Pause execution (sleep) for a specified number of seconds. Use this when you are waiting for a long-running process (like compilation, video/image generation, queue positions) to advance, instead of polling rapidly in an active loop. Capped at 600 seconds (10 minutes) per call.",
      parameters: {
        type: "object",
        properties: {
          seconds: {
            type: "number",
            description: "Number of seconds to wait. Minimum 1, maximum 600."
          }
        },
        required: ["seconds"]
      }
    }
  }
];
