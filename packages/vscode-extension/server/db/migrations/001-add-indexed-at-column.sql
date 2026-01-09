-- Add indexed_at column to track when documents were last indexed
-- Step 1: Add the column allowing NULLs (SQLite limitation workaround)
ALTER TABLE documents ADD COLUMN indexed_at DATETIME;

-- Step 2: Update existing rows to set the timestamp
UPDATE documents SET indexed_at = CURRENT_TIMESTAMP WHERE indexed_at IS NULL;
