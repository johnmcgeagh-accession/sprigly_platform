import { z } from 'zod';

export const env = z.object({
  REDIS_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  TAVILY_API_KEY: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  CAL_PYTHON_BIN: z.string().min(1).default('/opt/cal-venv/bin/python'),
  APIFY_API_KEY: z.string().min(1).optional(),
  // Daily voice-batch-merge kill switch. Default true (unset = enabled, so other
  // clients are unaffected). Set to "false" to pause the merge — used while the
  // merge is known to erode curated voice.md content. Coerced explicitly because
  // z.coerce.boolean() treats any non-empty string (incl. "false") as true.
  VOICE_MERGE_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? true : !/^(false|0|no|off)$/i.test(v.trim()))),
}).parse(process.env);
