-- =====================================================
-- Create Affiliate System Tables
-- =====================================================
-- Comprehensive affiliate marketing system for VENTECH

-- Drop existing tables if they exist (for rebuilding)
DROP TABLE IF EXISTS click_logs CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS earnings CASCADE;
DROP TABLE IF EXISTS referral_links CASCADE;
DROP TABLE IF EXISTS affiliates CASCADE;

-- 1. Affiliates Table
CREATE TABLE affiliates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE,
  referral_code VARCHAR(20) UNIQUE NOT NULL,
  tier VARCHAR(50) NOT NULL DEFAULT 'starter',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  total_earnings DECIMAL(12, 2) NOT NULL DEFAULT 0,
  pending_earnings DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  total_conversions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Referral Links Table
CREATE TABLE referral_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  short_url VARCHAR(255),
  source VARCHAR(100),
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  earnings DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_referral_links_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
);

-- 3. Earnings Table
CREATE TABLE earnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id UUID NOT NULL,
  order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  product_name VARCHAR(255),
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_earnings_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
  CONSTRAINT fk_earnings_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_earnings_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 4. Payouts Table
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id UUID NOT NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  method VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  reference VARCHAR(255),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_payouts_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
);

-- 5. Payment Methods Table
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  details TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_payment_methods_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
);

-- 6. Click Logs Table (for tracking affiliate clicks)
CREATE TABLE click_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referral_code VARCHAR(20) NOT NULL,
  ip VARCHAR(45),
  user_agent TEXT,
  source VARCHAR(100),
  converted BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- Indexes for Performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_affiliates_user_id ON affiliates(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliates_referral_code ON affiliates(referral_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates(status);

CREATE INDEX IF NOT EXISTS idx_referral_links_affiliate_id ON referral_links(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_referral_links_source ON referral_links(source);

CREATE INDEX IF NOT EXISTS idx_earnings_affiliate_id ON earnings(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_earnings_order_id ON earnings(order_id);
CREATE INDEX IF NOT EXISTS idx_earnings_status ON earnings(status);
CREATE INDEX IF NOT EXISTS idx_earnings_created_at ON earnings(created_at);

CREATE INDEX IF NOT EXISTS idx_payouts_affiliate_id ON payouts(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON payouts(created_at);

CREATE INDEX IF NOT EXISTS idx_payment_methods_affiliate_id ON payment_methods(affiliate_id);

CREATE INDEX IF NOT EXISTS idx_click_logs_referral_code ON click_logs(referral_code);
CREATE INDEX IF NOT EXISTS idx_click_logs_converted ON click_logs(converted);
CREATE INDEX IF NOT EXISTS idx_click_logs_created_at ON click_logs(created_at);

-- =====================================================
-- Triggers for Auto-Update Timestamps
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for all affiliate tables
CREATE TRIGGER trigger_update_affiliates_updated_at
BEFORE UPDATE ON affiliates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_referral_links_updated_at
BEFORE UPDATE ON referral_links
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_earnings_updated_at
BEFORE UPDATE ON earnings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_payouts_updated_at
BEFORE UPDATE ON payouts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_payment_methods_updated_at
BEFORE UPDATE ON payment_methods
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_click_logs_updated_at
BEFORE UPDATE ON click_logs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Helper Functions for RPC Calls
-- =====================================================

-- Increment total clicks
CREATE OR REPLACE FUNCTION increment_total_clicks(affiliate_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE affiliates SET total_clicks = total_clicks + 1 WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;

-- Increment total conversions
CREATE OR REPLACE FUNCTION increment_total_conversions(affiliate_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE affiliates SET total_conversions = total_conversions + 1 WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;

-- Increment pending earnings
CREATE OR REPLACE FUNCTION increment_pending_earnings(affiliate_id UUID, amount DECIMAL)
RETURNS void AS $$
BEGIN
  UPDATE affiliates SET pending_earnings = pending_earnings + amount WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Helper Functions for RPC Calls
-- =====================================================

-- Increment total clicks
CREATE OR REPLACE FUNCTION increment_total_clicks(affiliate_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE affiliates SET total_clicks = total_clicks + 1 WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;

-- Increment total conversions
CREATE OR REPLACE FUNCTION increment_total_conversions(affiliate_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE affiliates SET total_conversions = total_conversions + 1 WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;

-- Increment pending earnings
CREATE OR REPLACE FUNCTION increment_pending_earnings(affiliate_id UUID, amount DECIMAL)
RETURNS void AS $$
BEGIN
  UPDATE affiliates SET pending_earnings = pending_earnings + amount WHERE id = affiliate_id;
END;
$$ LANGUAGE plpgsql;