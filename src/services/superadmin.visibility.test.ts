import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TEAM_ACTOR_NAME,
  auditRowVisibleToViewer,
  isSuperadmin,
  presentAssigneeForViewer,
  presentCustomerActorRole,
  presentStaffFacingActor,
  rewriteAssignedBody,
  staffCountForViewer,
  staffRolesForViewer,
  userLookupStatus,
  visibleStaff,
} from './superadmin.visibility';

const admin = { id: 'admin-1', role: 'admin' as const };
const superadmin = { id: 'sa-1', role: 'superadmin' as const };
const staff = { id: 'staff-1', role: 'staff' as const };
const customer = { id: 'cust-1', role: 'customer' as const };
const saIds = new Set(['sa-1']);

const people = [
  { id: 'staff-1', role: 'staff', email: 'staff@example.com' },
  { id: 'admin-1', role: 'admin', email: 'admin@example.com' },
  { id: 'sa-1', role: 'superadmin', email: 'owner@example.com' },
  { id: 'sa-2', role: 'superadmin', email: 'owner2@example.com' },
];

describe('hide superadmin from non-superadmins', () => {
  it('isSuperadmin is true only when the viewer role is superadmin', () => {
    assert.equal(isSuperadmin(superadmin), true);
    assert.equal(isSuperadmin(admin), false);
    assert.equal(isSuperadmin(staff), false);
    assert.equal(isSuperadmin(null), false);
  });

  it('admin listing users and counting staff leaves superadmin accounts out', () => {
    const listed = visibleStaff(people, admin);
    assert.deepEqual(listed.map((row) => row.id), ['staff-1', 'admin-1']);
    assert.equal(staffCountForViewer(people, admin), 2);
    assert.deepEqual(staffRolesForViewer(admin), ['staff', 'admin']);
  });

  it('superadmin listing users and counting staff sees every staff account', () => {
    const listed = visibleStaff(people, superadmin);
    assert.equal(listed.length, 4);
    assert.equal(staffCountForViewer(people, superadmin), 4);
    assert.deepEqual(staffRolesForViewer(superadmin), ['staff', 'admin', 'superadmin']);
  });

  it('admin fetching a superadmin by id gets the same not_found as a missing user', () => {
    assert.equal(userLookupStatus(null, admin), 'not_found');
    assert.equal(userLookupStatus({ id: 'sa-1', role: 'superadmin' }, admin), 'not_found');
    assert.equal(userLookupStatus({ id: 'staff-1', role: 'staff' }, admin), 'ok');
  });

  it('superadmin fetching a superadmin by id sees the account', () => {
    assert.equal(userLookupStatus({ id: 'sa-1', role: 'superadmin' }, superadmin), 'ok');
  });

  it('admin listing and exporting the audit log drops rows by or about a superadmin', () => {
    const rows = [
      { actor_id: 'admin-1', actor_role: 'admin', entity_id: 'order-1', action: 'update_status' },
      { actor_id: 'sa-1', actor_role: 'superadmin', entity_id: 'order-1', action: 'update_status' },
      { actor_id: 'admin-1', actor_role: 'admin', entity_id: 'sa-1', action: 'update_role', after: { role: 'staff' } },
      { actor_id: 'admin-1', actor_role: 'admin', entity_id: 'staff-1', action: 'update_role', after: { role: 'superadmin' } },
      { actor_id: null, actor_role: null, entity_id: 'settings', action: 'update' },
    ];
    const visible = rows.filter((row) => auditRowVisibleToViewer(row, admin, saIds));
    assert.deepEqual(visible.map((row) => row.action), ['update_status', 'update']);
    const csv = visible.map((row) => row.actor_role || '').join(',');
    assert.equal(csv.includes('superadmin'), false);
  });

  it('superadmin listing and exporting the audit log sees every row', () => {
    const rows = [
      { actor_id: 'sa-1', actor_role: 'superadmin', entity_id: 'order-1', action: 'update_status' },
      { actor_id: 'admin-1', actor_role: 'admin', entity_id: 'sa-1', action: 'update_role' },
    ];
    assert.equal(rows.every((row) => auditRowVisibleToViewer(row, superadmin, saIds)), true);
  });

  it('admin viewing an order timeline where a superadmin acted sees VENTECH Team and no role', () => {
    const presented = presentStaffFacingActor(
      admin,
      { id: 'sa-1', role: 'superadmin', name: 'Hidden Owner' },
      saIds
    );
    assert.equal(presented.name, TEAM_ACTOR_NAME);
    assert.equal(presented.role, null);
    assert.equal(presented.id, null);
  });

  it('superadmin viewing the same order timeline sees the real actor', () => {
    const presented = presentStaffFacingActor(
      superadmin,
      { id: 'sa-1', role: 'superadmin', name: 'Hidden Owner' },
      saIds
    );
    assert.equal(presented.name, 'Hidden Owner');
    assert.equal(presented.role, 'superadmin');
    assert.equal(presented.id, 'sa-1');
  });

  it('a ticket assigned only to a superadmin is locked for admins as VENTECH Team', () => {
    const assignee = presentAssigneeForViewer(
      admin,
      { id: 'sa-1', role: 'superadmin', name: 'Hidden Owner', email: 'owner@example.com' },
      saIds
    );
    assert.equal(assignee.name, TEAM_ACTOR_NAME);
    assert.equal(assignee.id, null);
    assert.equal(assignee.email, null);
    assert.equal(assignee.locked, true);
  });

  it('customers never receive a staff role on ticket events', () => {
    assert.equal(presentCustomerActorRole('superadmin'), null);
    assert.equal(presentCustomerActorRole('admin'), null);
    assert.equal(presentCustomerActorRole('staff'), null);
    assert.equal(presentCustomerActorRole('customer'), 'customer');
  });

  it('assignment event bodies replace a superadmin name for admins', () => {
    const body = rewriteAssignedBody('Assigned to Hidden Owner', ['Hidden Owner'], admin);
    assert.equal(body, `Assigned to ${TEAM_ACTOR_NAME}`);
    assert.equal(rewriteAssignedBody('Assigned to Hidden Owner', ['Hidden Owner'], superadmin), 'Assigned to Hidden Owner');
  });
});
