import { Pool } from "pg";
import { env } from "../../config/env";
import { logger } from "../logging/logger";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  application_name: "chatbot_backend_app"
});

pool.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL idle client error");
});
