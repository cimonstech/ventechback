import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../src/utils/supabaseClient';
import { jwtSecret, frontendUrl } from '../src/config/env';

async function main() {
  console.log('🔍 Starting affiliate route validation...');

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from('affiliates')
    .select('id, user_id, status')
    .eq('status', 'active')
    .limit(1)
    .single();

  if (affiliateError || !affiliate) {
    console.error('❌ No active affiliate found:', affiliateError?.message || 'none');
    process.exit(1);
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, role')
    .eq('id', affiliate.user_id)
    .single();

  if (userError || !user) {
    console.error('❌ No user found for affiliate:', userError?.message || 'none');
    process.exit(1);
  }

  const token = jwt.sign({ sub: user.id }, jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
  console.log('✅ Generated JWT for user:', user.id);

  const baseUrl = 'http://localhost:5000';
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const linksResp = await fetch(`${baseUrl}/api/affiliate/links`, { headers });
  const linksBody = await linksResp.text();
  console.log('--- GET /api/affiliate/links ---');
  console.log('Status:', linksResp.status);
  console.log(linksBody);

  if (!linksResp.ok) {
    process.exit(1);
  }

  const productListResp = await fetch(`${baseUrl}/api/affiliate/links/product`, { headers });
  const productListBody = await productListResp.text();
  console.log('--- GET /api/affiliate/links/product ---');
  console.log('Status:', productListResp.status);
  console.log(productListBody);

  if (!productListResp.ok) {
    process.exit(1);
  }

  const productResp = await supabaseAdmin
    .from('products')
    .select('id, slug')
    .gt('stock_quantity', 0)
    .limit(1)
    .single();

  if (productResp.error || !productResp.data) {
    console.error('❌ No product found:', productResp.error?.message || 'none');
    process.exit(1);
  }

  const productId = productResp.data.id;
  const generateResp = await fetch(`${baseUrl}/api/affiliate/links/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ productId }),
  });
  const generateBody = await generateResp.text();
  console.log('--- POST /api/affiliate/links/generate ---');
  console.log('Status:', generateResp.status);
  console.log(generateBody);

  if (!generateResp.ok) {
    process.exit(1);
  }

  const linked = JSON.parse(generateBody);
  const linkId = linked?.data?.id || linked?.id;

  if (!linkId) {
    console.error('❌ Could not determine generated link ID');
    process.exit(1);
  }

  const statsResp = await fetch(`${baseUrl}/api/affiliate/links/${linkId}/stats`, {
    headers,
  });
  const statsBody = await statsResp.text();
  console.log(`--- GET /api/affiliate/links/${linkId}/stats ---`);
  console.log('Status:', statsResp.status);
  console.log(statsBody);
}

main().catch((error) => {
  console.error('❌ Validation script failed:', error);
  process.exit(1);
});