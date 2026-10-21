import { pool } from "../../infra/database/pool";

export async function updateChatActivity(chatId: string): Promise<void> {
  await pool.query("UPDATE chats SET updated_at = NOW() WHERE id = $1::uuid", [chatId]);
}
