import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { env, corsOrigins } from "./config/env";
import { logger } from "./infra/logging/logger";
import { pool } from "./infra/database/pool";
import { chatRouter } from "./modules/chats/chat.routes";
import { errorHandler, notFoundHandler } from "./shared/http/error-handler";
import { AppError } from "./shared/errors/app-error";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError(403, "Origin is not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "32kb" }));
app.use(pinoHttp({ logger }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

app.get("/health/live", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/health/ready", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch (error) {
    next(error);
  }
});

app.use(chatRouter);
app.use(notFoundHandler);
app.use(errorHandler);

if (env.NODE_ENV === "test") {
  app.set("trust proxy", false);
}
