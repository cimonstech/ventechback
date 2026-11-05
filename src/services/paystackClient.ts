import axios, { AxiosError } from 'axios';

export const PAYSTACK_TIMEOUT_MS = 15000;
export const PAYSTACK_INITIALIZE_FAILED =
  "We couldn't start your payment. Please try again.";

export const paystackClient = axios.create({
  baseURL: 'https://api.paystack.co',
  timeout: PAYSTACK_TIMEOUT_MS,
});

paystackClient.interceptors.request.use((config) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  config.headers = config.headers || {};
  if (secret) {
    config.headers.Authorization = `Bearer ${secret}`;
  }
  if (!config.headers['Content-Type'] && !config.headers['content-type']) {
    config.headers['Content-Type'] = 'application/json';
  }
  return config;
});

export function isPaystackTimeout(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string }; message?: string };
  const code = err?.code || err?.cause?.code || '';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  if (error instanceof AxiosError && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
    return true;
  }
  return /timeout of \d+ms exceeded/i.test(String(err?.message || ''));
}

export function paystackVerifyTimeoutMessage(reference?: string | null): string {
  const ref = typeof reference === 'string' ? reference.trim() : '';
  if (ref) {
    return `We couldn't confirm your payment yet. If you were charged, contact support with reference ${ref}. You won't be charged twice.`;
  }
  return "We couldn't confirm your payment yet. If you were charged, contact support with your payment reference. You won't be charged twice.";
}

function logTimeout(endpoint: string, reference?: unknown) {
  const ref = typeof reference === 'string' ? reference : '';
  console.error('[paystack-timeout]', endpoint, ref);
}

export async function initializePaystackTransaction(payload: Record<string, unknown>) {
  try {
    return await paystackClient.post('/transaction/initialize', payload);
  } catch (error) {
    if (isPaystackTimeout(error)) {
      logTimeout('POST /transaction/initialize', payload.reference);
    }
    throw error;
  }
}

export async function verifyPaystackTransaction(reference: string) {
  try {
    return await paystackClient.get(`/transaction/verify/${encodeURIComponent(reference)}`);
  } catch (error) {
    if (isPaystackTimeout(error)) {
      logTimeout('GET /transaction/verify', reference);
    }
    throw error;
  }
}
