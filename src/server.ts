import { createServer } from "node:http";
import { Server } from "socket.io";
import { app } from "./app";
import { env, corsOrigins } from "./config/env";
import { pool } from "./infra/database/pool";
import { logger } from "./infra/logging/logger";
import { registerSocketHandlers } from "./modules/realtime/socket";

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOrigins },
  pingTimeout: 20_000,
  pingInterval: 25_000
});

app.set("io", io);
registerSocketHandlers(io);

httpServer.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Chat backend listening");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal).then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "Graceful shutdown failed");
        process.exit(1);
      }
    );
  });
}
