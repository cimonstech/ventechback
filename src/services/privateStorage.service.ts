import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client: S3Client | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error('Private storage is not configured');
  }
  return value;
}

function storageClient(): S3Client {
  if (client) return client;
  const privateId = process.env.R2_PRIVATE_ACCESS_KEY_ID?.trim();
  const privateSecret = process.env.R2_PRIVATE_SECRET_ACCESS_KEY?.trim();
  const accessKeyId = privateId && privateSecret ? privateId : required('R2_ACCESS_KEY_ID');
  const secretAccessKey = privateId && privateSecret ? privateSecret : required('R2_SECRET_ACCESS_KEY');
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

function bucket(): string {
  return required('R2_PRIVATE_BUCKET_NAME');
}

export async function putPrivateObject(key: string, buffer: Buffer, mime: string): Promise<void> {
  await storageClient().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: buffer,
    ContentType: mime,
  }));
}

export const SIGNED_VIEW_SECONDS = 120;

export async function getSignedViewUrl(key: string, seconds = SIGNED_VIEW_SECONDS): Promise<string> {
  return getSignedUrl(
    storageClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: seconds }
  );
}

export async function deletePrivateObject(key: string): Promise<void> {
  await storageClient().send(new DeleteObjectCommand({
    Bucket: bucket(),
    Key: key,
  }));
}
