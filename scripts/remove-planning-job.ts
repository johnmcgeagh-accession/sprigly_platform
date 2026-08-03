// scripts/remove-planning-job.ts
import { Queue } from 'bullmq';

async function main() {
  const q = new Queue('content-cycles', { connection: { url: process.env.REDIS_URL! } });

  const job = await q.getJob('planning_efae0950-7e01-4a11-a119-cd29a0d64eeb');
  if (!job) {
    console.log('job not found — nothing to remove');
  } else {
    console.log('removing:', job.id, JSON.stringify(job.data));
    await job.remove();
    console.log('removed');
  }

  console.log('waiting', await q.getWaitingCount(), 'active', await q.getActiveCount());
  await q.close();
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
