-- Migration: add original source MIME type tracking to pages
--
-- Existing content_type values remain as the processed/stored content type.
-- Backfill source_content_type from content_type as a best-effort approximation
-- for historical rows indexed before both values were tracked separately.

ALTER TABLE pages ADD COLUMN source_content_type TEXT;

UPDATE pages
SET source_content_type = content_type
WHERE source_content_type IS NULL;
