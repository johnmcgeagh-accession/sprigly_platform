import { z } from 'zod';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const env = z.object({ DATABASE_URL: z.string().url() }).parse(process.env);

export const sql = postgres(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
