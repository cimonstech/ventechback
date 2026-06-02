import { supabaseAdmin } from '../src/utils/supabaseClient';
import { AffiliateService } from '../src/services/affiliate.service';

const affiliateService = new AffiliateService();

async function validateAffiliateLinks() {
  console.log('🔍 Starting affiliate link validation...');

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from('affiliates')
    .select('id, referral_code, status')
    .eq('status', 'active')
    .limit(1)
    .single();

  if (affiliateError || !affiliate) {
    console.error('❌ Could not find an active affiliate account:', affiliateError?.message || 'none');
    process.exit(1);
  }

  console.log('✅ Found active affiliate:', affiliate.id, affiliate.referral_code);

  const { data: product, error: productError } = await supabaseAdmin
    .from('products')
    .select('id, slug')
    .gt('stock_quantity', 0)
    .limit(1)
    .single();

  if (productError || !product) {
    console.error('❌ Could not find an in-stock product:', productError?.message || 'none');
    process.exit(1);
  }

  console.log('✅ Found product:', product.id, product.slug);

  const link = await affiliateService.generateProductAffiliateLink(affiliate.id, product.id);
  console.log('✅ Generated affiliate link:', link);

  const { data: links, error: linksError } = await supabaseAdmin
    .from('affiliate_links')
    .select('*')
    .eq('affiliate_id', affiliate.id)
    .eq('product_id', product.id);

  if (linksError) {
    console.error('❌ Could not fetch affiliate links from database:', linksError.message);
    process.exit(1);
  }

  console.log('✅ Affiliate links records found:', links?.length || 0);
  console.log(JSON.stringify(links, null, 2));

  console.log('🎉 Affiliate link validation completed successfully.');
}

validateAffiliateLinks().catch(error => {
  console.error('❌ Validation script error:', error);
  process.exit(1);
});