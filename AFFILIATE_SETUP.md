# VENTECH Affiliate System - Setup Instructions

## ✅ Files Created

### New TypeScript Files
- [x] `src/types/affiliate.types.ts` - Type definitions for all affiliate entities
- [x] `src/services/affiliate.service.ts` - Business logic for affiliate operations
- [x] `src/middleware/affiliateTracking.middleware.ts` - Click tracking middleware
- [x] `src/controllers/affiliate.controller.ts` - Updated with dashboard endpoints

### Modified Files
- [x] `src/routes/affiliate.routes.ts` - Expanded with protected endpoints
- [x] `src/middleware/auth.middleware.ts` - Added `requireAffiliate` guard
- [x] `src/app.ts` - Added tracking middleware
- [x] `src/controllers/order.controller.ts` - Add affiliate attribution (optional)

### Database Migration
- [x] `migrations/20250301000000-create-affiliate-tables.sql` - All affiliate tables

---

## 📋 Database Setup (MANUAL STEP - DO THIS FIRST!)

1. **Open Supabase Dashboard** → SQL Editor
2. **Create New Query** and paste contents of: migrations/20250301000000-create-affiliate-tables.sql
3. **Click "Run"** to execute
4. **Verify** that all 6 tables were created:
- `affiliates`
- `referral_links`
- `earnings`
- `payouts`
- `payment_methods`
- `click_logs`

---

## 🔑 Environment Variables (Check if already set)

Your `.env` file should have: SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
FRONTEND_URL=https://ventechgadgets.com
NODE_ENV=development

---

## 🧪 Testing Endpoints

### 1. **Submit Affiliate Application** (Public)
```bash
POST /api/affiliate
Content-Type: application/json

{
  "fullName": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "country": "USA",
  "promotionChannel": "youtube",
  "platformLink": "https://youtube.com/user/johndoe",
  "audienceSize": 50000,
  "payoutMethod": "bank",
  "reason": "Want to promote VENTECH products"
}
 
2. Get Dashboard Stats (Authenticated only)
GET /api/affiliate/dashboard/stats
Authorization: Bearer {jwt-token}

3. Create Referral Link
POST /api/affiliate/links
Authorization: Bearer {jwt-token}
Content-Type: application/json

{
  "name": "YouTube Campaign Q1 2026",
  "source": "youtube"
}

4. Get Products with Commission
GET /api/affiliate/products
Authorization: Bearer {jwt-token}

5. Add Payment Method
POST /api/affiliate/payment-methods
Authorization: Bearer {jwt-token}
Content-Type: application/json

{
  "type": "bank",
  "name": "Chase Bank",
  "details": "****1234"
}


6. Request Payout
POST /api/affiliate/payouts/request
Authorization: Bearer {jwt-token}
Content-Type: application/json

{
  "amount": 100,
  "methodId": "payment-method-uuid"
}

🔗 Click Tracking Flow
1. User clicks affiliate link:
https://ventechgadgets.com?ref=AFFABC123XYZ&utm_source=youtube

Middleware intercepts:

Creates record in click_logs table
Sets affiliate_ref cookie (90 days)
Increments affiliate's total_clicks
User makes purchase:

Order creation triggers attributeEarningsForOrder()
Creates Earning record (status: pending)
Updates affiliate's pending_earnings
Marks click as converted
Increments affiliate's total_conversions
Admin approves earning:

Update earning status to 'approved' (manual in Supabase)
Move to total_earnings (cron job needed for automation)
Affiliate requests payout:

Creates Payout record (status: pending)
Must have minimum $50 available in total_earnings
🛡️ Access Control
Public Endpoints
POST /api/affiliate - Application submission (no auth required)
Protected Endpoints (Require auth + active affiliate)
GET /api/affiliate/dashboard/* - Dashboard data
GET /api/affiliate/links - View referral links
POST /api/affiliate/links - Create referral links
DELETE /api/affiliate/links/:id - Delete referral links
GET /api/affiliate/earnings* - View earnings
GET /api/affiliate/payouts - View payouts
POST /api/affiliate/payouts/request - Request payout
GET /api/affiliate/payment-methods - View payment methods
POST /api/affiliate/payment-methods - Add payment method
DELETE /api/affiliate/payment-methods/:id - Delete payment method
GET /api/affiliate/products - View products with commissions
📊 Commission Rates
Tier	Rate
Starter	8%
Pro	10%
Elite	12%
Set tier when creating affiliate in Supabase dashboard.

🐛 Troubleshooting
"Affiliate not found"
Check that user has a record in affiliates table
Verify user_id matches authenticated user
"Affiliate account is pending"
Admin must manually update status to 'active' in Supabase
Change affiliates.status from 'pending' to 'active'
Click tracking not working
Check click_logs table - should have records
Verify frontend is sending ?ref=CODE query param
Ensure middleware is registered in app.ts
Earnings not appearing
Check order_items table has correct product_id
Verify order was created with affiliate_ref cookie
Check attributeEarningsForOrder() is being called in order controller
📝 Manual Setup Steps
Create your first affiliate:

In Supabase dashboard, go to affiliates table
Insert a test record:
Test the flow:

Visit: https://frontend.com?ref=AFF12345TEST
Create order with affiliate cookie
Check earnings table for new record
Admin dashboard (future):

Create admin panel to approve earnings
Bulk update earnings status to 'approved'
Process payouts on 1st and 15th of month
🚀 Future Enhancements
 Admin dashboard for managing affiliates
 Automated earning approval (based on order status)
 Automated payout processing (scheduled job, 1st & 15th)
 Short URL generation (TinyURL/Bit.ly integration)
 Affiliate performance analytics
 Email notifications (earnings approved, payout processed)
 Dispute resolution system
 Affiliate tier upgrades (auto-upgrade based on performance)
 Referral code customization
 Multi-language support
📞 Support
For issues or questions about the affiliate system, check:

Database tables have correct schema
Migrations ran without errors
Environment variables are set
Middleware is registered in app.ts
Auth token is valid and user has affiliate account
