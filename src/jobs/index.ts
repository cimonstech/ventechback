import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { cleanupOrphanUploads } from '../services/ticket.service';
import { sendAdminDigest } from './digest';
import { accraDateKey, accraMonthKey } from './lock';
import { runMonthEndWithdrawals } from './monthEnd';
import { runJob } from './run';

const TZ = 'Africa/Accra';

function scheduleJob(pattern: string, name: string, fn: () => Promise<void>) {
  cron.schedule(
    pattern,
    async () => {
      try {
        await fn();
      } catch (error) {
        console.error(`[jobs] uncaught ${name}`, error);
      }
    },
    { timezone: TZ, name, noOverlap: true }
  );
}

scheduleJob('0 15 1 * * *', 'orphan-uploads', async () => {
  await runJob('orphan-uploads', accraDateKey(), async () => {
    const deleted = await cleanupOrphanUploads();
    return { deleted };
  });
});

scheduleJob('0 0 20 L * *', 'month-end-withdrawals', async () => {
  await runJob('month-end-withdrawals', accraMonthKey(), () => runMonthEndWithdrawals());
});

scheduleJob('0 30 7 * * *', 'admin-digest', async () => {
  await runJob('admin-digest', accraDateKey(), () => sendAdminDigest());
});

console.log('[jobs] ventech jobs started (Africa/Accra)');
console.log('[jobs] orphan-uploads 01:15 daily');
console.log('[jobs] month-end-withdrawals 20:00 last day of month');
console.log('[jobs] admin-digest 07:30 daily');

async function stop() {
  try {
    await cron.shutdown();
  } catch (error) {
    console.error('[jobs] shutdown', error);
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
