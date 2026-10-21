import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../../infra/firebase/admin";
import { assertChatMember } from "../chats/chat.service";
import { AppError } from "../../shared/errors/app-error";
import { decodeMessageCursor, encodeMessageCursor, type MessageCursor } from "./message.cursor";
import { updateChatActivity } from "./message.repository";

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
  await assertChatMember(chatId, senderId);
  const messageRef = messagesCollection(chatId).doc();
  await messageRef.set({
    chatId,
    senderId,
    text,
    createdAt: FieldValue.serverTimestamp()
  });

  const snapshot = await messageRef.get();
  if (!snapshot.exists) {
    throw new Error("Message creation returned no record");
  }

  await updateChatActivity(chatId);
  return toChatMessage(snapshot);
}

export async function getMessages(
  chatId: string,
  userId: string,
  limit: number,
  cursorValue?: string
): Promise<MessagePage> {
  await assertChatMember(chatId, userId);
  const cursor: MessageCursor | undefined = decodeMessageCursor(cursorValue);
  let query = messagesCollection(chatId)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  if (cursor) {
    query = query.startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.messageId);
  }

  const page = await query.limit(limit + 1).get();
  const documents = page.docs.slice(0, limit);
  const oldestMessage = documents[documents.length - 1];

  return {
    messages: documents.slice().reverse().map(toChatMessage),
    nextCursor: page.docs.length > limit && oldestMessage
      ? encodeMessageCursor(cursorFromDocument(oldestMessage))
      : null
  };
}

export async function markMessageRead(chatId: string, messageId: string, userId: string): Promise<void> {
  await assertChatMember(chatId, userId);
  const messageRef = messagesCollection(chatId).doc(messageId);
  if (!(await messageRef.get()).exists) {
    throw new AppError(404, "Message not found");
  }

  await messageRef.collection("readReceipts").doc(userId).set({
    userId,
    readAt: FieldValue.serverTimestamp()
  });
}

export async function updateLastSeen(chatId: string, messageId: string, userId: string): Promise<void> {
  await assertChatMember(chatId, userId);
  const messages = messagesCollection(chatId);
  const messageRef = messages.doc(messageId);
  const lastSeenRef = firestore.collection("chats").doc(chatId).collection("lastSeen").doc(userId);

  await firestore.runTransaction(async (transaction) => {
    const [messageSnapshot, lastSeenSnapshot] = await Promise.all([
      transaction.get(messageRef),
      transaction.get(lastSeenRef)
    ]);
    if (!messageSnapshot.exists) {
      throw new AppError(404, "Message not found");
    }

    const currentMessageId = lastSeenSnapshot.data()?.messageId;
    if (typeof currentMessageId === "string" && currentMessageId !== messageId) {
      const currentMessageSnapshot = await transaction.get(messages.doc(currentMessageId));
      if (currentMessageSnapshot.exists && compareMessagePositions(
        cursorFromDocument(currentMessageSnapshot),
        cursorFromDocument(messageSnapshot)
      ) > 0) {
        return;
      }
    }

    transaction.set(lastSeenRef, {
      userId,
      messageId,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

function toChatMessage(snapshot: DocumentSnapshot<DocumentData>): ChatMessage {
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    !data ||
    typeof data.chatId !== "string" ||
    typeof data.senderId !== "string" ||
    typeof data.text !== "string" ||
    !(data.createdAt instanceof Timestamp)
  ) {
    throw new Error(`Message ${snapshot.ref.path} has invalid stored data`);
  }

  return {
    messageId: snapshot.id,
    chatId: data.chatId,
    senderId: data.senderId,
    text: data.text,
    createdAt: data.createdAt.toDate().toISOString()
  };
}

function cursorFromDocument(snapshot: DocumentSnapshot<DocumentData>): MessageCursor {
  const createdAt: unknown = snapshot.data()?.createdAt;
  if (!(createdAt instanceof Timestamp)) {
    throw new Error(`Message ${snapshot.ref.path} has an invalid timestamp`);
  }
  return {
    seconds: createdAt.seconds,
    nanoseconds: createdAt.nanoseconds,
    messageId: snapshot.id
  };
}

function compareMessagePositions(left: MessageCursor, right: MessageCursor): number {
  if (left.seconds !== right.seconds) {
    return left.seconds < right.seconds ? -1 : 1;
  }
  if (left.nanoseconds !== right.nanoseconds) {
    return left.nanoseconds < right.nanoseconds ? -1 : 1;
  }
  if (left.messageId === right.messageId) {
    return 0;
  }
  return left.messageId < right.messageId ? -1 : 1;
}
