-- Add text_color column to banners table if it doesn't exist
-- This works in PostgreSQL 9.5+

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'banners' 
        AND column_name = 'text_color'
    ) THEN
        ALTER TABLE banners ADD COLUMN text_color VARCHAR(50);
        RAISE NOTICE 'Added text_color column to banners table';
    ELSE
        RAISE NOTICE 'text_color column already exists in banners table';
    END IF;
END $$;

-- Remove default value if it exists (to allow any color to be saved)
ALTER TABLE banners ALTER COLUMN text_color DROP DEFAULT IF EXISTS;
