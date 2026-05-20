-- =====================================================
-- Add Missing Affiliate Tables
-- =====================================================
-- Add affiliate_links, affiliate_clicks, affiliate_earnings, payout_methods, payout_requests

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 7. Affiliate Links Table (for product-specific affiliate links)
CREATE TABLE IF NOT EXISTS affiliate_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  product_id UUID NOT NULL,
  referral_code TEXT NOT NULL,
  generated_url TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_affiliate_links_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
  CONSTRAINT fk_affiliate_links_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT unique_affiliate_product_link UNIQUE (affiliate_id, product_id)
);

-- 8. Affiliate Clicks Table (for tracking individual clicks)
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  link_id UUID,
  referral_code TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  landing_page TEXT,
  source TEXT DEFAULT 'direct',
  converted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_affiliate_clicks_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
  CONSTRAINT fk_affiliate_clicks_link FOREIGN KEY (link_id) REFERENCES affiliate_links(id) ON DELETE SET NULL
);

ALTER TABLE IF EXISTS affiliate_clicks
  ADD COLUMN IF NOT EXISTS link_id UUID;

ALTER TABLE IF EXISTS affiliate_clicks
  DROP CONSTRAINT IF EXISTS fk_affiliate_clicks_link;

ALTER TABLE IF EXISTS affiliate_clicks
  ADD CONSTRAINT fk_affiliate_clicks_link FOREIGN KEY (link_id) REFERENCES affiliate_links(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS affiliate_clicks
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

ALTER TABLE IF EXISTS affiliate_links
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- 9. Affiliate Earnings Table
CREATE TABLE IF NOT EXISTS affiliate_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  order_id UUID NOT NULL,
  product_id UUID,
  product_name TEXT,
  amount NUMERIC DEFAULT 0,
  commission_rate NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_affiliate_earnings_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
  CONSTRAINT fk_affiliate_earnings_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- 10. Payout Methods Table
CREATE TABLE IF NOT EXISTS payout_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  method_type TEXT,
  account_name TEXT,
  account_number TEXT,
  provider TEXT,
  is_default BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_payout_methods_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
);

-- 11. Payout Requests Table
CREATE TABLE IF NOT EXISTS payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  payout_method_id UUID,
  method TEXT,
  reference TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_payout_requests_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
  CONSTRAINT fk_payout_requests_method FOREIGN KEY (payout_method_id) REFERENCES payout_methods(id) ON DELETE SET NULL
);

-- =====================================================
-- Indexes for Performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_affiliate_links_affiliate_id ON affiliate_links(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_product_id ON affiliate_links(product_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_referral_code ON affiliate_links(referral_code);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_created_at ON affiliate_links(created_at);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate_id ON affiliate_clicks(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_link_id ON affiliate_clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_referral_code ON affiliate_clicks(referral_code);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_created_at ON affiliate_clicks(created_at);

CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_affiliate_id ON affiliate_earnings(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_order_id ON affiliate_earnings(order_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_status ON affiliate_earnings(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_created_at ON affiliate_earnings(created_at);

CREATE INDEX IF NOT EXISTS idx_payout_methods_affiliate_id ON payout_methods(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payout_methods_method_type ON payout_methods(method_type);
CREATE INDEX IF NOT EXISTS idx_payout_methods_created_at ON payout_methods(created_at);

CREATE INDEX IF NOT EXISTS idx_payout_requests_affiliate_id ON payout_requests(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_payout_method_id ON payout_requests(payout_method_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);
CREATE INDEX IF NOT EXISTS idx_payout_requests_created_at ON payout_requests(created_at);

-- =====================================================
-- Trigger helper functions
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Triggers for Auto-Update Timestamps
-- =====================================================

DROP TRIGGER IF EXISTS trigger_update_affiliate_links_updated_at ON affiliate_links;
CREATE TRIGGER trigger_update_affiliate_links_updated_at
BEFORE UPDATE ON affiliate_links
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_affiliate_clicks_updated_at ON affiliate_clicks;
CREATE TRIGGER trigger_update_affiliate_clicks_updated_at
BEFORE UPDATE ON affiliate_clicks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_affiliate_earnings_updated_at ON affiliate_earnings;
CREATE TRIGGER trigger_update_affiliate_earnings_updated_at
BEFORE UPDATE ON affiliate_earnings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_payout_methods_updated_at ON payout_methods;
CREATE TRIGGER trigger_update_payout_methods_updated_at
BEFORE UPDATE ON payout_methods
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_payout_requests_updated_at ON payout_requests;
CREATE TRIGGER trigger_update_payout_requests_updated_at
BEFORE UPDATE ON payout_requests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Functions for Affiliate System
-- =====================================================

-- Function to increment total clicks for affiliate
CREATE OR REPLACE FUNCTION increment_total_clicks(affiliate_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE affiliates
  SET total_clicks = total_clicks + 1, updated_at = NOW()
  WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;

-- Function to increment total conversions for affiliate
CREATE OR REPLACE FUNCTION increment_total_conversions(affiliate_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE affiliates
  SET total_conversions = total_conversions + 1, updated_at = NOW()
  WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update affiliate link clicks
CREATE OR REPLACE FUNCTION increment_affiliate_link_clicks_all(referral_code_param TEXT)
RETURNS void AS $$
BEGIN
  UPDATE affiliate_links
  SET clicks = clicks + 1, updated_at = NOW()
  WHERE referral_code = referral_code_param;
END;
$$ LANGUAGE plpgsql;

-- Function to update affiliate link conversions
CREATE OR REPLACE FUNCTION increment_affiliate_link_conversions_all(referral_code_param TEXT)
RETURNS void AS $$
BEGIN
  UPDATE affiliate_links
  SET conversions = conversions + 1, updated_at = NOW()
  WHERE referral_code = referral_code_param;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Row Level Security Policies
-- =====================================================

ALTER TABLE affiliate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Affiliates can select own links" ON affiliate_links;
CREATE POLICY "Affiliates can select own links" ON affiliate_links
  FOR SELECT USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Affiliates can insert own links" ON affiliate_links;
CREATE POLICY "Affiliates can insert own links" ON affiliate_links
  FOR INSERT WITH CHECK (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Affiliates can update own links" ON affiliate_links;
CREATE POLICY "Affiliates can update own links" ON affiliate_links
  FOR UPDATE USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  ) WITH CHECK (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Affiliates can select own clicks" ON affiliate_clicks;
CREATE POLICY "Affiliates can select own clicks" ON affiliate_clicks
  FOR SELECT USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Affiliates can select own earnings" ON affiliate_earnings;
CREATE POLICY "Affiliates can select own earnings" ON affiliate_earnings
  FOR SELECT USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Affiliates can insert own payout methods" ON payout_methods;
CREATE POLICY "Affiliates can insert own payout methods" ON payout_methods
  FOR INSERT WITH CHECK (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Affiliates can select own payout methods" ON payout_methods;
CREATE POLICY "Affiliates can select own payout methods" ON payout_methods
  FOR SELECT USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Affiliates can update own payout methods" ON payout_methods;
CREATE POLICY "Affiliates can update own payout methods" ON payout_methods
  FOR UPDATE USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  ) WITH CHECK (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Affiliates can insert own payout requests" ON payout_requests;
CREATE POLICY "Affiliates can insert own payout requests" ON payout_requests
  FOR INSERT WITH CHECK (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Affiliates can select own payout requests" ON payout_requests;
CREATE POLICY "Affiliates can select own payout requests" ON payout_requests
  FOR SELECT USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Affiliates can update own payout requests" ON payout_requests;
CREATE POLICY "Affiliates can update own payout requests" ON payout_requests
  FOR UPDATE USING (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  ) WITH CHECK (
    affiliate_id = (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
