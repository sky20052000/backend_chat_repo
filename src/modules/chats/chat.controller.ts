import { z } from "zod";
import { requireAuthenticatedUser } from "../auth/auth.middleware";
import { asyncHandler } from "../../shared/http/async-handler";
import { createChat, getChatsForUser } from "./chat.service";
import { AppError } from "../../shared/errors/app-error";

const createChatSchema = z.object({
  userAId: z.string().min(1).max(128),
  userBId: z.string().min(1).max(128)
});

export const createChatController = asyncHandler(async (req, res) => {
  const requesterId = requireAuthenticatedUser(req.userId);
  const input = createChatSchema.parse(req.body);
  const chatId = await createChat(input.userAId, input.userBId, requesterId);
  res.status(200).json({ chatId });
});

export const listUserChatsController = asyncHandler(async (req, res) => {
  const requesterId = requireAuthenticatedUser(req.userId);
  const userId = z.string().min(1).max(128).parse(req.params.userId);
  if (userId !== requesterId) {
    throw new AppError(403, "You can only list your own chats");
  }
  res.json({ chats: await getChatsForUser(userId) });
});
