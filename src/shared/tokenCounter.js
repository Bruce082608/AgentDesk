import { encode } from "gpt-tokenizer";

const MESSAGE_OVERHEAD_TOKENS = 4;
const REQUEST_OVERHEAD_TOKENS = 16;
const TOKENIZER_SAFETY_MULTIPLIER = 1.15;
const TOKEN_COUNT_CACHE_LIMIT = 2000;
const MAX_CACHEABLE_TEXT_CHARS = 200_000;
const tokenCountCache = new Map();

export function countTextTokens(value) {
  const text = String(value ?? "");
  const cached = getCachedTokenCount(text);
  if (cached !== null) return cached;

  const tokens = Math.ceil(encode(text).length * TOKENIZER_SAFETY_MULTIPLIER);
  setCachedTokenCount(text, tokens);
  return tokens;
}

export function countChatMessageTokens(message) {
  if (!message) return 0;
  return (
    MESSAGE_OVERHEAD_TOKENS +
    countTextTokens(message.role || "") +
    countTextTokens(message.content || "") +
    countTextTokens(message.reasoning || "") +
    countTextTokens(message.tool_call_id || "") +
    countTextTokens(message.name || "") +
    countTextTokens(message.tool_calls ? JSON.stringify(message.tool_calls) : "")
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

function getCachedTokenCount(text) {
  if (text.length > MAX_CACHEABLE_TEXT_CHARS) return null;
  if (!tokenCountCache.has(text)) return null;
  const value = tokenCountCache.get(text);
  tokenCountCache.delete(text);
  tokenCountCache.set(text, value);
  return value;
}

function setCachedTokenCount(text, tokens) {
  if (text.length > MAX_CACHEABLE_TEXT_CHARS) return;
  tokenCountCache.set(text, tokens);
  while (tokenCountCache.size > TOKEN_COUNT_CACHE_LIMIT) {
    const oldestKey = tokenCountCache.keys().next().value;
    tokenCountCache.delete(oldestKey);
  }
}
