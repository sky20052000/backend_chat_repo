import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error";
import { asyncHandler } from "../../shared/http/async-handler";
import { firebaseAuth } from "../../infra/firebase/admin";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "Bearer token is required");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new AppError(401, "Bearer token is required");
  }

  try {
    const decodedToken = await firebaseAuth.verifyIdToken(token);
    req.userId = decodedToken.uid;
    next();
  } catch {
    next(new AppError(401, "Invalid or expired authentication token"));
  }
});

export function requireAuthenticatedUser(reqUserId: string | undefined): string {
  if (!reqUserId) {
    throw new AppError(401, "Authentication is required");
  }
  return reqUserId;
}
