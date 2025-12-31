import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

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

class PDFService {
  private currentY: number = 0; // Track current Y position across methods

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
    try {
      // Download logo from R2 - use PNG format (PDFKit supports PNG, JPEG, GIF)
      // Construct R2 URL: Use custom domain or R2.dev format
      const r2PublicUrl = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_IMAGES_URL || process.env.IMAGES_URL;
      const r2AccountId = process.env.R2_ACCOUNT_ID;
      
      // Use direct logo URL
      const logoUrl = 'https://files.ventechgadgets.com/ventech_logo_1.png';
      
      console.log('Downloading logo from:', logoUrl);
      const logoResponse = await axios.get(logoUrl, { 
        responseType: 'arraybuffer',
        timeout: 10000, // 10 second timeout
        headers: {
          'Accept': 'image/png,image/jpeg,image/gif,*/*'
        }
      });
      const logoBuffer = Buffer.from(logoResponse.data);
      
      // Verify the file is not WebP format (check magic bytes)
      // WebP files start with: RIFF (4 bytes) + file size (4 bytes) + WEBP (4 bytes)
      const fileSignature = logoBuffer.toString('ascii', 0, 12);
      if (fileSignature.startsWith('RIFF') && fileSignature.includes('WEBP')) {
        throw new Error('WebP format detected. Please ensure the logo file is PNG format.');
      }
      
      // Check Content-Type header if available
      const contentType = logoResponse.headers['content-type'];
      if (contentType && contentType.includes('webp')) {
        throw new Error(`Content-Type indicates WebP format: ${contentType}. Please ensure the logo file is PNG format.`);
      }
      
      // Add logo image - 30% smaller (150 * 0.7 = 105)
      // PDFKit supports PNG, JPEG, GIF formats
      // Using width only to maintain aspect ratio automatically (height will scale proportionally)
      doc.image(logoBuffer, 40, 40, { width: 105 });
    } catch (error) {
      // If logo fails, use fallback
      throw error;
    }

    // Document Title - centered between logo and contact info
    const docTitle = orderData?.is_pre_order ? 'PRE-ORDER INVOICE' : 'INVOICE';
    const titleX = 40 + 105 + 20; // Logo width (105) + spacing (20)
    const titleY = 50; // Align with top of logo/contact
    const titleWidth = 380 - titleX - 20; // Space between logo and contact info
    
    doc.fontSize(18) // Reduced from 24
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text(docTitle, titleX, titleY, { width: titleWidth, align: 'center' })
       .font('Helvetica');

    // Contact information on right side
    const contactX = 380;
    doc.fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Email:', contactX, 45)
       .fontSize(8) // Reduced from 9
       .fillColor('#FF7A19')
       .text('support@ventechgadgets.com', contactX, 56, { link: 'mailto:support@ventechgadgets.com' })
       .fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Phone:', contactX, 70)
       .fontSize(8) // Reduced from 9
       .fillColor('#1A1A1A')
       .text('+233 55 134 4310', contactX, 81)
       .fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Website:', contactX, 95)
       .fontSize(8) // Reduced from 9
       .fillColor('#FF7A19')
       .text('www.ventechgadgets.com', contactX, 106, { link: 'https://www.ventechgadgets.com' });

    // Order number and date below header
    const infoY = 120; // Reduced spacing
    doc.fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Order Number: ', 40, infoY, { continued: true })
       .fontSize(9) // Reduced from 10
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text(orderData?.order_number || 'N/A')
       .font('Helvetica')
       .fontSize(8) // Reduced from 9
       .fillColor('#666666')
       .text('Order Date: ', 40, infoY + 12, { continued: true })
       .fontSize(9) // Reduced from 10
       .fillColor('#1A1A1A')
       .text(orderData ? new Date(orderData.created_at).toLocaleDateString('en-US', { 
         year: 'numeric', 
         month: 'long', 
         day: 'numeric' 
       }) : '');

    // Pre-Order Badge removed - no black rectangle

    // Decorative line separator with better styling
    const separatorY = infoY + 30; // Reduced spacing
    doc.moveTo(40, separatorY)
       .lineTo(555, separatorY)
       .lineWidth(2)
       .strokeColor('#FF7A19')
       .stroke()
       .lineWidth(1);
  }

  private addHeaderFallback(doc: any, orderData?: OrderData) {
    // Fallback to text if logo fails to load
    doc.fontSize(24)
       .fillColor('#FF7A19')
       .text('VENTECH', 50, 50)
       .fontSize(12)
       .fillColor('#3A3A3A')
       .text('Gadgets & Electronics', 50, 80);

    // Document Title
    const docTitle = orderData?.is_pre_order ? 'PRE-ORDER INVOICE' : 'ORDER INVOICE';
    doc.fontSize(18)
       .fillColor('#1A1A1A')
       .text(docTitle, 50, 120);

    // Pre-Order Badge removed - no black rectangle

    // Line separator
    const separatorY = orderData?.is_pre_order ? 170 : 150;
    doc.moveTo(50, separatorY)
       .lineTo(550, separatorY)
       .stroke('#EDEDED');
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
       .text(this.formatDeliveryDetails(orderData.shipping_address || orderData.delivery_address), 50, contentY + 95, { width: 300, lineGap: 2 }); // Reduced spacing and lineGap
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
    // Position footer at the absolute bottom of the page
    // A4 page height is 792 points, margin is 40, so bottom is at ~752
    const pageHeight = 792;
    const margin = 40;
    const footerBottomY = pageHeight - margin; // ~752
    
    // Position footer content as close to bottom as possible
    // Calculate from bottom up
    const brandingY = footerBottomY - 5; // Very bottom, just 5 points from edge
    const supportY = brandingY - 8; // 8 points above branding
    const thankYouY = supportY - 10; // 10 points above support
    const dividerY = thankYouY - 8; // 8 points above thank you message
    
    // Footer divider
    doc.moveTo(40, dividerY)
       .lineTo(555, dividerY)
       .lineWidth(1)
       .strokeColor('#E5E7EB')
       .stroke();
    
    // Thank you message
    doc.fontSize(9)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Thank you for choosing VENTECH!', 40, thankYouY, { align: 'center', width: 515 })
       .font('Helvetica');
    
    // Simple footer text
    doc.fontSize(7)
       .fillColor('#666666')
       .text('For support, please contact us using the details above.', 40, supportY, { align: 'center', width: 515 });
    
    // Watermark/branding - at the absolute bottom
    doc.fontSize(6)
       .fillColor('#CCCCCC')
       .text('VENTECH Gadgets & Electronics - Trusted for Tech in Ghana', 40, brandingY, { align: 'center', width: 515 });
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
      if (address.gadget_name) parts.push(`Gadget: ${address.gadget_name}`);
      if (address.recipient_name) parts.push(`Recipient: ${address.recipient_name}`);
      if (address.recipient_number) parts.push(`Phone: ${address.recipient_number}`);
      if (address.recipient_location) parts.push(`Location: ${address.recipient_location}`);
      if (address.recipient_region) parts.push(`Region: ${address.recipient_region}`);
      if (address.alternate_contact_number) parts.push(`Alternate: ${address.alternate_contact_number}`);
      if (address.country) parts.push(address.country);
      return parts.join('\n');
    }
    
    // Legacy structure (fallback)
    return this.formatAddress(address);
  }
}

export default new PDFService();
