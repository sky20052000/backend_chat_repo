import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../../infra/logging/logger";
import { AppError } from "../errors/app-error";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      details: error.issues.map(({ path, message }) => ({ path: path.join("."), message }))
    });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Malformed JSON request body" });
    return;
  }
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }

  const statusCode = error instanceof AppError ? error.statusCode : 500;
  if (statusCode >= 500) {
    logger.error({ err: error }, "Request failed");
  }
  res.status(statusCode).json({
    error: statusCode === 500
      ? "Internal server error"
      : error instanceof Error ? error.message : "Request failed"
  });
};
