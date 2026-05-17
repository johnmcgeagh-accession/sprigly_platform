import { z } from 'zod';

export const env = z.object({
  REDIS_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  TAVILY_API_KEY: z.string().min(1),
}).parse(process.env);
