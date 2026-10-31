import { randomUUID } from 'crypto';
import { Request } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService } from './email.service';
import { siteOrigin } from './affiliate.service';
import { copyPrivateObject, getSignedViewUrl, putPrivateObject } from './privateStorage.service';
import { detectTicketFile, type DetectedTicketFile } from './ticketFiles';
import { VlbError } from './vlb.service';
import { publicAgreementTemplateLink } from './vlbInvestor.service';
import {
  AGREEMENT_FILE_LIMIT,
  canAddAgreementFiles,
  hasLiveSignedAgreement,
  hashUploadToken,
  issueUploadToken,
  liveSignedAgreement,
  refuseAgreementFile,
  safeFileName,
  uploadTokenState,
  type AgreementUploadVia,
} from './vlbSignedAgreement';

type AuditReq = Request & { user?: { id?: string; role?: string } };

export type UploadedAgreementFile = {
  buffer: Buffer;
  size: number;
  originalname?: string;
};

type ApplicationFileRow = {
  id: string;
  application_id: string;
  kind: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_via: string;
  created_at: string;
  deleted_at: string | null;
  deleted_reason: string | null;
  deleted_by: string | null;
};

function logDb(scope: string, error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
  console.error(`vlb agreement ${scope}`, message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function jpegFromHeic(buffer: Buffer): Promise<Buffer> {
  try {
    const loaded = await import('heic-convert');
    const convert = (loaded as { default?: (input: { buffer: Buffer; format: string; quality: number }) => Promise<ArrayBuffer> }).default
      || (loaded as unknown as (input: { buffer: Buffer; format: string; quality: number }) => Promise<ArrayBuffer>);
    const out = await convert({ buffer, format: 'JPEG', quality: 0.92 });
    return Buffer.from(out);
  } catch (error) {
    logDb('heic convert', error);
    throw new VlbError(400, 'Could not read this HEIC photo. Save it as JPG and try again.');
  }
}

async function prepareFile(file: UploadedAgreementFile): Promise<{
  buffer: Buffer;
  size: number;
  detected: DetectedTicketFile;
  fileName: string;
}> {
  if (!file.buffer?.length) throw new VlbError(400, 'Choose a file.', 'validation', { files: 'Choose a file.' });
  if (file.size > AGREEMENT_FILE_LIMIT) {
    throw new VlbError(400, 'Each file must be 10 MB or smaller.', 'validation', { files: 'Each file must be 10 MB or smaller.' });
  }
  let detected = detectTicketFile(file.buffer);
  const typeError = refuseAgreementFile(detected, file.size);
  if (typeError || !detected) {
    throw new VlbError(400, typeError || 'Upload a PDF, JPG, PNG or HEIC file.', 'validation', {
      files: typeError || 'Upload a PDF, JPG, PNG or HEIC file.',
    });
  }
  let buffer = file.buffer;
  if (detected.mime === 'image/heic' || detected.mime === 'image/heif') {
    buffer = await jpegFromHeic(file.buffer);
    detected = { mime: 'image/jpeg', ext: 'jpg', group: 'image' };
  }
  const fallback = detected.group === 'pdf' ? 'signed-agreement.pdf' : 'signed-agreement.jpg';
  const fileName = safeFileName(file.originalname, fallback);
  const named = detected.group === 'pdf'
    ? (/\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`)
    : fileName.replace(/\.(heic|heif)$/i, '.jpg');
  return { buffer, size: buffer.length, detected, fileName: named };
}

export async function listApplicationFiles(applicationId: string, includeDeleted = false) {
  let query = supabaseAdmin
    .from('vlb_application_files')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: true });
  if (!includeDeleted) query = query.is('deleted_at', null);
  const { data, error } = await query;
  if (error) {
    logDb('list files', error);
    throw new VlbError(500, 'Could not load agreement files.');
  }
  return (data || []) as ApplicationFileRow[];
}

export async function applicationHasSignedAgreement(applicationId: string): Promise<boolean> {
  const files = await listApplicationFiles(applicationId);
  return hasLiveSignedAgreement(files);
}

export async function applicationIdsWithSignedAgreement(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('vlb_application_files')
    .select('application_id')
    .eq('kind', 'signed_agreement')
    .is('deleted_at', null);
  if (error) {
    logDb('agreement coverage', error);
    throw new VlbError(500, 'Could not load applications.');
  }
  return new Set((data || []).map((row) => row.application_id));
}

async function loadApplication(id: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_applications')
    .select('*, vlb_plans(name, plan_group, tier, version, principal_pesewas)')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('load application', error);
    throw new VlbError(500, 'Could not load this application.');
  }
  if (!data) throw new VlbError(404, 'Application not found.');
  return data;
}

async function loadApplicationByToken(token: string) {
  const hash = hashUploadToken(token);
  const { data, error } = await supabaseAdmin
    .from('vlb_applications')
    .select('*, vlb_plans(name, plan_group, tier, version)')
    .eq('agreement_upload_token_hash', hash)
    .maybeSingle();
  if (error) {
    logDb('load application by token', error);
    throw new VlbError(500, 'Could not load this upload link.');
  }
  if (!data) throw new VlbError(404, 'This upload link is not valid.', 'not_found');
  const state = uploadTokenState({
    status: data.status,
    hash: data.agreement_upload_token_hash,
    expiresAt: data.agreement_upload_token_expires_at,
    token,
  });
  if (state === 'expired') throw new VlbError(400, 'This upload link has expired. Ask us to send a new one.', 'expired');
  if (state === 'closed') throw new VlbError(400, 'This application can no longer accept files.', 'closed');
  if (state !== 'ok') throw new VlbError(404, 'This upload link is not valid.', 'not_found');
  return data;
}

export async function saveUploadToken(applicationId: string, now = Date.now()) {
  const issued = issueUploadToken(now);
  const { error } = await supabaseAdmin
    .from('vlb_applications')
    .update({
      agreement_upload_token_hash: issued.hash,
      agreement_upload_token_expires_at: issued.expiresAt,
    })
    .eq('id', applicationId);
  if (error) {
    logDb('save upload token', error);
    throw new VlbError(500, 'Could not create an upload link.');
  }
  return issued;
}

export async function clearUploadToken(applicationId: string) {
  const { error } = await supabaseAdmin
    .from('vlb_applications')
    .update({
      agreement_upload_token_hash: null,
      agreement_upload_token_expires_at: null,
    })
    .eq('id', applicationId);
  if (error) logDb('clear upload token', error);
}

export function uploadPageUrl(token: string): string | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return `${origin}/laptop-banking/agreement-upload?token=${encodeURIComponent(token)}`;
}

export async function storeAgreementFiles(
  req: AuditReq,
  applicationId: string,
  files: UploadedAgreementFile[],
  via: AgreementUploadVia
) {
  if (files.length === 0) return [];
  const existing = await listApplicationFiles(applicationId);
  const prepared = [];
  for (const file of files) {
    prepared.push(await prepareFile(file));
  }
  const allowed = canAddAgreementFiles(
    existing.map((row) => ({
      kind: row.kind,
      deleted_at: row.deleted_at,
      mime_type: row.mime_type,
    })),
    prepared.map((row) => row.detected)
  );
  if (!allowed.ok) {
    throw new VlbError(400, allowed.error, 'validation', { files: allowed.error });
  }

  const stored: ApplicationFileRow[] = [];
  for (const file of prepared) {
    const key = `vlb/applications/${applicationId}/${randomUUID()}.${file.detected.ext}`;
    try {
      await putPrivateObject(key, file.buffer, file.detected.mime);
    } catch (error) {
      logDb('store file', error);
      throw new VlbError(500, 'Could not store this file.');
    }
    const { data, error } = await supabaseAdmin
      .from('vlb_application_files')
      .insert({
        application_id: applicationId,
        kind: 'signed_agreement',
        file_key: key,
        file_name: file.fileName,
        mime_type: file.detected.mime,
        size_bytes: file.size,
        uploaded_by: via === 'admin' ? (req.user?.id || null) : null,
        uploaded_via: via,
      })
      .select('*')
      .single();
    if (error || !data) {
      logDb('insert file', error);
      throw new VlbError(500, 'Could not store this file.');
    }
    stored.push(data as ApplicationFileRow);
    await logAudit({
      req,
      entity: 'vlb_application_files',
      entityId: data.id,
      action: 'vlb_signed_agreement_uploaded',
      after: {
        id: data.id,
        application_id: applicationId,
        file_name: data.file_name,
        uploaded_via: via,
      },
    });
  }
  return stored;
}

export async function presentAdminAgreementFiles(applicationId: string) {
  const files = await listApplicationFiles(applicationId);
  const rows = [];
  for (const file of files) {
    let url: string | null = null;
    try {
      url = await getSignedViewUrl(file.file_key);
    } catch (error) {
      logDb('sign application file', error);
    }
    rows.push({
      id: file.id,
      file_name: file.file_name,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      uploaded_via: file.uploaded_via,
      uploaded_by: file.uploaded_by,
      created_at: file.created_at,
      url,
    });
  }
  return rows;
}

export function publicFileNames(files: ApplicationFileRow[]) {
  return liveSignedAgreement(files).map((file) => ({
    id: (file as ApplicationFileRow).id,
    file_name: (file as ApplicationFileRow).file_name,
    created_at: (file as ApplicationFileRow).created_at,
  }));
}

export async function getPublicUploadPage(token: string) {
  const application = await loadApplicationByToken(token);
  const files = await listApplicationFiles(application.id);
  let blank: { title: string; url: string } | null = null;
  try {
    const template = await publicAgreementTemplateLink();
    if (template.url) blank = { title: template.title, url: template.url };
  } catch (error) {
    logDb('blank agreement', error);
  }
  const plan = Array.isArray(application.vlb_plans) ? application.vlb_plans[0] : application.vlb_plans;
  return {
    full_name: application.full_name,
    plan_name: (plan as { name?: string } | null)?.name || 'Laptop Banking',
    blank_agreement: blank,
    files: publicFileNames(files),
  };
}

export async function uploadWithToken(req: AuditReq, token: string, files: UploadedAgreementFile[]) {
  const application = await loadApplicationByToken(token);
  const stored = await storeAgreementFiles(req, application.id, files, 'upload_link');
  return {
    files: publicFileNames(stored),
    message: "Thank you. We've received your signed agreement.",
  };
}

export async function adminUploadAgreementFiles(
  req: AuditReq,
  applicationId: string,
  files: UploadedAgreementFile[]
) {
  const application = await loadApplication(applicationId);
  if (application.status === 'activated' || application.status === 'declined') {
    throw new VlbError(400, 'This application can no longer accept files.');
  }
  const stored = await storeAgreementFiles(req, applicationId, files, 'admin');
  return presentAdminAgreementFiles(applicationId).then((rows) => ({
    files: rows,
    uploaded: stored.map((row) => row.id),
  }));
}

export async function removeApplicationFile(
  req: AuditReq,
  applicationId: string,
  fileId: string,
  reason: string
) {
  const trimmed = reason.trim();
  if (!trimmed) throw new VlbError(400, 'Say why this file is being removed.', 'validation', { reason: 'Say why this file is being removed.' });
  const files = await listApplicationFiles(applicationId, true);
  const file = files.find((row) => row.id === fileId);
  if (!file || file.deleted_at) throw new VlbError(404, 'File not found.');
  const { data, error } = await supabaseAdmin
    .from('vlb_application_files')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_reason: trimmed.slice(0, 500),
      deleted_by: req.user?.id || null,
    })
    .eq('id', fileId)
    .select('*')
    .single();
  if (error || !data) {
    logDb('remove file', error);
    throw new VlbError(500, 'Could not remove this file.');
  }
  await logAudit({
    req,
    entity: 'vlb_application_files',
    entityId: fileId,
    action: 'vlb_signed_agreement_removed',
    before: file,
    after: { id: fileId, reason: trimmed },
  });
  return presentAdminAgreementFiles(applicationId);
}

export async function sendAgreementUploadLink(
  req: AuditReq,
  applicationId: string,
  message?: string | null
) {
  const application = await loadApplication(applicationId);
  if (application.status === 'activated' || application.status === 'declined') {
    throw new VlbError(400, 'This application can no longer accept files.');
  }
  const issued = await saveUploadToken(applicationId);
  const url = uploadPageUrl(issued.token);
  if (!url) throw new VlbError(500, 'Could not create an upload link.');
  const note = (message || '').trim();
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1A1A1A;max-width:600px;margin:0 auto;">
      <h1 style="color:#FF7A19;font-size:22px;">Upload your signed Laptop Banking agreement</h1>
      <p>Hi ${escapeHtml(application.full_name || 'there')},</p>
      <p>Please download the blank agreement, sign it, and upload a clear scan or photos of every page.</p>
      ${note ? `<p>${escapeHtml(note)}</p>` : ''}
      <p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#FF7A19;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Upload your signed agreement</a></p>
      <p style="color:#666;font-size:12px;">This link is valid for 14 days.</p>
    </div>
  `;
  const sent = await emailService.sendEmail({
    to: application.email,
    subject: 'Upload your signed Laptop Banking agreement',
    html,
  }, true);
  if (!sent) console.error('vlb agreement upload link email failed');
  await logAudit({
    req,
    entity: 'vlb_applications',
    entityId: applicationId,
    action: 'vlb_agreement_upload_link_sent',
    after: { application_id: applicationId, has_message: Boolean(note) },
  });
  return { sent, expires_at: issued.expiresAt };
}

export async function signApplicationFile(applicationId: string, fileId: string) {
  const files = await listApplicationFiles(applicationId);
  const file = files.find((row) => row.id === fileId);
  if (!file) throw new VlbError(404, 'File not found.');
  return { url: await getSignedViewUrl(file.file_key) };
}

export function agreementStatusLine(files: Array<{
  created_at: string;
  uploaded_via: string;
  uploaded_by: string | null;
  uploader_name?: string | null;
}>): string {
  const live = files.filter(Boolean);
  if (live.length === 0) return 'Not uploaded yet';
  const latest = live[live.length - 1];
  const date = new Date(latest.created_at);
  const dateLabel = Number.isNaN(date.getTime())
    ? latest.created_at.slice(0, 10)
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (latest.uploaded_via === 'admin') {
    const who = latest.uploader_name || 'admin';
    return `Uploaded on ${dateLabel} by ${who}`;
  }
  return `Uploaded on ${dateLabel} by applicant`;
}

export async function copySignedAgreementToInvestor(input: {
  applicationId: string;
  investorId: string;
  investmentId: string;
  uploadedBy: string | null;
}) {
  const files = await listApplicationFiles(input.applicationId);
  const live = liveSignedAgreement(files) as ApplicationFileRow[];
  const stored = [];
  for (const [index, file] of live.entries()) {
    const ext = file.file_name.includes('.') ? file.file_name.split('.').pop() : (file.mime_type.includes('pdf') ? 'pdf' : 'jpg');
    const key = `vlb/${input.investorId}/${randomUUID()}.${ext}`;
    try {
      await copyPrivateObject(file.file_key, key, file.mime_type);
    } catch (error) {
      logDb('copy agreement to investor', error);
      throw new VlbError(500, 'Could not attach the signed agreement to this investor.');
    }
    const title = live.length === 1 ? 'Signed agreement' : `Signed agreement (${index + 1})`;
    const { data, error } = await supabaseAdmin
      .from('vlb_documents')
      .insert({
        investor_id: input.investorId,
        investment_id: input.investmentId,
        kind: 'agreement',
        title,
        r2_key: key,
        mime: file.mime_type,
        size_bytes: file.size_bytes,
        uploaded_by: input.uploadedBy,
      })
      .select('id')
      .single();
    if (error || !data) {
      logDb('insert investor agreement', error);
      throw new VlbError(500, 'Could not attach the signed agreement to this investor.');
    }
    stored.push(data.id);
  }
  await clearUploadToken(input.applicationId);
  return stored;
}
