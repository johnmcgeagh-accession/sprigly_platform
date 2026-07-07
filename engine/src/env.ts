import { z } from 'zod';

export const env = z.object({
  REDIS_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  TAVILY_API_KEY: z.string().min(1),
  // APP_BASE_URL mints CLIENT app links (/p/<token>) — must be the app origin
  // (e.g. https://app.sprigly.co.uk), NEVER the admin origin. It was previously
  // overloaded to also mean the admin origin, which silently produced dead
  // admin.sprigly.co.uk/p/… links. Reject an admin.* host so a wrong value fails
  // loudly at boot instead of minting 404s. (localhost / app.* pass.)
  APP_BASE_URL: z
    .string()
    .url()
    .refine(
      (v) => {
        try { return !/^admin\./i.test(new URL(v).hostname); }
        catch { return false; }
      },
      'APP_BASE_URL must be the CLIENT app origin (e.g. https://app.sprigly.co.uk), not the admin origin — it mints /p/ client links',
    ),
  // ADMIN_BASE_URL mints ADMIN self-references (the triage digest /review/<token>
  // link, whose route lives in admin/). Defaults to the sole admin origin so the
  // digest keeps working without extra config; override only for local/staging.
  ADMIN_BASE_URL: z.string().url().default('https://admin.sprigly.co.uk'),
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
  // Weekly planning session cron. OFF by default (unset = disabled) until trusted;
  // set to a truthy string to register the Monday 06:00 tick. Explicit coercion so
  // "false"/"0"/"off" stay off.
  WEEKLY_SESSION_CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? false : /^(true|1|yes|on)$/i.test(v.trim()))),
}).parse(process.env);
