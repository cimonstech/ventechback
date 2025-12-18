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
  async generateOrderPDF(orderData: OrderData): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        // Validate required data
        if (!orderData || !orderData.order_number) {
          throw new Error('Invalid order data: order_number is required');
        }

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
        this.addOrderItems(doc, orderData);
        
        // Order Summary
        this.addOrderSummary(doc, orderData);
        
        // Footer
        this.addFooter(doc);

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
      const logoUrl = 'https://files.ventechgadgets.com/ventech-logomain.png';
      
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
      
      // Add logo image - larger size with better positioning
      // PDFKit supports PNG, JPEG, GIF formats
      // Using width only to maintain aspect ratio automatically (height will scale proportionally)
      doc.image(logoBuffer, 40, 40, { width: 150 });
    } catch (error) {
      // If logo fails, use fallback
      throw error;
    }

    // Contact information on right side
    const contactX = 380;
    doc.fontSize(9)
       .fillColor('#666666')
       .text('Email:', contactX, 45)
       .fontSize(9)
       .fillColor('#FF7A19')
       .text('support@ventechgadgets.com', contactX, 58, { link: 'mailto:support@ventechgadgets.com' })
       .fontSize(9)
       .fillColor('#666666')
       .text('Phone:', contactX, 75)
       .fontSize(9)
       .fillColor('#1A1A1A')
       .text('+233 55 134 4310', contactX, 88)
       .fontSize(9)
       .fillColor('#666666')
       .text('Website:', contactX, 105)
       .fontSize(9)
       .fillColor('#FF7A19')
       .text('www.ventechgadgets.com', contactX, 118, { link: 'https://www.ventechgadgets.com' });

    // Document Title - positioned below logo with better spacing
    const titleY = 160;
    const docTitle = orderData?.is_pre_order ? 'PRE-ORDER INVOICE' : 'INVOICE';
    doc.fontSize(24)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text(docTitle, 40, titleY)
       .font('Helvetica');

    // Order number and date below title
    doc.fontSize(9)
       .fillColor('#666666')
       .text('Order Number: ', 40, titleY + 35, { continued: true })
       .fontSize(10)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text(orderData?.order_number || 'N/A')
       .font('Helvetica')
       .fontSize(9)
       .fillColor('#666666')
       .text('Order Date: ', 40, titleY + 50, { continued: true })
       .fontSize(10)
       .fillColor('#1A1A1A')
       .text(orderData ? new Date(orderData.created_at).toLocaleDateString('en-US', { 
         year: 'numeric', 
         month: 'long', 
         day: 'numeric' 
       }) : '');

    // Pre-Order Badge with better styling
    if (orderData?.is_pre_order) {
      doc.fontSize(9)
         .fillColor('#FFFFFF')
         .roundedRect(200, titleY + 35, 100, 22, 4)
         .fill('#000000')
         .font('Helvetica-Bold')
         .text('PRE-ORDER', 200, titleY + 40, { width: 100, align: 'center' })
         .font('Helvetica');
    }

    // Decorative line separator with better styling
    const separatorY = titleY + 75;
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

    // Pre-Order Badge
    if (orderData?.is_pre_order) {
      doc.fontSize(10)
         .fillColor('#FFFFFF')
         .roundedRect(50, 145, 120, 20, 3)
         .fill('#000000')
         .text('PRE-ORDER', 60, 150, { align: 'center', width: 100 });
    }

    // Line separator
    const separatorY = orderData?.is_pre_order ? 170 : 150;
    doc.moveTo(50, separatorY)
       .lineTo(550, separatorY)
       .stroke('#EDEDED');
  }

  private addOrderInfo(doc: any, orderData: OrderData) {
    const y = 255;
    
    // Section title with background
    doc.roundedRect(40, y, 515, 25, 3)
       .fillColor('#F8F9FA')
       .fill()
       .fontSize(12)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Order Details', 50, y + 7)
       .font('Helvetica');

    const contentY = y + 35;

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
    doc.fontSize(9)
       .fillColor('#666666')
       .text('Status:', 50, contentY)
       .fontSize(10)
       .fillColor(getStatusColor(orderData.status))
       .font('Helvetica-Bold')
       .text(orderData.status.toUpperCase(), 50, contentY + 15)
       .font('Helvetica')
       .fontSize(9)
       .fillColor('#666666')
       .text('Payment Status:', 50, contentY + 40)
       .fontSize(10)
       .fillColor(getPaymentColor(orderData.payment_status))
       .font('Helvetica-Bold')
       .text(orderData.payment_status.toUpperCase(), 50, contentY + 55)
       .font('Helvetica');

    // Right column - Pre-order info (if applicable)
    if (orderData.is_pre_order) {
      doc.fontSize(9)
         .fillColor('#666666')
         .text('Order Type:', 350, contentY)
         .fontSize(10)
         .fillColor('#1A1A1A')
         .font('Helvetica-Bold')
         .text('PRE-ORDER', 350, contentY + 15)
         .font('Helvetica');

      if (orderData.pre_order_shipping_option) {
        doc.fontSize(9)
           .fillColor('#666666')
           .text('Shipping Method:', 350, contentY + 40)
           .fontSize(10)
           .fillColor('#1A1A1A')
           .text(orderData.pre_order_shipping_option.replace('_', ' ').toUpperCase(), 350, contentY + 55, { width: 150 });
      }

      if (orderData.estimated_arrival_date) {
        const estimatedY = orderData.pre_order_shipping_option ? contentY + 80 : contentY + 40;
        doc.fontSize(9)
           .fillColor('#666666')
           .text('Estimated Arrival:', 350, estimatedY)
           .fontSize(10)
           .fillColor('#1A1A1A')
           .text(new Date(orderData.estimated_arrival_date).toLocaleDateString('en-US', {
             year: 'numeric',
             month: 'long',
             day: 'numeric'
           }), 350, estimatedY + 15, { width: 150 });
      }
    }
  }

  private addCustomerInfo(doc: any, orderData: OrderData) {
    const y = 410;
    
    // Section title with background
    doc.roundedRect(40, y, 515, 25, 3)
       .fillColor('#F8F9FA')
       .fill()
       .fontSize(12)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Customer Information', 50, y + 7)
       .font('Helvetica');

    const contentY = y + 40;

    const customerName = orderData.user 
      ? `${orderData.user.first_name || ''} ${orderData.user.last_name || ''}`.trim() || 'Unknown'
      : (orderData.shipping_address?.full_name || orderData.delivery_address?.full_name || 'Guest Customer');
    
    const customerEmail = orderData.user?.email || orderData.shipping_address?.email || orderData.delivery_address?.email || 'No email';
    const address = orderData.shipping_address || orderData.delivery_address;

    // Customer details with better formatting
    doc.fontSize(9)
       .fillColor('#666666')
       .text('Name:', 50, contentY)
       .fontSize(11)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text(customerName, 50, contentY + 14)
       .font('Helvetica')
       .fontSize(9)
       .fillColor('#666666')
       .text('Email:', 50, contentY + 38)
       .fontSize(10)
       .fillColor('#1A1A1A')
       .text(customerEmail, 50, contentY + 52)
       .fontSize(9)
       .fillColor('#666666')
       .text('Delivery Address:', 50, contentY + 76)
       .fontSize(10)
       .fillColor('#1A1A1A')
       .text(this.formatAddress(address), 50, contentY + 90, { width: 300, lineGap: 3 });
  }

  private addOrderItems(doc: any, orderData: OrderData) {
    const y = 570;
    
    // Section title with background
    doc.roundedRect(40, y, 515, 25, 3)
       .fillColor('#F8F9FA')
       .fill()
       .fontSize(12)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Order Items', 50, y + 7)
       .font('Helvetica');

    // Get order items - handle both order_items and items
    const items = orderData.order_items || (orderData as any).items || [];
    
    if (!items || items.length === 0) {
      doc.fontSize(10)
         .fillColor('#666666')
         .text('No items found', 50, y + 40);
      return;
    }

    // Table header with background
    const tableY = y + 40;
    doc.roundedRect(40, tableY, 515, 22, 0)
       .fillColor('#F8F9FA')
       .fill()
       .fontSize(9)
       .fillColor('#666666')
       .font('Helvetica-Bold')
       .text('PRODUCT', 50, tableY + 6)
       .text('QTY', 335, tableY + 6, { width: 40, align: 'center' })
       .text('UNIT PRICE', 385, tableY + 6, { width: 70, align: 'right' })
       .text('TOTAL', 475, tableY + 6, { width: 70, align: 'right' })
       .font('Helvetica');

    // Order items with alternating background
    let currentY = tableY + 30;
    items.forEach((item: any, index: number) => {
      const itemTotal = item.total_price || item.subtotal || (item.unit_price * item.quantity);
      const isPreOrderItem = item.is_pre_order || orderData.is_pre_order;
      
      // Alternating row background
      if (index % 2 === 0) {
        doc.roundedRect(40, currentY - 5, 515, 24, 0)
           .fillColor('#FAFAFA')
           .fill();
      }
      
      // Product name with pre-order badge
      doc.fontSize(10)
         .fillColor('#1A1A1A')
         .text(item.product_name || 'Unknown Product', 50, currentY, { width: 260, lineBreak: false, ellipsis: true });
      
      // Add pre-order badge if applicable
      if (isPreOrderItem) {
        doc.fontSize(7)
           .fillColor('#FFFFFF')
           .roundedRect(50, currentY + 11, 55, 11, 2)
           .fill('#000000')
           .font('Helvetica-Bold')
           .text('PRE-ORDER', 52, currentY + 13, { width: 51, align: 'center' })
           .font('Helvetica');
      }
      
      // Quantity, unit price, and total
      doc.fontSize(10)
         .fillColor('#1A1A1A')
         .text((item.quantity || 0).toString(), 335, currentY, { width: 40, align: 'center' })
         .text(`GHS ${(item.unit_price || 0).toFixed(2)}`, 385, currentY, { width: 70, align: 'right' })
         .font('Helvetica-Bold')
         .text(`GHS ${itemTotal.toFixed(2)}`, 475, currentY, { width: 70, align: 'right' })
         .font('Helvetica');
      
      currentY += 28;
    });
  }

  private addOrderSummary(doc: any, orderData: OrderData) {
    // Calculate dynamic Y position based on number of items
    const items = orderData.order_items || (orderData as any).items || [];
    const itemCount = items.length;
    const baseY = 570; // Start of items section
    const headerHeight = 65; // Section title + table header
    const itemHeight = 28; // Height per item
    const y = baseY + headerHeight + (itemCount * itemHeight) + 20;
    
    // Summary box with border
    const summaryWidth = 200;
    const summaryX = 355;
    
    doc.roundedRect(summaryX, y, summaryWidth, 100, 4)
       .lineWidth(1)
       .strokeColor('#E5E7EB')
       .stroke();

    const summaryY = y + 15;
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
      const shippingLabel = orderData.is_pre_order ? 'Shipping:' : 'Shipping:';
      summaryItems.push([shippingLabel, `GHS ${shippingFee.toFixed(2)}`]);
    }

    let currentY = summaryY;
    summaryItems.forEach(([label, value]) => {
      doc.fontSize(10)
         .fillColor('#666666')
         .text(label, summaryX + 15, currentY)
         .fillColor('#1A1A1A')
         .text(value, summaryX + 15, currentY, { width: summaryWidth - 30, align: 'right' });
      currentY += 16;
    });

    // Divider line
    doc.moveTo(summaryX + 15, currentY + 3)
       .lineTo(summaryX + summaryWidth - 15, currentY + 3)
       .lineWidth(1)
       .strokeColor('#E5E7EB')
       .stroke();

    // Total with background
    const totalY = currentY + 10;
    doc.roundedRect(summaryX + 10, totalY, summaryWidth - 20, 26, 3)
       .fillColor('#FF7A19')
       .fill()
       .fontSize(11)
       .fillColor('#FFFFFF')
       .font('Helvetica-Bold')
       .text('TOTAL:', summaryX + 20, totalY + 7)
       .text(`GHS ${orderData.total.toFixed(2)}`, summaryX + 20, totalY + 7, { width: summaryWidth - 40, align: 'right' })
       .font('Helvetica');
  }

  private addFooter(doc: any) {
    // Dynamic footer position - always at bottom of page with margin
    const y = 720;
    
    // Footer divider
    doc.moveTo(40, y - 20)
       .lineTo(555, y - 20)
       .lineWidth(1)
       .strokeColor('#E5E7EB')
       .stroke();
    
    // Thank you message
    doc.fontSize(11)
       .fillColor('#1A1A1A')
       .font('Helvetica-Bold')
       .text('Thank you for choosing VENTECH!', 40, y, { align: 'center', width: 515 })
       .font('Helvetica');
    
    // Simple footer text
    doc.fontSize(8)
       .fillColor('#666666')
       .text('For support, please contact us using the details above.', 40, y + 25, { align: 'center', width: 515 });
    
    // Watermark/branding
    doc.fontSize(7)
       .fillColor('#CCCCCC')
       .text('VENTECH Gadgets & Electronics - Trusted for Tech in Ghana', 40, y + 45, { align: 'center', width: 515 });
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
}

export default new PDFService();
