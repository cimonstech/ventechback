import axios from 'axios';

export const PDF_BRAND = {
  orange: '#FF7A19',
  dark: '#1A1A1A',
  muted: '#666666',
  body: '#3A3A3A',
  line: '#E5E7EB',
  paper: '#F8F9FA',
  logoUrl: 'https://files.ventechgadgets.com/ventech_logo_1.png',
  email: 'support@ventechgadgets.com',
  phone: '+233 55 134 4310',
  websiteLabel: 'www.ventechgadgets.com',
  websiteHref: 'https://www.ventechgadgets.com',
};

async function loadLogoBuffer(): Promise<Buffer> {
  console.log('Downloading logo from:', PDF_BRAND.logoUrl);
  const logoResponse = await axios.get(PDF_BRAND.logoUrl, {
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: {
      Accept: 'image/png,image/jpeg,image/gif,*/*',
    },
  });
  const logoBuffer = Buffer.from(logoResponse.data);

  const fileSignature = logoBuffer.toString('ascii', 0, 12);
  if (fileSignature.startsWith('RIFF') && fileSignature.includes('WEBP')) {
    throw new Error('WebP format detected. Please ensure the logo file is PNG format.');
  }

  const contentType = String(logoResponse.headers['content-type'] ?? '');
  if (contentType.includes('webp')) {
    throw new Error(`Content-Type indicates WebP format: ${contentType}. Please ensure the logo file is PNG format.`);
  }

  return logoBuffer;
}

function drawTitleAndContact(doc: PDFKit.PDFDocument, title: string) {
  const titleX = 40 + 105 + 20;
  const titleY = 50;
  const titleWidth = 380 - titleX - 20;

  doc.fontSize(18)
    .fillColor(PDF_BRAND.dark)
    .font('Helvetica-Bold')
    .text(title, titleX, titleY, { width: titleWidth, align: 'center' })
    .font('Helvetica');

  const contactX = 380;
  doc.fontSize(8)
    .fillColor(PDF_BRAND.muted)
    .text('Email:', contactX, 45)
    .fontSize(8)
    .fillColor(PDF_BRAND.orange)
    .text(PDF_BRAND.email, contactX, 56, { link: `mailto:${PDF_BRAND.email}` })
    .fontSize(8)
    .fillColor(PDF_BRAND.muted)
    .text('Phone:', contactX, 70)
    .fontSize(8)
    .fillColor(PDF_BRAND.dark)
    .text(PDF_BRAND.phone, contactX, 81)
    .fontSize(8)
    .fillColor(PDF_BRAND.muted)
    .text('Website:', contactX, 95)
    .fontSize(8)
    .fillColor(PDF_BRAND.orange)
    .text(PDF_BRAND.websiteLabel, contactX, 106, { link: PDF_BRAND.websiteHref });
}

function drawSubtitleLines(doc: PDFKit.PDFDocument, lines: Array<[string, string]>) {
  const infoY = 120;
  lines.forEach(([label, value], index) => {
    const y = infoY + index * 12;
    doc.fontSize(8)
      .fillColor(PDF_BRAND.muted)
      .text(`${label}: `, 40, y, { continued: true })
      .fontSize(9)
      .fillColor(PDF_BRAND.dark);
    if (index === 0) {
      doc.font('Helvetica-Bold').text(value).font('Helvetica');
    } else {
      doc.text(value);
    }
  });
  return infoY + 30;
}

function drawOrangeSeparator(doc: PDFKit.PDFDocument, y: number) {
  doc.moveTo(40, y)
    .lineTo(555, y)
    .lineWidth(2)
    .strokeColor(PDF_BRAND.orange)
    .stroke()
    .lineWidth(1);
}

export async function drawHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  subtitle: Array<[string, string]> = []
): Promise<number> {
  const logoBuffer = await loadLogoBuffer();
  doc.image(logoBuffer, 40, 40, { width: 105 });
  drawTitleAndContact(doc, title);
  const separatorY = drawSubtitleLines(doc, subtitle);
  drawOrangeSeparator(doc, separatorY);
  return separatorY + 16;
}

export function drawHeaderFallback(
  doc: PDFKit.PDFDocument,
  title: string,
  extraGap = false
): number {
  doc.fontSize(24)
    .fillColor(PDF_BRAND.orange)
    .text('VENTECH', 50, 50)
    .fontSize(12)
    .fillColor(PDF_BRAND.body)
    .text('Gadgets & Electronics', 50, 80);

  doc.fontSize(18)
    .fillColor(PDF_BRAND.dark)
    .text(title, 50, 120);

  const separatorY = extraGap ? 170 : 150;
  doc.moveTo(50, separatorY)
    .lineTo(550, separatorY)
    .stroke('#EDEDED');
  return separatorY + 16;
}

export function drawFooter(doc: PDFKit.PDFDocument, _contentEndY?: number) {
  const pageHeight = 792;
  const margin = 40;
  const footerBottomY = pageHeight - margin;

  const brandingY = footerBottomY - 5;
  const supportY = brandingY - 8;
  const thankYouY = supportY - 10;
  const dividerY = thankYouY - 8;

  doc.moveTo(40, dividerY)
    .lineTo(555, dividerY)
    .lineWidth(1)
    .strokeColor(PDF_BRAND.line)
    .stroke();

  doc.fontSize(9)
    .fillColor(PDF_BRAND.dark)
    .font('Helvetica-Bold')
    .text('Thank you for choosing VENTECH!', 40, thankYouY, { align: 'center', width: 515 })
    .font('Helvetica');

  doc.fontSize(7)
    .fillColor(PDF_BRAND.muted)
    .text('For support, please contact us using the details above.', 40, supportY, { align: 'center', width: 515 });

  doc.fontSize(6)
    .fillColor('#CCCCCC')
    .text('VENTECH Gadgets & Electronics - Trusted for Tech in Ghana', 40, brandingY, { align: 'center', width: 515 });
}
