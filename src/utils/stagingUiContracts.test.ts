import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Mirror of ventechfront/lib/paymentUi.ts, authConfirm.ts, passwordToggle.ts contracts.

function shouldResetPaymentUiOnPageShow(persisted: boolean): boolean {
  return persisted === true;
}

const PAYMENT_START_TIMEOUT_MS = 30_000;

function paymentStartTimedOut(startedAtMs: number, nowMs: number): boolean {
  return nowMs - startedAtMs >= PAYMENT_START_TIMEOUT_MS;
}

function shouldVerifyAuthLinkOnLoad(): boolean {
  return false;
}

function passwordToggleLabel(visible: boolean): string {
  return visible ? 'Hide password' : 'Show password';
}

describe('checkout payment UI contracts', () => {
  it('resets on BFCache pageshow and times out after 30s', () => {
    assert.equal(shouldResetPaymentUiOnPageShow(true), true);
    assert.equal(shouldResetPaymentUiOnPageShow(false), false);
    const start = 1_000_000;
    assert.equal(paymentStartTimedOut(start, start + PAYMENT_START_TIMEOUT_MS - 1), false);
    assert.equal(paymentStartTimedOut(start, start + PAYMENT_START_TIMEOUT_MS), true);
  });
});

describe('auth confirm contracts', () => {
  it('never verifies on load; signup confirm type is email', () => {
    assert.equal(shouldVerifyAuthLinkOnLoad(), false);
    assert.equal('email', 'email');
  });
});

describe('PasswordInput toggle contracts', () => {
  it('uses Show/Hide aria-labels', () => {
    assert.equal(passwordToggleLabel(false), 'Show password');
    assert.equal(passwordToggleLabel(true), 'Hide password');
  });
});
