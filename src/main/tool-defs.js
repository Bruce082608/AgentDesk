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
      description: "List files in the current workspace. Use this before reading files when the target path is unknown.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Workspace-relative directory. Empty means workspace root." },
          max_files: { type: "number", description: "Maximum number of files to return, default 120." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file or a PDF from the workspace. Exact absolute paths attached by the user are also readable, including PDFs outside the workspace. PDF files are detected by the .pdf extension and text is extracted. Binary files other than PDF cannot be read.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path, or an exact absolute path from the attached files list." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file in the workspace. In default permission mode this produces a reviewable patch; in full access mode it writes immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path to create or overwrite." },
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
      description: "Delete a file from the workspace. In default permission mode this produces a reviewable deletion patch; in full access mode it deletes immediately.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path to delete." },
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
      description: "Propose a unified diff patch. In default permission mode the user reviews it in the UI; in full access mode it is applied automatically.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Short human-readable summary of the intended change." },
          patch: {
            type: "string",
            description: "A complete unified diff, suitable for git apply, with paths relative to the workspace."
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
      description: "Search the web for current or external information. Use this when the user asks for latest/current facts, online information, documentation, news, prices, or anything not available in the workspace. Returns titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          max_results: { type: "number", description: "Default 5, maximum 10." }
        },
        required: ["query"]
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
