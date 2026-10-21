import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/shared/errors/app-error";
import { decodeMessageCursor, encodeMessageCursor } from "../src/modules/messages/message.cursor";

test("message cursor round-trips its timestamp and message ID", () => {
  const cursor = { createdAt: "2026-10-21 17:42:00.123456+00", messageId: "message-123" };
  assert.deepEqual(decodeMessageCursor(encodeMessageCursor(cursor)), cursor);
});

test("message cursor rejects malformed input", () => {
  assert.throws(() => decodeMessageCursor("not-a-cursor"), AppError);
  assert.throws(
    () => decodeMessageCursor(Buffer.from(JSON.stringify({ createdAt: "invalid", messageId: "id" })).toString("base64url")),
    AppError
  );
});
