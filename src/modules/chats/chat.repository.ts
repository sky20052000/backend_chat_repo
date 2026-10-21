import type { PoolClient } from "pg";
import { pool } from "../../infra/database/pool";
import { AppError } from "../../shared/errors/app-error";

export interface ChatSummary {
  chatId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export async function createOrGetDirectChat(userAId: string, userBId: string): Promise<string> {
  const memberIds = [userAId, userBId].sort();
  const pairKey = JSON.stringify(memberIds);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const users = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id = ANY($1::text[])",
      [memberIds]
    );
    if (users.rowCount !== 2) {
      throw new AppError(404, "One or both users do not exist");
    }

    const chat = await client.query<{ id: string }>(
      `INSERT INTO chats (pair_key)
       VALUES ($1)
       ON CONFLICT (pair_key) DO UPDATE SET pair_key = EXCLUDED.pair_key
       RETURNING id`,
      [pairKey]
    );
    const chatId = chat.rows[0]?.id;
    if (!chatId) {
      throw new Error("Chat creation returned no identifier");
    }

    await client.query(
      `INSERT INTO chat_members (chat_id, user_id)
       SELECT $1::uuid, member_id FROM UNNEST($2::text[]) AS member_id
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [chatId, memberIds]
    );
    await client.query("COMMIT");
    return chatId;
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
}

export async function isChatMember(chatId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM chat_members WHERE chat_id = $1::uuid AND user_id = $2",
    [chatId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listChatsForUser(userId: string): Promise<ChatSummary[]> {
  const result = await pool.query<{
    chat_id: string;
    member_ids: string[];
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT c.id AS chat_id,
            ARRAY_AGG(cm.user_id ORDER BY cm.user_id) AS member_ids,
            c.created_at,
            c.updated_at
     FROM chats c
     JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
     JOIN chat_members cm ON cm.chat_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    chatId: row.chat_id,
    memberIds: row.member_ids,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }));
}

export async function updateChatActivity(chatId: string): Promise<void> {
  await pool.query("UPDATE chats SET updated_at = NOW() WHERE id = $1::uuid", [chatId]);
}

export async function withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}

async function rollback(client: PoolClient, originalError: unknown): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError([originalError, rollbackError], "Database transaction and rollback failed");
  }
}
