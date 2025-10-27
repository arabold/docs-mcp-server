-- Migration 010: Add depth column to pages table for refresh functionality
-- This enables tracking the original crawl depth of each page, which is essential
-- for maintaining consistent depth constraints during refresh operations.

-- Add depth column to pages table
ALTER TABLE pages ADD COLUMN depth INTEGER;

-- Backfill existing pages with depth 0 (conservative default)
-- This ensures all existing pages have a valid depth value
UPDATE pages SET depth = 0 WHERE depth IS NULL;
