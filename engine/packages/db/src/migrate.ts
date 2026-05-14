import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.js';

await migrate(db, { migrationsFolder: './migrations' });
console.log('Migration complete');
await sql.end();
