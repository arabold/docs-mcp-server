-- Migration: Add scraper options tracking to versions table
-- This migration adds scraper options storage to enable reproducible indexing
-- with the exact same parameters used in previous runs

-- Add scraper options tracking columns
ALTER TABLE versions ADD COLUMN source_url TEXT;
ALTER TABLE versions ADD COLUMN scraper_options JSON;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_versions_source_url ON versions(source_url);
CREATE INDEX IF NOT EXISTS idx_versions_scraper_options_scope 
ON versions(json_extract(scraper_options, '$.scope'));

-- Note: No data migration needed - new columns default to NULL
-- Existing versions without stored options will gracefully fallback to manual configuration
-- Future indexing operations will store complete scraper options for reproducibility
