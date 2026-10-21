-- ==============================================================================
-- FRONTIER AI — D1 MIGRATION: GitHub OAuth → Google OAuth
-- Run this in the Cloudflare D1 Console (copy & paste the whole block)
-- ==============================================================================

-- Step 1: Add Google auth columns to members table
ALTER TABLE members ADD COLUMN google_sub TEXT;
ALTER TABLE members ADD COLUMN email TEXT;

-- Step 2: Create index for fast Google auth lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_google_sub ON members (google_sub) WHERE google_sub IS NOT NULL;

-- Step 3: Pre-seed the Host's Google email so login works immediately
-- (google_sub will be auto-filled on first login)
UPDATE members SET email = 'kart123.san@gmail.com' WHERE id = 1;
