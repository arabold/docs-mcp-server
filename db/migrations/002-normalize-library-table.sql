-- Migration: Normalize schema by introducing libraries table and linking documents

-- 1. Create libraries table
CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  initial_url TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_updated_at DATETIME NULL,
  last_scrape_duration_ms INTEGER NULL
);

-- 2. Add library_id to documents
ALTER TABLE documents ADD COLUMN library_id INTEGER REFERENCES libraries(id);

-- 3. Populate libraries table from existing documents
INSERT OR IGNORE INTO libraries (name)
SELECT DISTINCT library FROM documents;

-- 4. Update documents.library_id based on libraries table
UPDATE documents
SET library_id = (
  SELECT id FROM libraries WHERE libraries.name = documents.library
);

-- 5. Add index on documents.library_id
CREATE INDEX IF NOT EXISTS idx_documents_library_id ON documents(library_id);

-- Note: Handling of documents_vec and FTS triggers will be addressed in a follow-up migration.
