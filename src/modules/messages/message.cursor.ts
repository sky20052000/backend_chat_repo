import { z } from "zod";
import { AppError } from "../../shared/errors/app-error";

export interface MessageCursor {
  createdAt: string;
  messageId: string;
}

const cursorSchema = z.object({
  createdAt: z.string().min(1).max(100),
  messageId: z.string().min(1).max(150)
}).strict();

export function encodeMessageCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeMessageCursor(value: string | undefined): MessageCursor | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AppError(400, "Invalid message cursor");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid message cursor");
  }

  const result = cursorSchema.safeParse(decoded);
  if (!result.success || !Number.isFinite(Date.parse(result.data.createdAt))) {
    throw new AppError(400, "Invalid message cursor");
  }
  return result.data;
}
