/**
 * One-shot re-enqueue script for stuck voice:ingest runs.
 * Usage: pnpm --filter @sprigly/worker exec tsx src/reenqueue-voice.ts <runId> <clientId> <channel>
 */
import { Queue } from 'bullmq';

const [, , runId, clientId, channel] = process.argv;
if (!runId || !clientId || !channel) {
  console.error('Usage: tsx src/reenqueue-voice.ts <runId> <clientId> <channel>');
  process.exit(1);
}

const redisUrl = process.env['REDIS_URL'];
if (!redisUrl) throw new Error('REDIS_URL not set');

const q = new Queue('voice-ingest', { connection: { url: redisUrl } });
await q.add('voice:ingest', { runId, clientId, channel });
await q.close();
console.log(`enqueued voice:ingest for run ${runId}`);
