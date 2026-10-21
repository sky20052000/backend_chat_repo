import { FieldPath, Timestamp } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { PoolClient } from "pg";
import { firestore } from "../firebase/admin";
import { logger } from "../logging/logger";
import { pool } from "./pool";

const batchSize = 250;

async function backfillMessages(): Promise<void> {
  const chats = await pool.query<{ id: string }>("SELECT id FROM chats ORDER BY id");
  let processedMessages = 0;

  for (const { id: chatId } of chats.rows) {
    let lastDocument: QueryDocumentSnapshot | undefined;
    while (true) {
      let query = firestore.collection("chats").doc(chatId)
        .collection("messages")
        .orderBy(FieldPath.documentId())
        .limit(batchSize);
      if (lastDocument) {
        query = query.startAfter(lastDocument);
      }

      const page = await query.get();
      if (page.empty) {
        break;
      }

      const rows = page.docs.map((document) => {
        const data = document.data();
        if (
          document.id.length > 150 ||
          typeof data.senderId !== "string" ||
          typeof data.text !== "string" ||
          data.text.trim().length === 0 ||
          data.text.length > 10_000 ||
          !(data.createdAt instanceof Timestamp)
        ) {
          throw new Error(`Legacy message ${chatId}/${document.id} has invalid stored data`);
        }
        return {
          id: document.id,
          chatId,
          senderId: data.senderId,
          text: data.text,
          createdAt: data.createdAt.toDate()
        };
      });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `INSERT INTO messages (id, chat_id, sender_id, text, created_at)
           SELECT imported.id, imported.chat_id, imported.sender_id, imported.text, imported.created_at
           FROM UNNEST(
             $1::text[], $2::uuid[], $3::text[], $4::text[], $5::timestamptz[]
           ) AS imported(id, chat_id, sender_id, text, created_at)
           ON CONFLICT (id) DO UPDATE
             SET id = EXCLUDED.id
             WHERE (messages.chat_id, messages.sender_id, messages.text, messages.created_at)
               IS NOT DISTINCT FROM
               (EXCLUDED.chat_id, EXCLUDED.sender_id, EXCLUDED.text, EXCLUDED.created_at)
           RETURNING id`,
          [
            rows.map((row) => row.id),
            rows.map((row) => row.chatId),
            rows.map((row) => row.senderId),
            rows.map((row) => row.text),
            rows.map((row) => row.createdAt)
          ]
        );
        if (result.rowCount !== rows.length) {
          throw new Error(`Legacy message ID conflict while backfilling chat ${chatId}`);
        }
        const latestMessageDate = rows.reduce<Date | undefined>(
          (latest, row) => !latest || row.createdAt > latest ? row.createdAt : latest,
          undefined
        );
        if (latestMessageDate) {
          await client.query(
            "UPDATE chats SET updated_at = GREATEST(updated_at, $2) WHERE id = $1::uuid",
            [chatId, latestMessageDate]
          );
        }
        await client.query("COMMIT");
        processedMessages += rows.length;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Message backfill and rollback failed");
        }
        throw error;
      } finally {
        client.release();
      }

      lastDocument = page.docs[page.docs.length - 1];
    }
  }

  logger.info({ chats: chats.rowCount, messages: processedMessages }, "Firestore message backfill completed");
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
