import type { PoolClient } from "pg";
import { pool } from "../../infra/database/pool";
import { AppError } from "../../shared/errors/app-error";
import type { MessageCursor } from "./message.cursor";

export interface StoredMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: Date;
  cursor_created_at: string;
}

export async function insertMessage(
  chatId: string,
  senderId: string,
  text: string
): Promise<StoredMessage> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const membership = await client.query(
      "SELECT 1 FROM chat_members WHERE chat_id = $1::uuid AND user_id = $2",
      [chatId, senderId]
    );
    if ((membership.rowCount ?? 0) === 0) {
      throw new AppError(404, "Chat not found");
    }

    const result = await client.query<StoredMessage>(
      `INSERT INTO messages (chat_id, sender_id, text)
       VALUES ($1::uuid, $2, $3)
       RETURNING id, chat_id, sender_id, text, created_at,
                 created_at::text AS cursor_created_at`,
      [chatId, senderId, text]
    );
    const message = result.rows[0];
    if (!message) {
      throw new Error("Message creation returned no record");
    }

    await client.query("UPDATE chats SET updated_at = NOW() WHERE id = $1::uuid", [chatId]);
    await client.query("COMMIT");
    return message;
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
}

export async function selectMessages(
  chatId: string,
  limit: number,
  cursor?: MessageCursor
): Promise<{ messages: StoredMessage[]; hasMore: boolean }> {
  const result = await pool.query<StoredMessage>(
    `SELECT id, chat_id, sender_id, text, created_at,
            created_at::text AS cursor_created_at
     FROM messages
     WHERE chat_id = $1::uuid
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [chatId, cursor?.createdAt ?? null, cursor?.messageId ?? null, limit + 1]
  );
  return {
    messages: result.rows.slice(0, limit),
    hasMore: result.rows.length > limit
  };
}

export async function messageExists(chatId: string, messageId: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM messages WHERE chat_id = $1::uuid AND id = $2",
    [chatId, messageId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function rollback(client: PoolClient, originalError: unknown): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError([originalError, rollbackError], "Message transaction and rollback failed");
  }
}
