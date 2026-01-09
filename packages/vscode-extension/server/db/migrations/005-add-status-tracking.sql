-- Migration: Add status tracking and progress monitoring to versions table
-- This migration adds job status tracking directly to the versions table
-- enabling persistent job state and progress monitoring across server restarts

-- Add job status and progress tracking columns
ALTER TABLE versions ADD COLUMN status TEXT DEFAULT 'not_indexed';
ALTER TABLE versions ADD COLUMN progress_pages INTEGER DEFAULT 0;
ALTER TABLE versions ADD COLUMN progress_max_pages INTEGER DEFAULT 0;
ALTER TABLE versions ADD COLUMN error_message TEXT;
ALTER TABLE versions ADD COLUMN started_at DATETIME;
ALTER TABLE versions ADD COLUMN updated_at DATETIME;

-- Create indexes for efficient status queries
CREATE INDEX IF NOT EXISTS idx_versions_status ON versions(status);
CREATE INDEX IF NOT EXISTS idx_versions_started_at ON versions(started_at);
CREATE INDEX IF NOT EXISTS idx_versions_library_status ON versions(library_id, status);

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS versions_updated_at
AFTER UPDATE ON versions BEGIN
  UPDATE versions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Set existing versions to 'completed' status based on whether they have documents
-- This ensures backward compatibility with existing data
UPDATE versions 
SET status = 'completed', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT DISTINCT v.id 
  FROM versions v 
  JOIN documents d ON v.id = d.version_id
);

-- Set updated_at for any remaining records without it
UPDATE versions 
SET updated_at = CURRENT_TIMESTAMP
WHERE updated_at IS NULL;

-- Note: Versions without documents remain as 'not_indexed' which is correct
-- as they were created but never successfully indexed
-- The started_at field tracks when indexing jobs begin
-- The status field provides comprehensive state tracking for version indexing
