import { AppError } from "../../shared/errors/app-error";
import { createOrGetDirectChat, isChatMember, listChatsForUser, type ChatSummary } from "./chat.repository";

export async function createChat(userAId: string, userBId: string, requesterId: string): Promise<string> {
  if (userAId === userBId) {
    throw new AppError(400, "A direct chat requires two different users");
  }
  if (requesterId !== userAId && requesterId !== userBId) {
    throw new AppError(403, "You can only create a chat that includes you");
  }
  return createOrGetDirectChat(userAId, userBId);
}

export async function assertChatMember(chatId: string, userId: string): Promise<void> {
  if (!await isChatMember(chatId, userId)) {
    throw new AppError(404, "Chat not found");
  }
}

export async function getChatsForUser(userId: string): Promise<ChatSummary[]> {
  return listChatsForUser(userId);
}
