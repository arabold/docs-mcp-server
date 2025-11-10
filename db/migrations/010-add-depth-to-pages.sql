-- Migration 010: Add depth column to pages table for refresh functionality
-- This enables tracking the original crawl depth of each page, which is essential
-- for maintaining consistent depth constraints during refresh operations.

-- Add depth column to pages table
ALTER TABLE pages ADD COLUMN depth INTEGER;

-- Backfill depth based on stored scraper options
-- Depth 0: Pages whose URL exactly matches the source_url in scraper_options
-- Depth 1: All other pages (discovered during crawl)
UPDATE pages SET depth = CASE
  WHEN url = (SELECT source_url FROM versions WHERE versions.id = pages.version_id)
    THEN 0
  ELSE 1
END
WHERE depth IS NULL;
