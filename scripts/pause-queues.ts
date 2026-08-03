// scripts/pause-queues.ts
import { Queue } from 'bullmq';

const QUEUES = ['content-cycles', 'calendar-events', 'incoming-events'];

async function main() {
  const url = process.env.REDIS_URL!;
  if (!url) throw new Error('REDIS_URL not set');

  for (const name of QUEUES) {
    const q = new Queue(name, { connection: { url } });

    const schedulers = await q.getJobSchedulers();
    console.log(`${name} schedulers:`, JSON.stringify(schedulers, null, 2));

    const repeatables = await q.getRepeatableJobs();
    console.log(`${name} repeatables:`, JSON.stringify(repeatables, null, 2));
    await q.resume();
   // await q.pause();
    console.log(`${name} paused:`, await q.isPaused());

    let active = await q.getActiveCount();
    while (active > 0) {
      console.log(`${name} active: ${active} — waiting`);
      await new Promise((r) => setTimeout(r, 2000));
      active = await q.getActiveCount();
    }
    console.log(`${name} drained. waiting=${await q.getWaitingCount()} delayed=${await q.getDelayedCount()}`);
    await q.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);
