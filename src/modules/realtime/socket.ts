import type { Server, Socket } from "socket.io";
import { firebaseAuth } from "../../infra/firebase/admin";
import { logger } from "../../infra/logging/logger";
import { AppError } from "../../shared/errors/app-error";
import { assertChatMember } from "../chats/chat.service";
import { sendMessage } from "../messages/message.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getAuthenticatedUserId(socket: Socket): string {
  const userId: unknown = socket.data.userId;
  if (typeof userId !== "string") {
    throw new AppError(401, "Socket is not authenticated");
  }
  return userId;
}

export function registerSocketHandlers(io: Server): void {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string" || token.length === 0) {
      next(new Error("Authentication required"));
      return;
    }
    try {
      const decodedToken = await firebaseAuth.verifyIdToken(token);
      socket.data.userId = decodedToken.uid;
      next();
    } catch {
      next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("chat:join", (payload: unknown) => {
      void (async () => {
        if (!isRecord(payload) || typeof payload.chatId !== "string") {
          throw new AppError(400, "chatId is required");
        }
        await assertChatMember(payload.chatId, getAuthenticatedUserId(socket));
        await socket.join(payload.chatId);
        socket.emit("chat:joined", { chatId: payload.chatId });
      })().catch((error: unknown) => {
        logger.warn({ err: error, socketId: socket.id }, "Socket chat join rejected");
        socket.emit("chat:error", {
          message: error instanceof AppError ? error.message : "Unable to join chat"
        });
      });
    });

    socket.on("chat:send", (payload: unknown) => {
      void (async () => {
        if (!isRecord(payload) || typeof payload.chatId !== "string" || typeof payload.text !== "string") {
          throw new AppError(400, "chatId and text are required");
        }
        const text = payload.text.trim();
        if (text.length === 0 || text.length > 10_000) {
          throw new AppError(400, "Message text must contain 1 to 10000 characters");
        }
        const message = await sendMessage(payload.chatId, getAuthenticatedUserId(socket), text);
        io.to(payload.chatId).emit("chat:message", message);
      })().catch((error: unknown) => {
        logger.warn({ err: error, socketId: socket.id }, "Socket message rejected");
        socket.emit("chat:error", {
          message: error instanceof AppError ? error.message : "Unable to send message"
        });
      });
    });
  });
}
