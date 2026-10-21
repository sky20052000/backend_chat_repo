import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/shared/errors/app-error";
import { decodeMessageCursor, encodeMessageCursor } from "../src/modules/messages/message.cursor";

test("message cursor round-trips its timestamp and message ID", () => {
  const cursor = { seconds: 1_792_609_320, nanoseconds: 123_456_000, messageId: "message-123" };
  assert.deepEqual(decodeMessageCursor(encodeMessageCursor(cursor)), cursor);
});

test("message cursor rejects malformed input", () => {
  assert.throws(() => decodeMessageCursor("not-a-cursor"), AppError);
  assert.throws(
    () => decodeMessageCursor(Buffer.from(JSON.stringify({
      seconds: 1,
      nanoseconds: 1_000_000_000,
      messageId: "id"
    })).toString("base64url")),
    AppError
  );
});
