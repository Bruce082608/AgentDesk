const MESSAGES = {
  zh: {
    agent: {
      emptyInput: "消息不能为空。",
      missingWorkspace: "请先选择 workspace。",
      cancelled: "请求已取消。",
      sendCompressed: "发送给模型，上下文窗口 {context} tokens；可用输入预算 {input} tokens；已注入早期对话摘要。",
      sendNormal: "发送给模型，上下文窗口 {context} tokens；可用输入预算 {input} tokens...",
      toolLoop: "继续执行工具循环 {step}/{max}...",
      streamRecovery: "模型流式连接中断，已保留当前输出并尝试从断点继续 ({attempt}/{max})。{reason}",
      streamRecoveryExhausted: "模型流式连接中断，已保留当前输出；自动续接次数已用尽。{reason}",
      streamReason: "原因：{reason}",
      emptyModelResponse: "模型本轮没有返回正文。finish_reason={finishReason}。请查看右侧 Activity 的接口用量或错误信息。",
      repeatedToolFailure: "工具 {name} 已连续失败 {count} 次，已把 stderr/stdout 写入上下文；下一轮必须换策略，而不是中断。",
      toolEventFailed: "工具 {name} 已返回结果，但 UI 事件处理失败：{message}",
      toolFailuresRecorded: "工具失败信息已结构化写入上下文；下一轮会按错误类型选择恢复策略。",
      waitingUser: "Agent 正在等待用户选择后继续。",
      maxSteps: "agent 超过最大工具循环次数 {max}，已停止。可以在设置中调高工具调用次数限制后重试。",
      compressionStart: "历史上下文接近可用输入预算（{full} / {input} tokens；已预留输出 {output} tokens，安全余量 {margin} tokens），正在压缩 {count} 条早期消息...",
      compressionDone: "早期对话已压缩为 {tokens} tokens 的记忆摘要。",
      compressionFailed: "早期对话摘要失败，已退回滑动窗口上下文：{message}",
      emptySummary: "模型返回了空摘要。"
    },
    tools: {
      unknownTool: "未知工具：{name}",
      invalidJson: "工具参数不是合法 JSON：{raw}",
      emptyQuery: "query 不能为空。",
      emptyPatch: "patch 不能为空。",
      emptyCommand: "command 不能为空。",
      emptyPath: "path 不能为空。",
      emptyQuestion: "question 不能为空。",
      missingWorkspace: "请先选择 workspace。",
      notFile: "{path} 不是文件。",
      fileTooLarge: "{path} 太大（{size} bytes），demo 限制为 {limit} bytes。",
      contentTooLarge: "{path} 内容太大，write_file 限制为 {limit} bytes。",
      unsafePath: "路径不安全：{path}",
      outsideWorkspace: "路径越界：{path}",
      invalidPatch: "patch 不是可识别的 unified diff。请包含 diff --git 或 ---/+++ 文件头。",
      unsafePatchPath: "patch 路径不安全：{path}",
      pendingPatchMissing: "待应用 patch 不存在或已处理。",
      pendingCommandMissing: "待确认命令不存在或已处理。",
      searchTimeout: "搜索请求超时（20 秒）。",
      searchFailed: "搜索请求失败 {status}: {message}",
      commandPendingHighRisk: "这个命令属于高风险操作，可能会删除文件、重置 Git、修改权限或影响系统，需要确认后执行。",
      commandPendingNormal: "这个命令可能修改环境、安装依赖、访问网络或产生副作用，需要确认后执行。",
      patchAppliedAuto: "Patch 已自动应用，因为当前会话已启用 patch 自动确认。",
      patchQueued: "Patch 已加入待确认队列，尚未应用。",
      commandQueued: "命令已加入待确认队列，尚未执行。",
      gitApplyFailed: "Git apply 失败。",
      toolErrors: {
        file_not_found: "文件未找到",
        permission_denied: "权限不足",
        invalid_arguments: "参数无效",
        path_security: "路径不安全",
        timeout: "请求超时",
        network: "网络错误",
        command_failed: "命令执行失败",
        unknown: "工具调用失败"
      }
    }
  },
  en: {
    agent: {
      emptyInput: "Message cannot be empty.",
      missingWorkspace: "Choose a workspace first.",
      cancelled: "Request cancelled.",
      sendCompressed: "Sending to model. Context window {context} tokens; input budget {input} tokens; earlier history summary injected.",
      sendNormal: "Sending to model. Context window {context} tokens; input budget {input} tokens...",
      toolLoop: "Continuing tool loop {step}/{max}...",
      streamRecovery: "Model stream interrupted. Current output was kept; retrying from the interruption point ({attempt}/{max}). {reason}",
      streamRecoveryExhausted: "Model stream interrupted. Current output was kept; automatic continuation attempts are exhausted. {reason}",
      streamReason: "Reason: {reason}",
      emptyModelResponse: "The model returned no visible content this turn. finish_reason={finishReason}. Check Activity for usage or errors.",
      repeatedToolFailure: "Tool {name} failed {count} times in a row. stderr/stdout were written into context; the next turn must change strategy instead of stopping.",
      toolEventFailed: "Tool {name} returned a result, but UI event handling failed: {message}",
      toolFailuresRecorded: "Tool failure details were written into context; the next turn will recover by error type.",
      waitingUser: "Agent is waiting for the user's selection before continuing.",
      maxSteps: "Agent exceeded the maximum tool loop count ({max}) and stopped. Raise the tool call limit in Settings and retry.",
      compressionStart: "History is near the available input budget ({full} / {input} tokens; output reserve {output} tokens, safety margin {margin} tokens). Compressing {count} earlier messages...",
      compressionDone: "Earlier conversation compressed into a {tokens}-token memory summary.",
      compressionFailed: "Earlier conversation summary failed; falling back to sliding-window context: {message}",
      emptySummary: "The model returned an empty summary."
    },
    tools: {
      unknownTool: "Unknown tool: {name}",
      invalidJson: "Tool arguments are not valid JSON: {raw}",
      emptyQuery: "query cannot be empty.",
      emptyPatch: "patch cannot be empty.",
      emptyCommand: "command cannot be empty.",
      emptyPath: "path cannot be empty.",
      emptyQuestion: "question cannot be empty.",
      missingWorkspace: "Choose a workspace first.",
      notFile: "{path} is not a file.",
      fileTooLarge: "{path} is too large ({size} bytes); demo limit is {limit} bytes.",
      contentTooLarge: "{path} content is too large; write_file limit is {limit} bytes.",
      unsafePath: "Unsafe path: {path}",
      outsideWorkspace: "Path is outside the workspace: {path}",
      invalidPatch: "patch is not a recognizable unified diff. Include diff --git or ---/+++ file headers.",
      unsafePatchPath: "Unsafe patch path: {path}",
      pendingPatchMissing: "Pending patch does not exist or was already handled.",
      pendingCommandMissing: "Pending command does not exist or was already handled.",
      searchTimeout: "Search request timed out (20 seconds).",
      searchFailed: "Search request failed {status}: {message}",
      commandPendingHighRisk: "This is a high-risk command. It may delete files, reset Git, change permissions, or affect the system, so it requires confirmation.",
      commandPendingNormal: "This command may change the environment, install dependencies, access the network, or have side effects, so it requires confirmation.",
      patchAppliedAuto: "Patch applied automatically because scoped patch auto-approval is enabled.",
      patchQueued: "Patch queued for user review. It has not been applied yet.",
      commandQueued: "Command queued for user approval. It has not been executed yet.",
      gitApplyFailed: "Git apply failed.",
      toolErrors: {
        file_not_found: "File not found",
        permission_denied: "Permission denied",
        invalid_arguments: "Invalid arguments",
        path_security: "Unsafe path",
        timeout: "Request timed out",
        network: "Network error",
        command_failed: "Command failed",
        unknown: "Tool call failed"
      }
    }
  }
};

export function normalizeLanguage(language) {
  return language === "en" ? "en" : "zh";
}

export function t(language, key, values = {}) {
  const normalized = normalizeLanguage(language);
  const fallback = lookup(MESSAGES.en, key) ?? key;
  const template = lookup(MESSAGES[normalized], key) ?? fallback;
  return String(template).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ""));
}

function lookup(source, key) {
  return key.split(".").reduce((value, part) => value && value[part], source);
}
