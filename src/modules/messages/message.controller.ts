import { z } from "zod";
import type { Server } from "socket.io";
import { requireAuthenticatedUser } from "../auth/auth.middleware";
import { asyncHandler } from "../../shared/http/async-handler";
import { AppError } from "../../shared/errors/app-error";
import { getMessages, markMessageRead, sendMessage, updateLastSeen } from "./message.service";

const uuidSchema = z.string().uuid();
const messageIdSchema = z.string().min(1).max(150);
const userIdSchema = z.string().min(1).max(128);

function ensureSelf(requestedUserId: string, authenticatedUserId: string): void {
  if (requestedUserId !== authenticatedUserId) {
    throw new AppError(403, "You can only act as the authenticated user");
  }
}

export const sendMessageController = asyncHandler(async (req, res) => {
  const authenticatedUserId = requireAuthenticatedUser(req.userId);
  const chatId = uuidSchema.parse(req.params.chatId);
  const input = z.object({
    senderId: userIdSchema,
    text: z.string().trim().min(1).max(10_000)
  }).parse(req.body);
  ensureSelf(input.senderId, authenticatedUserId);

  const message = await sendMessage(chatId, input.senderId, input.text);
  const io = req.app.get("io") as Server;
  io.to(chatId).emit("chat:message", message);
  res.status(201).json({ message });
});

export const getMessagesController = asyncHandler(async (req, res) => {
  const authenticatedUserId = requireAuthenticatedUser(req.userId);
  const chatId = uuidSchema.parse(req.params.chatId);
  const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
  const cursor = z.string().max(512).optional().parse(req.query.cursor);
  res.json(await getMessages(chatId, authenticatedUserId, limit, cursor));
});

export const markMessageReadController = asyncHandler(async (req, res) => {
  const authenticatedUserId = requireAuthenticatedUser(req.userId);
  const chatId = uuidSchema.parse(req.params.chatId);
  const messageId = messageIdSchema.parse(req.params.messageId);
  const userId = userIdSchema.parse(req.body.userId);
  ensureSelf(userId, authenticatedUserId);
  await markMessageRead(chatId, messageId, userId);
  res.status(204).send();
});

export const updateLastSeenController = asyncHandler(async (req, res) => {
  const authenticatedUserId = requireAuthenticatedUser(req.userId);
  const chatId = uuidSchema.parse(req.params.chatId);
  const input = z.object({ userId: userIdSchema, messageId: messageIdSchema }).parse(req.body);
  ensureSelf(input.userId, authenticatedUserId);
  await updateLastSeen(chatId, input.messageId, input.userId);
  res.status(204).send();
});
