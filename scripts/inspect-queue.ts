// scripts/inspect-queue.ts
import { Queue } from 'bullmq';

async function main() {
  const q = new Queue('content-cycles', { connection: { url: process.env.REDIS_URL! } });
  console.log('waiting', await q.getWaitingCount(), 'active', await q.getActiveCount(),
              'delayed', await q.getDelayedCount(), 'failed', await q.getFailedCount());
  const jobs = await q.getJobs(['waiting', 'active', 'failed']);
  console.log(jobs.map(j => ({ id: j.id, name: j.name, data: j.data })));
  await q.close();
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
