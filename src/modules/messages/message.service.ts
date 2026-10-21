import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../../infra/firebase/admin";
import { assertChatMember } from "../chats/chat.service";
import { AppError } from "../../shared/errors/app-error";
import { decodeMessageCursor, encodeMessageCursor, type MessageCursor } from "./message.cursor";
import { insertMessage, messageExists, selectMessages } from "./message.repository";

export interface ChatMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface MessagePage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

function messagesCollection(chatId: string) {
  return firestore.collection("chats").doc(chatId).collection("messages");
}

export async function sendMessage(chatId: string, senderId: string, text: string): Promise<ChatMessage> {
  const message = await insertMessage(chatId, senderId, text);
  return toChatMessage(message);
}

export async function getMessages(
  chatId: string,
  userId: string,
  limit: number,
  cursorValue?: string
): Promise<MessagePage> {
  await assertChatMember(chatId, userId);
  const cursor: MessageCursor | undefined = decodeMessageCursor(cursorValue);
  const page = await selectMessages(chatId, limit, cursor);
  const messages = page.messages.slice().reverse();
  const oldestMessage = page.messages[page.messages.length - 1];

  return {
    messages: messages.map(toChatMessage),
    nextCursor: page.hasMore && oldestMessage
      ? encodeMessageCursor({
        createdAt: oldestMessage.cursor_created_at,
        messageId: oldestMessage.id
      })
      : null
  };
}

export async function markMessageRead(chatId: string, messageId: string, userId: string): Promise<void> {
  await assertChatMember(chatId, userId);
  if (!await messageExists(chatId, messageId)) {
    throw new AppError(404, "Message not found");
  }

  await messagesCollection(chatId).doc(messageId).collection("readReceipts").doc(userId).set({
    userId,
    readAt: FieldValue.serverTimestamp()
  });
}

export async function updateLastSeen(chatId: string, messageId: string, userId: string): Promise<void> {
  await assertChatMember(chatId, userId);
  if (!await messageExists(chatId, messageId)) {
    throw new AppError(404, "Message not found");
  }

  await firestore.collection("chats").doc(chatId).collection("lastSeen").doc(userId).set({
    userId,
    messageId,
    updatedAt: FieldValue.serverTimestamp()
  });
}

function toChatMessage(message: {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: Date;
}): ChatMessage {
  return {
    messageId: message.id,
    chatId: message.chat_id,
    senderId: message.sender_id,
    text: message.text,
    createdAt: message.created_at.toISOString()
  };
}
