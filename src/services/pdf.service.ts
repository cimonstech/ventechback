import PDFDocument from 'pdfkit';
import { drawFooter, drawHeader, drawHeaderFallback, PDF_BRAND } from './pdfBrand';

interface OrderData {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  payment_status: string;
  subtotal: number;
  discount: number;
  tax: number;
  shipping_fee?: number;
  delivery_fee?: number; // Legacy support
  total: number;
  shipping_address?: any;
  delivery_address?: any; // Legacy support
  customer_bio?: {
    name: string;
    email: string;
    phone: string;
  };
  is_pre_order?: boolean;
  pre_order_shipping_option?: string;
  estimated_arrival_date?: string;
  user?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  order_items?: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price?: number;
    subtotal?: number; // Legacy support
    selected_variants?: any;
    is_pre_order?: boolean;
  }>;
  // Also support items field (for backward compatibility)
  items?: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price?: number;
    subtotal?: number;
    selected_variants?: any;
    is_pre_order?: boolean;
  }>;
}

function ghsPesewas(pesewas: number): string {
  return `GHS ${(Number(pesewas) / 100).toFixed(2)}`;
}

function monthLabel(date: string): string {
  if (!date) return '—';
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface VlbStatementPdfInput {
  investor_name: string;
  investor_no: string;
  plan_name: string;
  principal_pesewas: number;
  start_date: string;
  maturity_date: string;
  status: string;
  principal_status: string;
  remaining_payouts: number;
  payouts: Array<{
    type: string;
    term_no: number | null;
    period_no: number;
    due_date: string;
    gross_pesewas: number;
    scholar_pesewas: number;
    net_pesewas: number;
    status: string;
    paid_at: string | null;
    reference: string | null;
  }>;
  totals: {
    paid_net_pesewas: number;
    scholar_pesewas: number;
    scheduled_net_pesewas: number;
  };
}

export interface VlbConfirmationPdfInput {
  investor_name: string;
  investor_no: string;
  plan_name: string;
  principal_pesewas: number;
  start_date: string;
  maturity_date: string;
  payment_method: string | null;
  payment_reference: string | null;
  agreement_signed_at: string | null;
  principal_settlement_month: string;
  total_net_pesewas: number;
  payouts: VlbStatementPdfInput['payouts'];
}

export interface VlbPayoutReceiptPdfInput {
  receipt_no: string;
  investor_name: string;
  investor_no: string;
  plan_name: string;
  period_label: string;
  due_date: string;
  paid_at: string | null;
  gross_pesewas: number;
  scholar_pesewas: number;
  net_pesewas: number;
  method: string | null;
  reference: string | null;
}

class PDFService {
  private currentY: number = 0; // Track current Y position across methods

  private withBrandedDoc(
    title: string,
    subtitle: Array<[string, string]>,
    draw: (doc: PDFKit.PDFDocument, startY: number) => void
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        let startY = 166;
        try {
          startY = await drawHeader(doc, title, subtitle);
        } catch (error) {
          console.warn('Failed to load logo, using text fallback:', error);
          startY = drawHeaderFallback(doc, title);
        }
        draw(doc, startY);
        drawFooter(doc, doc.y);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private drawKv(doc: PDFKit.PDFDocument, lines: Array<[string, string]>) {
    doc.fontSize(11).fillColor(PDF_BRAND.body);
    for (const [label, value] of lines) {
      if (doc.y > 720) doc.addPage();
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
      doc.moveDown(0.35);
    }
  }

  private drawSummaryBox(doc: PDFKit.PDFDocument, items: Array<[string, string]>) {
    const boxX = 40;
    const boxY = doc.y;
    const boxWidth = 515;
    const rowH = 16;
    const boxHeight = 16 + items.length * rowH + 10;
    if (boxY + boxHeight > 720) {
      doc.addPage();
    }
    const y = doc.y;
    doc.roundedRect(boxX, y, boxWidth, boxHeight, 4)
      .lineWidth(1)
      .strokeColor(PDF_BRAND.line)
      .stroke();
    doc.fontSize(10).font('Helvetica-Bold').fillColor(PDF_BRAND.dark).text('Summary', boxX + 12, y + 8);
    let rowY = y + 26;
    items.forEach(([label, value]) => {
      doc.font('Helvetica').fontSize(9).fillColor(PDF_BRAND.muted).text(label, boxX + 12, rowY);
      doc.fillColor(PDF_BRAND.dark).text(value, boxX + 12, rowY, { width: boxWidth - 24, align: 'right' });
      rowY += rowH;
    });
    doc.y = y + boxHeight + 14;
  }

  private drawPayoutTable(doc: PDFKit.PDFDocument, payouts: VlbStatementPdfInput['payouts']) {
    const col = { due: 40, type: 110, period: 170, gross: 222, scholar: 292, net: 362, status: 432 };
    const drawRow = (row: string[], bold = false) => {
      if (doc.y > 720) doc.addPage();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(PDF_BRAND.body);
      doc.text(row[0], col.due, doc.y, { width: 66, continued: false });
      const y = doc.y - doc.currentLineHeight();
      doc.text(row[1], col.type, y, { width: 56 });
      doc.text(row[2], col.period, y, { width: 48 });
      doc.text(row[3], col.gross, y, { width: 66 });
      doc.text(row[4], col.scholar, y, { width: 66 });
      doc.text(row[5], col.net, y, { width: 66 });
      doc.text(row[6], col.status, y, { width: 90 });
      doc.moveDown(0.55);
    };
    drawRow(['Due', 'Type', 'Period', 'Gross', 'Scholar', 'Net', 'Status'], true);
    for (const payout of payouts) {
      drawRow([
        payout.due_date,
        payout.type,
        String(payout.period_no),
        ghsPesewas(payout.gross_pesewas),
        ghsPesewas(payout.scholar_pesewas),
        ghsPesewas(payout.net_pesewas),
        payout.status,
      ]);
    }
  }

  async generateTicketReceiptPDF(input: {
    ticket_no: string;
    laptop_model: string;
    amount: number;
    method: string;
    reference: string | null;
    paid_at: string;
    phone: string;
    email: string;
  }): Promise<Buffer> {
    return this.withBrandedDoc('SERVICE PAYMENT RECEIPT', [['Ticket', input.ticket_no]], (doc, startY) => {
      doc.y = startY;
      doc.fontSize(11).fillColor(PDF_BRAND.body);
      const lines = [
        ['Laptop', input.laptop_model],
        ['Amount', `GHS ${Number(input.amount).toFixed(2)}`],
        ['Method', input.method],
        ['Reference', input.reference || '—'],
        ['Date', new Date(input.paid_at).toLocaleString('en-GB')],
        ['Contact', `${input.email} · ${input.phone}`],
      ];
      for (const [label, value] of lines) {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value);
        doc.moveDown(0.4);
      }
    });
  }

  async generateVlbStatementPDF(input: VlbStatementPdfInput): Promise<Buffer> {
    return this.withBrandedDoc(
      'LAPTOP BANKING STATEMENT',
      [
        ['Investor', `${input.investor_name} (${input.investor_no})`],
        ['Plan', input.plan_name],
      ],
      (doc, startY) => {
        doc.y = startY;
        this.drawSummaryBox(doc, [
          ['Principal', ghsPesewas(input.principal_pesewas)],
          ['Paid to date', ghsPesewas(input.totals.paid_net_pesewas)],
          ['Scholar Fund to date', ghsPesewas(input.totals.scholar_pesewas)],
          ['Remaining payouts', String(input.remaining_payouts)],
          ['Principal status', input.principal_status],
        ]);
        this.drawKv(doc, [
          ['Start', input.start_date],
          ['Maturity', input.maturity_date],
          ['Status', input.status],
        ]);
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(PDF_BRAND.dark).text('Schedule');
        doc.moveDown(0.4);
        this.drawPayoutTable(doc, input.payouts);
        if (doc.y > 720) doc.addPage();
        doc.moveDown();
        doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_BRAND.dark);
        doc.text(`Paid so far (net): ${ghsPesewas(input.totals.paid_net_pesewas)}`);
        doc.text(`Scholar Fund deducted: ${ghsPesewas(input.totals.scholar_pesewas)}`);
        doc.text(`Remaining scheduled (net): ${ghsPesewas(input.totals.scheduled_net_pesewas)}`);
      }
    );
  }

  async generateVlbConfirmationPDF(input: VlbConfirmationPdfInput): Promise<Buffer> {
    return this.withBrandedDoc(
      'INVESTMENT CONFIRMATION',
      [
        ['Investor', `${input.investor_name} (${input.investor_no})`],
        ['Plan', input.plan_name],
      ],
      (doc, startY) => {
        doc.y = startY;
        this.drawKv(doc, [
          ['Principal', ghsPesewas(input.principal_pesewas)],
          ['Start', input.start_date],
          ['Maturity', input.maturity_date],
          ['Payment method', input.payment_method || '—'],
          ['Payment reference', input.payment_reference || '—'],
          ['Agreement signed', input.agreement_signed_at || '—'],
          ['Principal settlement month', monthLabel(input.principal_settlement_month || input.maturity_date)],
          ['Total net', ghsPesewas(input.total_net_pesewas)],
        ]);
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(PDF_BRAND.dark).text('Payout schedule');
        doc.moveDown(0.4);
        this.drawPayoutTable(doc, input.payouts);
      }
    );
  }

  async generateVlbPayoutReceiptPDF(input: VlbPayoutReceiptPdfInput): Promise<Buffer> {
    return this.withBrandedDoc(
      'PAYOUT RECEIPT',
      [
        ['Receipt', input.receipt_no],
        ['Investor', `${input.investor_name} (${input.investor_no})`],
      ],
      (doc, startY) => {
        doc.y = startY;
        this.drawKv(doc, [
          ['Plan', input.plan_name],
          ['Period', input.period_label],
          ['Due date', input.due_date],
          ['Paid date', input.paid_at ? new Date(input.paid_at).toLocaleDateString('en-GB') : '—'],
          ['Gross', ghsPesewas(input.gross_pesewas)],
          ['Scholar Fund', ghsPesewas(input.scholar_pesewas)],
          ['Net', ghsPesewas(input.net_pesewas)],
          ['Method', input.method || '—'],
          ['Reference', input.reference || '—'],
        ]);
      }
    );
  }

  async generateOrderPDF(orderData: OrderData): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        // Validate required data
        if (!orderData || !orderData.order_number) {
          throw new Error('Invalid order data: order_number is required');
        }

        // Reset Y position tracker
        this.currentY = 0;

        const doc = new PDFDocument({ 
          margin: 40,
          size: 'A4',
          bufferPages: true
        });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => {
          buffers.push(chunk);
        });

        doc.on('end', () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });

        doc.on('error', (error: Error) => {
          reject(error);
        });

        // Download logo first (async)
        try {
          await this.addHeader(doc, orderData);
        } catch (error) {
          // If header fails, continue without logo
          console.warn('Failed to load logo, using text fallback:', error);
          this.addHeaderFallback(doc, orderData);
        }
        
        // Order Information
        this.addOrderInfo(doc, orderData);
        
        // Customer Information
        this.addCustomerInfo(doc, orderData);
        
        // Order Items
        const itemsEndY = this.addOrderItems(doc, orderData);
        this.currentY = itemsEndY;
        
        // Order Summary
        const summaryEndY = this.addOrderSummary(doc, orderData);
        this.currentY = summaryEndY;
        
        // Footer
        this.addFooter(doc, this.currentY);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private async addHeader(doc: any, orderData?: OrderData) {
    const docTitle = orderData?.is_pre_order ? 'PRE-ORDER INVOICE' : 'INVOICE';
    await drawHeader(doc, docTitle, [
      ['Order Number', orderData?.order_number || 'N/A'],
      ['Order Date', orderData
        ? new Date(orderData.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : ''],
    ]);
  }

  private addHeaderFallback(doc: any, orderData?: OrderData) {
    const docTitle = orderData?.is_pre_order ? 'PRE-ORDER INVOICE' : 'ORDER INVOICE';
    drawHeaderFallback(doc, docTitle, Boolean(orderData?.is_pre_order));
  }

  private addOrderInfo(doc: any, orderData: OrderData) {
    const y = 180; // Reduced from 255
    
    // Section title with background - draw background first, then text on top
    doc.roundedRect(40, y, 515, 20, 3) // Reduced height from 25 to 20
       .fillColor('#F8F9FA')
       .fill();
    
    // Draw text on top of background
    doc.fontSize(10) // Reduced from 12
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Order Details', 50, y + 5) // Adjusted vertical position
       .font('Helvetica');

    const contentY = y + 28; // Reduced from 35

    // Status badges with colors
    const getStatusColor = (status: string) => {
      const statusLower = status.toLowerCase();
      if (statusLower === 'completed' || statusLower === 'delivered') return '#10B981';
      if (statusLower === 'pending' || statusLower === 'processing') return '#F59E0B';
      if (statusLower === 'cancelled') return '#EF4444';
      return '#6B7280';
    };

    const getPaymentColor = (status: string) => {
      const statusLower = status.toLowerCase();
      if (statusLower === 'paid' || statusLower === 'completed') return '#10B981';
      if (statusLower === 'pending') return '#F59E0B';
      if (statusLower === 'failed') return '#EF4444';
      return '#6B7280';
    };

    // Left column - Order info
    doc.fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Status:', 50, contentY)
       .fontSize(9) // Reduced from 10
       .fillColor(getStatusColor(orderData.status))
       .font('Helvetica-Bold')
       .text(orderData.status.toUpperCase(), 50, contentY + 12) // Reduced spacing
       .font('Helvetica')
       .fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Payment Status:', 50, contentY + 30) // Reduced spacing
       .fontSize(9) // Reduced from 10
       .fillColor(getPaymentColor(orderData.payment_status))
       .font('Helvetica-Bold')
       .text(orderData.payment_status.toUpperCase(), 50, contentY + 42) // Reduced spacing
       .font('Helvetica');

    // Right column - Pre-order info (if applicable)
    if (orderData.is_pre_order) {
      doc.fontSize(8) // Reduced from 9
         .fillColor('#666666')
         .text('Order Type:', 350, contentY)
         .fontSize(9) // Reduced from 10
         .fillColor('#1A1A1A')
         .font('Helvetica-Bold')
         .text('PRE-ORDER', 350, contentY + 12) // Reduced spacing
         .font('Helvetica');

      if (orderData.pre_order_shipping_option) {
        doc.fontSize(8) // Reduced from 9
           .fillColor('#666666')
           .text('Shipping Method:', 350, contentY + 30) // Reduced spacing
           .fontSize(9) // Reduced from 10
           .fillColor('#1A1A1A')
           .text(orderData.pre_order_shipping_option.replace('_', ' ').toUpperCase(), 350, contentY + 42, { width: 150 }); // Reduced spacing
      }

      if (orderData.estimated_arrival_date) {
        const estimatedY = orderData.pre_order_shipping_option ? contentY + 60 : contentY + 30; // Reduced spacing
        doc.fontSize(8) // Reduced from 9
           .fillColor('#666666')
           .text('Estimated Arrival:', 350, estimatedY)
           .fontSize(9) // Reduced from 10
           .fillColor('#1A1A1A')
           .text(new Date(orderData.estimated_arrival_date).toLocaleDateString('en-US', {
             year: 'numeric',
             month: 'long',
             day: 'numeric'
           }), 350, estimatedY + 12, { width: 150 }); // Reduced spacing
      }
    }
  }

  private addCustomerInfo(doc: any, orderData: OrderData) {
    const y = 250; // Reduced from 410
    
    // Section title with background - draw background first, then text on top
    doc.roundedRect(40, y, 515, 20, 3) // Reduced height from 25 to 20
       .fillColor('#F8F9FA')
       .fill();
    
    // Draw text on top of background
    doc.fontSize(10) // Reduced from 12
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Customer Information', 50, y + 5) // Adjusted vertical position
       .font('Helvetica');

    const contentY = y + 28; // Reduced from 40

    // Use customer_bio if available, otherwise fall back to user or shipping_address
    const customerName = orderData.customer_bio?.name 
      || (orderData.user 
        ? `${orderData.user.first_name || ''} ${orderData.user.last_name || ''}`.trim() || 'Unknown'
        : (orderData.shipping_address?.full_name || orderData.delivery_address?.full_name || 'Guest Customer'));
    
    const customerEmail = orderData.customer_bio?.email 
      || orderData.user?.email 
      || orderData.shipping_address?.email 
      || orderData.delivery_address?.email 
      || 'No email';
    
    const customerPhone = orderData.customer_bio?.phone || '';

    // Customer details with better formatting
    doc.fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Name:', 50, contentY)
       .fontSize(9) // Reduced from 11
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text(customerName, 50, contentY + 11) // Reduced spacing
       .font('Helvetica')
       .fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Email:', 50, contentY + 28) // Reduced spacing
       .fontSize(9) // Reduced from 10
       .fillColor('#1A1A1A')
       .text(customerEmail, 50, contentY + 39) // Reduced spacing
       .fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Phone:', 50, contentY + 56) // Reduced spacing
       .fontSize(9) // Reduced from 10
       .fillColor('#1A1A1A')
       .text(customerPhone || 'N/A', 50, contentY + 67) // Reduced spacing
       .fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Delivery Details:', 50, contentY + 84) // Reduced spacing
       .fontSize(9) // Reduced from 10
       .fillColor('#1A1A1A')
       .text(this.formatDeliveryDetails(orderData.shipping_address || orderData.delivery_address), 50, contentY + 95, { width: 450, lineGap: 4 }); // Increased width and lineGap for better visibility
  }

  private addOrderItems(doc: any, orderData: OrderData): number {
    const y = 360; // Reduced from 570
    
    // Section title with background - draw background first, then text on top
    doc.roundedRect(40, y, 515, 20, 3) // Reduced height from 25 to 20
       .fillColor('#F8F9FA')
       .fill();
    
    // Draw text on top of background
    doc.fontSize(10) // Reduced from 12
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Order Items', 50, y + 5) // Adjusted vertical position
       .font('Helvetica');

    // Get order items - handle both order_items and items
    const items = orderData.order_items || (orderData as any).items || [];
    
    if (!items || items.length === 0) {
      doc.fontSize(9) // Reduced from 10
         .fillColor('#666666')
         .text('No items found', 50, y + 28); // Reduced spacing
      return y + 45; // Return Y position after "No items found" message
    }

    // Table header with background - draw background first, then text on top
    const tableY = y + 28; // Reduced spacing
    doc.roundedRect(40, tableY, 515, 18, 0) // Reduced height from 22 to 18
       .fillColor('#F8F9FA')
       .fill();
    
    // Draw text on top of background
    doc.fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .font('Helvetica-Bold')
       .text('PRODUCT', 50, tableY + 5) // Adjusted vertical position
       .text('QTY', 335, tableY + 5, { width: 40, align: 'center' })
       .text('UNIT PRICE', 385, tableY + 5, { width: 70, align: 'right' })
       .text('TOTAL', 475, tableY + 5, { width: 70, align: 'right' })
       .font('Helvetica');

    // Order items with alternating background
    let currentY = tableY + 24; // Reduced spacing
    items.forEach((item: any, index: number) => {
      const itemTotal = item.total_price || item.subtotal || (item.unit_price * item.quantity);
      const isPreOrderItem = item.is_pre_order || orderData.is_pre_order;
      
      // Alternating row background - draw background first, then text on top
      if (index % 2 === 0) {
        doc.roundedRect(40, currentY - 3, 515, 20, 0) // Reduced height from 24 to 20
           .fillColor('#FAFAFA')
           .fill();
      }
      
      // Product name - no pre-order badge (removed black rectangle)
      doc.fontSize(9) // Reduced from 10
         .fillColor('#1A1A1A')
         .text(item.product_name || 'Unknown Product', 50, currentY, { width: 260, lineBreak: false, ellipsis: true });
      
      // Quantity, unit price, and total
      doc.fontSize(9) // Reduced from 10
         .fillColor('#1A1A1A')
         .text((item.quantity || 0).toString(), 335, currentY, { width: 40, align: 'center' })
         .text(`GHS ${(item.unit_price || 0).toFixed(2)}`, 385, currentY, { width: 70, align: 'right' })
         .font('Helvetica-Bold')
         .text(`GHS ${itemTotal.toFixed(2)}`, 475, currentY, { width: 70, align: 'right' })
         .font('Helvetica');
      
      currentY += 22; // Reduced from 28
    });
    
    // Return the Y position after all items
    return currentY;
  }

  private addOrderSummary(doc: any, orderData: OrderData): number {
    // Calculate dynamic Y position based on number of items
    const items = orderData.order_items || (orderData as any).items || [];
    const itemCount = items.length;
    const baseY = 360; // Start of items section (reduced from 570)
    const headerHeight = 48; // Section title + table header (reduced from 65)
    const itemHeight = 22; // Height per item (reduced from 28)
    const y = baseY + headerHeight + (itemCount * itemHeight) + 20; // Reduced spacing
    
    // No page break - everything on one page
    return this.addSummaryOnPage(doc, orderData, y);
  }

  private addSummaryOnPage(doc: any, orderData: OrderData, y: number): number {
    // Summary box with border
    const summaryWidth = 200;
    const summaryX = 355;
    
    // Calculate required height based on number of summary items
    const summaryItems: Array<[string, string]> = [];
    
    summaryItems.push(['Subtotal:', `GHS ${orderData.subtotal.toFixed(2)}`]);
    
    if (orderData.discount > 0) {
      summaryItems.push(['Discount:', `-GHS ${orderData.discount.toFixed(2)}`]);
    }
    
    if (orderData.tax > 0) {
      summaryItems.push(['Tax:', `GHS ${orderData.tax.toFixed(2)}`]);
    }
    
    const shippingFee = orderData.shipping_fee || orderData.delivery_fee || 0;
    if (shippingFee > 0) {
      const shippingLabel = orderData.is_pre_order ? 'Shipment:' : 'Delivery:';
      summaryItems.push([shippingLabel, `GHS ${shippingFee.toFixed(2)}`]);
    }

    // Calculate box height: padding (15 top + 15 bottom) + items (16 each) + divider (3) + total (26) + spacing (10)
    const boxHeight = 15 + (summaryItems.length * 16) + 3 + 26 + 10 + 15;
    
    doc.roundedRect(summaryX, y, summaryWidth, boxHeight, 4)
       .lineWidth(1)
       .strokeColor('#E5E7EB')
       .stroke();

    const summaryY = y + 15;
    let currentY = summaryY;
    
    summaryItems.forEach(([label, value]) => {
      doc.fontSize(9) // Reduced from 10
         .fillColor('#666666')
         .text(label, summaryX + 15, currentY)
         .fillColor('#1A1A1A')
         .text(value, summaryX + 15, currentY, { width: summaryWidth - 30, align: 'right' });
      currentY += 14; // Reduced from 16
    });

    // Divider line
    doc.moveTo(summaryX + 15, currentY + 3)
       .lineTo(summaryX + summaryWidth - 15, currentY + 3)
       .lineWidth(1)
       .strokeColor('#E5E7EB')
       .stroke();

    // Total with background
    const totalY = currentY + 8; // Reduced spacing
    doc.roundedRect(summaryX + 10, totalY, summaryWidth - 20, 22, 3) // Reduced height from 26 to 22
       .fillColor('#FF7A19')
       .fill()
       .fontSize(10) // Reduced from 11
       .fillColor('#FFFFFF')
       .font('Helvetica-Bold')
       .text('TOTAL:', summaryX + 20, totalY + 6) // Adjusted vertical position
       .text(`GHS ${orderData.total.toFixed(2)}`, summaryX + 20, totalY + 6, { width: summaryWidth - 40, align: 'right' })
       .font('Helvetica');
    
    // Return the Y position after the summary box
    return totalY + 30; // totalY + box height (22) + spacing (8)
  }

  private addFooter(doc: any, contentEndY: number) {
    drawFooter(doc, contentEndY);
  }

  private formatAddress(address: any): string {
    if (typeof address === 'string') return address;
    if (!address) return 'No address provided';
    
    const parts = [
      address.street_address || address.street,
      address.city,
      address.region,
      address.postal_code,
      address.country
    ].filter(Boolean);
    
    return parts.join(', ');
  }

  private formatDeliveryDetails(address: any): string {
    if (typeof address === 'string') return address;
    if (!address) return 'No delivery details provided';
    
    // New delivery structure
    if (address.gadget_name || address.recipient_name) {
      const parts: string[] = [];
      if (address.gadget_name) parts.push(`Gadget Name: ${address.gadget_name}`);
      if (address.recipient_name) parts.push(`Recipient Name: ${address.recipient_name}`);
      if (address.recipient_number) parts.push(`Recipient Number: ${address.recipient_number}`);
      if (address.recipient_location) parts.push(`Recipient Location: ${address.recipient_location}`);
      if (address.recipient_region) parts.push(`Recipient Region: ${address.recipient_region}`);
      if (address.alternate_contact_number) parts.push(`Alternate Contact: ${address.alternate_contact_number}`);
      if (address.country) parts.push(`Country: ${address.country}`);
      return parts.length > 0 ? parts.join('\n') : 'No delivery details provided';
    }
    
    // Legacy structure (fallback)
    return this.formatAddress(address);
  }
}

export default new PDFService();
