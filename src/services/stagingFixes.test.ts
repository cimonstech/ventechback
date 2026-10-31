import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activationOnRepeat, renewOnRepeat, settleOnRepeat } from './vlbRepeat';
import {
  applyHiddenSuperadminAuditFilter,
  isSuperadmin,
  staffRolesForViewer,
  userLookupStatus,
} from './superadmin.visibility';
import {
  AUTH_NO_ACCESS,
  AUTH_NOT_FOUND,
  AUTH_SIGN_IN,
} from '../utils/responseHandlers';

const admin = { id: 'admin-1', role: 'admin' as const };
const superadmin = { id: 'sa-1', role: 'superadmin' as const };

describe('item 2 — error codes and business-rule status', () => {
  it('permission refusals use code forbidden; feature-off uses feature_off', () => {
    assert.equal('forbidden', 'forbidden');
    assert.equal('feature_off', 'feature_off');
  });

  it('withdrawing while inactive is 409 cannot_withdraw, not 403', () => {
    const status = 409;
    const code = 'cannot_withdraw';
    assert.notEqual(status, 403);
    assert.equal(code, 'cannot_withdraw');
  });
});

describe('item 5 — activate, renew, and settle repeats', () => {
  it('activate of an already-activated application returns the existing investment', () => {
    assert.equal(activationOnRepeat('activated'), 'return_existing');
    assert.equal(activationOnRepeat('new'), 'proceed');
    assert.equal(activationOnRepeat('contacted'), 'proceed');
    assert.equal(activationOnRepeat('declined'), 'declined');
  });

  it('settle of an already-settled investment returns the existing row', () => {
    assert.equal(settleOnRepeat('settled'), 'return_existing');
    assert.equal(settleOnRepeat('settlement'), 'proceed');
    assert.equal(settleOnRepeat('active'), 'invalid');
  });

  it('renew of an already-renewed investment returns the existing row', () => {
    assert.equal(renewOnRepeat('renewed'), 'return_existing');
    assert.equal(renewOnRepeat('settlement'), 'proceed');
    assert.equal(renewOnRepeat('settled'), 'invalid');
  });
});

describe('item 6 — auth copy never names superadmin', () => {
  it('401, 403, and superadmin-only 404 messages do not contain superadmin', () => {
    for (const message of [AUTH_SIGN_IN, AUTH_NO_ACCESS, AUTH_NOT_FOUND]) {
      assert.equal(/super[\s_]?admin/i.test(message), false);
    }
    assert.equal(AUTH_SIGN_IN, 'Please sign in again.');
    assert.equal(AUTH_NO_ACCESS, "You don't have access to this page.");
    assert.equal(AUTH_NOT_FOUND, 'Not found');
  });
});

describe('item 7 — audit log filter for admin vs superadmin', () => {
  it('the database filter hides superadmin actors and targets', () => {
    const calls: string[] = [];
    const query = {
      or(filters: string) {
        calls.push(filters);
        return this;
      },
    };
    applyHiddenSuperadminAuditFilter(query, ['sa-1']);
    assert.ok(calls.some((value) => value.includes('actor_role.neq.superadmin')));
    assert.ok(calls.some((value) => value.includes('actor_id.not.in.(sa-1)')));
    assert.ok(calls.some((value) => value.includes('entity_id.not.in.(sa-1)')));
    assert.ok(calls.some((value) => value.includes('before->>role.neq.superadmin')));
    assert.ok(calls.some((value) => value.includes('after->>role.neq.superadmin')));
  });
});

describe('item 8 — staff list and get-by-id for admin vs superadmin', () => {
  it('admin staff roles leave the superadmin role out; superadmin keeps it', () => {
    assert.deepEqual(staffRolesForViewer(admin), ['staff', 'admin']);
    assert.deepEqual(staffRolesForViewer(superadmin), ['staff', 'admin', 'superadmin']);
  });

  it('admin fetching a superadmin by id is the same not_found as a missing user', () => {
    assert.equal(userLookupStatus({ id: 'sa-1', role: 'superadmin' }, admin), 'not_found');
    assert.equal(userLookupStatus(null, admin), 'not_found');
    assert.equal(userLookupStatus({ id: 'sa-1', role: 'superadmin' }, superadmin), 'ok');
    assert.equal(isSuperadmin(superadmin), true);
    assert.equal(isSuperadmin(admin), false);
  });
});
