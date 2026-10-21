import { Router } from "express";
import { authenticate } from "../auth/auth.middleware";
import { createChatController, listUserChatsController } from "./chat.controller";
import {
  getMessagesController,
  markMessageReadController,
  sendMessageController,
  updateLastSeenController
} from "../messages/message.controller";

export const chatRouter = Router();

chatRouter.use(authenticate);
chatRouter.post("/chat/create", createChatController);
chatRouter.post("/chat/:chatId/message/send", sendMessageController);
chatRouter.get("/chat/:chatId/messages", getMessagesController);
chatRouter.post("/chat/:chatId/message/:messageId/read", markMessageReadController);
chatRouter.post("/chat/:chatId/lastseen", updateLastSeenController);
chatRouter.get("/user/:userId/chats", listUserChatsController);
