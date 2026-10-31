import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectTicketFile } from './ticketFiles';
import {
  activationAgreementMessage,
  canAddAgreementFiles,
  hasLiveSignedAgreement,
  hashUploadToken,
  incomingAgreementMode,
  issueUploadToken,
  liveSignedAgreement,
  refuseAgreementFile,
  tokenHashesMatch,
  uploadTokenState,
} from './vlbSignedAgreement';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = Buffer.from('%PDF-1.4\n');
const txt = Buffer.from('not a real file');

describe('activation blocked without a signed agreement file', () => {
  it('refuses when there is no live file', () => {
    assert.equal(hasLiveSignedAgreement([]), false);
    assert.equal(
      activationAgreementMessage([]),
      'Upload the signed agreement before activating.'
    );
  });

  it('a removed file does not count', () => {
    const files = [
      { kind: 'signed_agreement', deleted_at: '2026-10-31T08:00:00.000Z' },
    ];
    assert.equal(liveSignedAgreement(files).length, 0);
    assert.equal(hasLiveSignedAgreement(files), false);
    assert.equal(
      activationAgreementMessage(files),
      'Upload the signed agreement before activating.'
    );
  });

  it('allows after an applicant upload', () => {
    const files = [{ kind: 'signed_agreement', deleted_at: null, group: 'pdf' as const }];
    assert.equal(hasLiveSignedAgreement(files), true);
    assert.equal(activationAgreementMessage(files), null);
  });

  it('allows after an admin upload', () => {
    const files = [{ kind: 'signed_agreement', deleted_at: null, mime_type: 'image/jpeg' }];
    assert.equal(hasLiveSignedAgreement(files), true);
    assert.equal(activationAgreementMessage(files), null);
  });
});

describe('upload token', () => {
  it('matches the stored hash', () => {
    const issued = issueUploadToken();
    assert.equal(tokenHashesMatch(issued.hash, issued.token), true);
    assert.equal(hashUploadToken(issued.token), issued.hash);
    assert.equal(tokenHashesMatch(issued.hash, 'other-token'), false);
  });

  it('refuses an expired link', () => {
    const issued = issueUploadToken(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const state = uploadTokenState({
      status: 'new',
      hash: issued.hash,
      expiresAt: issued.expiresAt,
      token: issued.token,
      now: Date.now(),
    });
    assert.equal(state, 'expired');
  });

  it('closes after activate or decline', () => {
    const issued = issueUploadToken();
    assert.equal(
      uploadTokenState({
        status: 'activated',
        hash: issued.hash,
        expiresAt: issued.expiresAt,
        token: issued.token,
      }),
      'closed'
    );
    assert.equal(
      uploadTokenState({
        status: 'declined',
        hash: issued.hash,
        expiresAt: issued.expiresAt,
        token: issued.token,
      }),
      'closed'
    );
  });
});

describe('wrong file type refused', () => {
  it('detects PDF, JPEG and PNG by content, not the name', () => {
    assert.equal(detectTicketFile(pdf)?.group, 'pdf');
    assert.equal(detectTicketFile(jpeg)?.group, 'image');
    assert.equal(detectTicketFile(png)?.group, 'image');
    assert.equal(detectTicketFile(txt), null);
  });

  it('refuses unknown bytes and video', () => {
    assert.equal(refuseAgreementFile(null, 100), 'Upload a PDF, JPG, PNG or HEIC file.');
    assert.equal(
      refuseAgreementFile({ mime: 'video/mp4', ext: 'mp4', group: 'video' }, 100),
      'Upload a PDF, JPG, PNG or HEIC file.'
    );
    assert.equal(
      refuseAgreementFile({ mime: 'application/pdf', ext: 'pdf', group: 'pdf' }, 11 * 1024 * 1024),
      'Each file must be 10 MB or smaller.'
    );
  });

  it('does not mix a PDF with photos', () => {
    const mixed = incomingAgreementMode([
      { mime: 'application/pdf', ext: 'pdf', group: 'pdf' },
      { mime: 'image/jpeg', ext: 'jpg', group: 'image' },
    ]);
    assert.equal(mixed.ok, false);
  });

  it('blocks a second PDF when one is already on file', () => {
    const result = canAddAgreementFiles(
      [{ kind: 'signed_agreement', deleted_at: null, group: 'pdf' }],
      [{ mime: 'application/pdf', ext: 'pdf', group: 'pdf' }]
    );
    assert.equal(result.ok, false);
  });
});
