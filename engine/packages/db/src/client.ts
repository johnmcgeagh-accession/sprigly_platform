import { z } from 'zod';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const env = z.object({ DATABASE_URL: z.string().url() }).parse(process.env);

// postgres.js v3 receives the parameter OID from PostgreSQL's ParameterDescription
// response (OID 3802 for jsonb columns) and then applies its built-in json serializer
// (JSON.stringify) in the Bind message. Drizzle's PgJsonb.mapToDriverValue() has already
// called JSON.stringify(), so the value arrives here as a string. The second
// JSON.stringify() double-encodes it → stored as a JSONB string literal instead of object.
// Fix: pass strings through unchanged; only serialize raw objects (defensive).
export const sql = postgres(env.DATABASE_URL, {
  types: {
    json: {
      to:        114,
      from:      [114, 3802],
      serialize: (x: unknown) => typeof x === 'string' ? x : JSON.stringify(x),
      parse:     (x: string)  => JSON.parse(x),
    },
  },
});
export const db = drizzle(sql, { schema });
