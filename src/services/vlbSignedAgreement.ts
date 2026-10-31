import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { DetectedTicketFile } from './ticketFiles';

export const AGREEMENT_FILE_LIMIT = 10 * 1024 * 1024;
export const MAX_AGREEMENT_PHOTOS = 10;
export const UPLOAD_TOKEN_DAYS = 14;

export type AgreementUploadVia = 'application_form' | 'upload_link' | 'admin';
export type AgreementFileKind = 'signed_agreement' | 'other';

export type LiveAgreementFile = {
  kind: string;
  deleted_at?: string | null;
  mime_type?: string;
  group?: 'pdf' | 'image' | 'video';
};

export function hashUploadToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueUploadToken(now = Date.now()): { token: string; hash: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashUploadToken(token),
    expiresAt: new Date(now + UPLOAD_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function tokenHashesMatch(storedHash: string | null | undefined, token: string): boolean {
  if (!storedHash) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashUploadToken(token), 'hex');
  if (expected.length !== actual.length || expected.length === 0) return false;
  return timingSafeEqual(expected, actual);
}

export function uploadTokenState(input: {
  status: string;
  hash: string | null | undefined;
  expiresAt: string | null | undefined;
  token: string;
  now?: number;
}): 'ok' | 'expired' | 'closed' | 'mismatch' {
  if (input.status === 'activated' || input.status === 'declined') return 'closed';
  if (!tokenHashesMatch(input.hash, input.token)) return 'mismatch';
  const expires = Date.parse(String(input.expiresAt || ''));
  const now = input.now ?? Date.now();
  if (!Number.isFinite(expires) || expires <= now) return 'expired';
  return 'ok';
}

export function liveSignedAgreement(files: LiveAgreementFile[]): LiveAgreementFile[] {
  return files.filter((file) => file.kind === 'signed_agreement' && !file.deleted_at);
}

export function hasLiveSignedAgreement(files: LiveAgreementFile[]): boolean {
  return liveSignedAgreement(files).length > 0;
}

export function agreementMode(files: LiveAgreementFile[]): 'none' | 'pdf' | 'photos' {
  const live = liveSignedAgreement(files);
  if (live.length === 0) return 'none';
  if (live.some((file) => file.group === 'pdf' || (file.mime_type || '').includes('pdf'))) return 'pdf';
  return 'photos';
}

export function refuseAgreementFile(detected: DetectedTicketFile | null, size: number): string | null {
  if (!detected) return 'Upload a PDF, JPG, PNG or HEIC file.';
  if (detected.group === 'video') return 'Upload a PDF, JPG, PNG or HEIC file.';
  if (size > AGREEMENT_FILE_LIMIT) return 'Each file must be 10 MB or smaller.';
  return null;
}

export function incomingAgreementMode(
  detected: Array<DetectedTicketFile>
): { ok: true; mode: 'pdf' | 'photos' } | { ok: false; error: string } {
  if (detected.length === 0) return { ok: false, error: 'Choose a file.' };
  const pdfs = detected.filter((file) => file.group === 'pdf').length;
  const photos = detected.filter((file) => file.group === 'image').length;
  if (pdfs && photos) return { ok: false, error: 'Upload one PDF, or photos of every page — not both.' };
  if (pdfs > 1) return { ok: false, error: 'Upload a single PDF.' };
  if (pdfs === 1) return { ok: true, mode: 'pdf' };
  if (photos > MAX_AGREEMENT_PHOTOS) {
    return { ok: false, error: `Upload up to ${MAX_AGREEMENT_PHOTOS} photos.` };
  }
  if (photos === 0) return { ok: false, error: 'Upload a PDF, JPG, PNG or HEIC file.' };
  return { ok: true, mode: 'photos' };
}

export function canAddAgreementFiles(
  existing: LiveAgreementFile[],
  incoming: DetectedTicketFile[]
): { ok: true } | { ok: false; error: string } {
  const classified = incomingAgreementMode(incoming);
  if (!classified.ok) return classified;
  const current = agreementMode(existing);
  const liveCount = liveSignedAgreement(existing).length;
  if (current === 'none') return { ok: true };
  if (current === 'pdf' || classified.mode === 'pdf') {
    return { ok: false, error: 'A PDF is already on file. Remove it before uploading another file.' };
  }
  if (liveCount + incoming.length > MAX_AGREEMENT_PHOTOS) {
    return { ok: false, error: `Upload up to ${MAX_AGREEMENT_PHOTOS} photos in total.` };
  }
  return { ok: true };
}

export function activationAgreementMessage(files: LiveAgreementFile[]): string | null {
  if (hasLiveSignedAgreement(files)) return null;
  return 'Upload the signed agreement before activating.';
}

export function safeFileName(name: string | undefined, fallback: string): string {
  const raw = String(name || fallback).replace(/\\/g, '/');
  const base = raw.split('/').pop() || fallback;
  return base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180).trim() || fallback;
}
