import { z } from "zod";
import { AppError } from "../../shared/errors/app-error";

export interface MessageCursor {
  seconds: number;
  nanoseconds: number;
  messageId: string;
}

const cursorSchema = z.object({
  seconds: z.number().int().min(-62_135_596_800).max(253_402_300_799),
  nanoseconds: z.number().int().min(0).max(999_999_999),
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
  if (!result.success) {
    throw new AppError(400, "Invalid message cursor");
  }
  return result.data;
}
