import { claimJobRun, finishJobRun } from '../jobs/lock';
import enhancedEmailService from './enhanced-email.service';
import { shouldSendPaymentFailureEmail } from './paymentFailureEmail.logic';

const JOB_NAME = 'payment-failure-email';

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Payment failure email failed.';
}

/**
 * Send the payment-problem email at most once per Paystack/transaction reference
 * using jobs_runs claim/finish (same pattern as VLB once()).
 */
export async function sendPaymentFailureEmailOnce(
  reference: string,
  orderData: {
    customer_email?: string | null;
    [key: string]: unknown;
  }
): Promise<'sent' | 'skipped' | 'failed'> {
  const ref = String(reference || '').trim();
  if (!ref || !orderData?.customer_email) return 'skipped';

  let runId: string | undefined;
  try {
    const claim = await claimJobRun(JOB_NAME, ref);
    if (!claim.claimed) return 'skipped';
    runId = claim.id;

    const result = await enhancedEmailService.sendPaymentProblem(orderData);
    if (!result.success) {
      throw new Error(result.reason || 'Failed to send payment problem email');
    }

    await finishJobRun(runId, 'succeeded', { emailed: 1 });
    return 'sent';
  } catch (error) {
    console.error('[payment-failure-email]', ref, error);
    try {
      await finishJobRun(runId, 'failed', null, errorText(error));
    } catch (finishError) {
      console.error('[payment-failure-email] finish', finishError);
    }
    return 'failed';
  }
}

export async function maybeNotifyPaymentFailure(input: {
  rawPaystackStatus: unknown;
  orderId: string | null | undefined;
  reference: string;
  loadOrder: () => Promise<{
    customer_email?: string | null;
    [key: string]: unknown;
  } | null>;
}): Promise<'sent' | 'skipped' | 'failed'> {
  if (
    !shouldSendPaymentFailureEmail({
      rawPaystackStatus: input.rawPaystackStatus,
      orderId: input.orderId,
    })
  ) {
    return 'skipped';
  }

  try {
    const orderData = await input.loadOrder();
    if (!orderData?.customer_email) return 'skipped';
    return sendPaymentFailureEmailOnce(input.reference, orderData);
  } catch (error) {
    console.error('[payment-failure-email] load', error);
    return 'failed';
  }
}
