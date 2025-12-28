-- Migration: Add key_specs column to products table
-- This column stores an array of key specifications with labels and colors
-- Format: [{"label": "8GB RAM", "color": "#9333ea"}, {"label": "512GB SSD", "color": "#2563eb"}]

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS key_specs JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN products.key_specs IS 'Array of key specifications with label and color. Max 6 items. Format: [{"label": "string", "color": "hex_color"}]';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_products_key_specs ON products USING GIN (key_specs);

