export type DetectedTicketFile = {
  mime: string;
  ext: string;
  group: 'image' | 'video' | 'pdf';
};

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['heif', 'heim', 'heis', 'mif1', 'msf1']);
const MP4_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'mp4v', 'M4V ', 'dash', 'MSNV']);

function brands(buffer: Buffer): string[] {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return [];
  const found = [buffer.toString('ascii', 8, 12)];
  for (let index = 16; index + 4 <= Math.min(buffer.length, 64); index += 4) {
    found.push(buffer.toString('ascii', index, index + 4));
  }
  return found;
}

export function detectTicketFile(buffer: Buffer): DetectedTicketFile | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg', group: 'image' };
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer.toString('ascii', 1, 4) === 'PNG'
  ) {
    return { mime: 'image/png', ext: 'png', group: 'image' };
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp', group: 'image' };
  }
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf', group: 'pdf' };
  }

  const found = brands(buffer);
  if (!found.length) return null;
  if (found.some((brand) => HEIC_BRANDS.has(brand))) {
    return { mime: 'image/heic', ext: 'heic', group: 'image' };
  }
  if (found.some((brand) => HEIF_BRANDS.has(brand))) {
    return { mime: 'image/heif', ext: 'heif', group: 'image' };
  }
  if (found.some((brand) => brand.startsWith('qt'))) {
    return { mime: 'video/quicktime', ext: 'mov', group: 'video' };
  }
  if (found.some((brand) => MP4_BRANDS.has(brand))) {
    return { mime: 'video/mp4', ext: 'mp4', group: 'video' };
  }
  return null;
}

const IMAGE_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 50 * 1024 * 1024;

export function uploadKind(
  detected: DetectedTicketFile,
  requestedKind: string,
  size: number
): { kind: 'image' | 'video' | 'receipt' } | { error: string } {
  const receipt = requestedKind === 'receipt';
  if (receipt) {
    if (detected.group === 'video') return { error: 'A receipt must be an image or a PDF.' };
    if (size > IMAGE_LIMIT) return { error: 'Receipts must be 10 MB or smaller.' };
    return { kind: 'receipt' };
  }
  if (detected.group === 'pdf') return { error: 'PDF files can only be uploaded as a receipt.' };
  if (detected.group === 'video') {
    if (size > VIDEO_LIMIT) return { error: 'Videos must be 50 MB or smaller.' };
    return { kind: 'video' };
  }
  if (size > IMAGE_LIMIT) return { error: 'Images must be 10 MB or smaller.' };
  return { kind: 'image' };
}
