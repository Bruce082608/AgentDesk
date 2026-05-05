import { encode } from "gpt-tokenizer";

const MESSAGE_OVERHEAD_TOKENS = 4;
const REQUEST_OVERHEAD_TOKENS = 16;

export function countTextTokens(value) {
  return encode(String(value ?? "")).length;
}

export function countChatMessageTokens(message) {
  if (!message) return 0;
  return (
    MESSAGE_OVERHEAD_TOKENS +
    countTextTokens(message.role || "") +
    countTextTokens(message.content || "") +
    countTextTokens(message.reasoning || "")
  );
}

export function countChatMessagesTokens(messages = []) {
  return messages.reduce((total, message) => total + countChatMessageTokens(message), REQUEST_OVERHEAD_TOKENS);
}

export function countAttachmentsTokens(attachments = []) {
  return attachments.reduce((total, file) => {
    return total + countTextTokens(file?.path || "") + countTextTokens(file?.content || "");
  }, 0);
}

export function countAgentRequestTokens({ messages = [], input = "", attachments = [] } = {}) {
  return countChatMessagesTokens(messages) + countTextTokens(input) + countAttachmentsTokens(attachments);
}
