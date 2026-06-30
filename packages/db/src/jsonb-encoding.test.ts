/**
 * Integration test: JSONB double-encoding regression.
 *
 * Requires a live DATABASE_URL. Run with:
 *   DATABASE_URL=postgresql://... pnpm --filter @sprigly/db test
 *
 * Verifies that objects inserted into JSONB columns via Drizzle are stored as
 * JSON objects (not JSON string literals), so that direct SQL key access works.
 *
 * Root cause of the bug this guards against: postgres.js v3 applies its own
 * JSON.stringify() to JSONB parameters after Drizzle's mapToDriverValue() has
 * already stringified the value, producing a double-encoded string literal.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { sql, db } from './client.js';
import { pgTable, uuid, jsonb } from 'drizzle-orm/pg-core';

const skipMessage = 'DATABASE_URL not set — skipping JSONB integration test';

// Temporary table used only for this test
const testTable = pgTable('_jsonb_encoding_test', {
  id:   uuid('id').primaryKey().defaultRandom(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
});

describe('JSONB encoding (integration)', () => {
  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS _jsonb_encoding_test`;
    await sql.end();
  });

  it('stores objects as JSONB objects, not JSONB string literals', async () => {
    if (!process.env['DATABASE_URL']) return console.warn(skipMessage);

    // Create temp table
    await sql`
      CREATE TEMP TABLE _jsonb_encoding_test (
        id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        data jsonb NOT NULL
      )
    `;

    const payload = { subject: 'Test subject', from: 'alice@example.com' };
    await db.insert(testTable).values({ data: payload });

    // jsonb_typeof must be 'object', not 'string' (double-encoding produces 'string')
    const [typeRow] = await sql<[{ t: string }]>`
      SELECT jsonb_typeof(data) AS t FROM _jsonb_encoding_test LIMIT 1
    `;
    expect(typeRow?.t).toBe('object');

    // Key access must work — returns NULL when value is a JSONB string literal
    const [keyRow] = await sql<[{ subject: string | null }]>`
      SELECT data->>'subject' AS subject FROM _jsonb_encoding_test LIMIT 1
    `;
    expect(keyRow?.subject).toBe('Test subject');
  });
});
