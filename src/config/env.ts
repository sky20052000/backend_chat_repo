import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  FIREBASE_PROJECT_ID: z.string().min(1),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10)
});

export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
