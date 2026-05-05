import type { AttachedFile, ChatMessage } from "../renderer/global";

export function countTextTokens(value: unknown): number;
export function countChatMessageTokens(message: Partial<ChatMessage>): number;
export function countChatMessagesTokens(messages: Array<Partial<ChatMessage>>): number;
export function countAttachmentsTokens(attachments: Array<Partial<AttachedFile>>): number;
export function countAgentRequestTokens(payload?: {
  messages?: Array<Partial<ChatMessage>>;
  input?: string;
  attachments?: Array<Partial<AttachedFile>>;
}): number;
