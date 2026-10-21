import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../firebase/admin";
import { logger } from "../logging/logger";
import { pool } from "./pool";

const batchSize = 250;

interface LegacyMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at_seconds: string;
  created_at_nanoseconds: string;
}

async function backfillMessages(): Promise<void> {
  let cursor: { chatId: string; messageId: string } | undefined;
  let processedMessages = 0;

  while (true) {
    const result = cursor
      ? await pool.query<LegacyMessage>(
        `SELECT id, chat_id, sender_id, text,
                floor(extract(epoch FROM created_at))::bigint::text AS created_at_seconds,
                floor((extract(epoch FROM created_at) - floor(extract(epoch FROM created_at)))
                  * 1000000000)::bigint::text AS created_at_nanoseconds
         FROM messages
         WHERE (chat_id, id) > ($1::uuid, $2::text)
         ORDER BY chat_id, id
         LIMIT $3`,
        [cursor.chatId, cursor.messageId, batchSize]
      )
      : await pool.query<LegacyMessage>(
        `SELECT id, chat_id, sender_id, text,
                floor(extract(epoch FROM created_at))::bigint::text AS created_at_seconds,
                floor((extract(epoch FROM created_at) - floor(extract(epoch FROM created_at)))
                  * 1000000000)::bigint::text AS created_at_nanoseconds
         FROM messages
         ORDER BY chat_id, id
         LIMIT $1`,
        [batchSize]
      );

    if (result.rows.length === 0) {
      break;
    }

    const rows = result.rows.map((row) => {
      const seconds = Number(row.created_at_seconds);
      const nanoseconds = Number(row.created_at_nanoseconds);
      if (
        row.id.length === 0 ||
        row.id.length > 150 ||
        row.id.includes("/") ||
        row.sender_id.length === 0 ||
        row.text.trim().length === 0 ||
        row.text.length > 10_000 ||
        !Number.isSafeInteger(seconds) ||
        !Number.isInteger(nanoseconds) ||
        nanoseconds < 0 ||
        nanoseconds > 999_999_999
      ) {
        throw new Error(`Legacy message ${row.chat_id}/${row.id} has invalid stored data`);
      }
      return { ...row, timestamp: new Timestamp(seconds, nanoseconds) };
    });

    const references = rows.map((row) =>
      firestore.collection("chats").doc(row.chat_id).collection("messages").doc(row.id)
    );
    const existingDocuments = await firestore.getAll(...references);
    const batch = firestore.batch();

    rows.forEach((row, index) => {
      const existing = existingDocuments[index];
      if (!existing) {
        throw new Error(`Unable to inspect Firestore message ${row.chat_id}/${row.id}`);
      }
      if (existing.exists) {
        const data = existing.data();
        if (
          data?.chatId !== row.chat_id ||
          data?.senderId !== row.sender_id ||
          data?.text !== row.text ||
          !(data.createdAt instanceof Timestamp) ||
          data.createdAt.seconds !== row.timestamp.seconds ||
          data.createdAt.nanoseconds !== row.timestamp.nanoseconds
        ) {
          throw new Error(`Legacy message ID conflict while backfilling chat ${row.chat_id}`);
        }
        return;
      }

      batch.create(references[index]!, {
        chatId: row.chat_id,
        senderId: row.sender_id,
        text: row.text,
        createdAt: row.timestamp
      });
    });

    await batch.commit();
    processedMessages += rows.length;
    const lastRow = rows[rows.length - 1];
    if (!lastRow) {
      throw new Error("Message backfill returned an empty page");
    }
    cursor = { chatId: lastRow.chat_id, messageId: lastRow.id };
  }

  logger.info({ messages: processedMessages }, "Firestore message backfill completed");
}

async function main(): Promise<void> {
  try {
    await backfillMessages();
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, "Firestore message backfill failed");
  process.exitCode = 1;
});
