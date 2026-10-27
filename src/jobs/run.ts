import { claimJobRun, finishJobRun } from './lock';

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Job failed.';
}

export async function runJob(
  jobName: string,
  periodKey: string,
  work: () => Promise<Record<string, number> | void>
): Promise<void> {
  const started = Date.now();
  console.log(`[jobs] start ${jobName} period=${periodKey}`);
  let runId: string | undefined;
  try {
    const claim = await claimJobRun(jobName, periodKey);
    if (!claim.claimed) {
      console.log(`[jobs] skip ${jobName} period=${periodKey} (already claimed)`);
      return;
    }
    runId = claim.id;
    const counts = (await work()) || {};
    await finishJobRun(runId, 'succeeded', counts);
    console.log(`[jobs] finish ${jobName} period=${periodKey} ms=${Date.now() - started}`, counts);
  } catch (error) {
    console.error(`[jobs] error ${jobName} period=${periodKey}`, error);
    try {
      await finishJobRun(runId, 'failed', null, errorText(error));
    } catch (finishError) {
      console.error(`[jobs] finish ${jobName} failed`, finishError);
    }
  }
}
