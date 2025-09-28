-- Migration: Add pages table to normalize page-level metadata and support Etag tracking
-- This migration introduces a pages table to store page-level metadata once per URL
-- and links document chunks to their parent pages via page_id foreign key

-- 1. Create pages table to store unique page-level metadata
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES versions(id),
  url TEXT NOT NULL,
  title TEXT,
  etag TEXT,
  last_modified TEXT,
  content_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_id, url)
);

-- 2. Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_pages_version_id ON pages(version_id);
CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
CREATE INDEX IF NOT EXISTS idx_pages_etag ON pages(etag);

-- 3. Create new documents table with page_id foreign key
CREATE TABLE documents_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id),
  content TEXT,
  metadata JSON, -- Now contains only chunk-specific metadata (level, path)
  sort_order INTEGER NOT NULL,
  embedding BLOB, -- Store embeddings directly in documents table
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create indexes for the new documents table
CREATE INDEX IF NOT EXISTS idx_documents_page_id ON documents_new(page_id);
CREATE INDEX IF NOT EXISTS idx_documents_sort_order ON documents_new(page_id, sort_order);

-- 5. Migrate data from old documents table to new structure
-- First, populate pages table with unique page data from existing documents
-- Group by version_id and url to ensure uniqueness, using MAX() to handle any duplicates
INSERT INTO pages (version_id, url, title, created_at, updated_at)
SELECT
  version_id,
  url,
  MAX(json_extract(metadata, '$.title')) as title,
  MAX(COALESCE(indexed_at, CURRENT_TIMESTAMP)) as created_at,
  MAX(COALESCE(indexed_at, CURRENT_TIMESTAMP)) as updated_at
FROM documents
GROUP BY version_id, url;

-- 6. Migrate document chunks to new table structure
-- Preserve all existing metadata except page-level fields (url, title, library, version)
-- that are now stored in pages and versions tables
INSERT INTO documents_new (id, page_id, content, metadata, sort_order, created_at)
SELECT 
  d.id,
  p.id as page_id,
  d.content,
  json_remove(
    json_remove(
      json_remove(
        json_remove(d.metadata, '$.url'),
        '$.title'
      ),
      '$.library'
    ),
    '$.version'
  ) as metadata,
  d.sort_order,
  COALESCE(d.indexed_at, CURRENT_TIMESTAMP)
FROM documents d
JOIN pages p ON d.version_id = p.version_id AND d.url = p.url;

-- 7. Drop the old documents table
DROP TABLE documents;

-- 8. Rename the new table to documents
ALTER TABLE documents_new RENAME TO documents;

-- 9. Recreate FTS5 virtual table to work with new structure
-- Drop existing FTS table and triggers
DROP TRIGGER IF EXISTS documents_fts_after_delete;
DROP TRIGGER IF EXISTS documents_fts_after_update; 
DROP TRIGGER IF EXISTS documents_fts_after_insert;
DROP TABLE IF EXISTS documents_fts;

-- Create new FTS table
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  content,
  title,
  url,
  path,
  tokenize='porter unicode61'
);

-- 10. Create new FTS triggers that join with pages table
CREATE TRIGGER IF NOT EXISTS documents_fts_after_delete AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_after_update AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
  INSERT INTO documents_fts(rowid, content, title, url, path)
  SELECT new.id, new.content, p.title, p.url, json_extract(new.metadata, '$.path')
  FROM pages p WHERE p.id = new.page_id;
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_after_insert AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, content, title, url, path)
  SELECT new.id, new.content, p.title, p.url, json_extract(new.metadata, '$.path')
  FROM pages p WHERE p.id = new.page_id;
END;

-- 11. Create trigger to update pages.updated_at when page title changes
CREATE TRIGGER IF NOT EXISTS pages_updated_at_trigger AFTER UPDATE ON pages BEGIN
  UPDATE pages SET updated_at = CURRENT_TIMESTAMP WHERE id = new.id;
END;

-- 12. Rebuild FTS index from migrated data
INSERT INTO documents_fts(rowid, content, title, url, path)
SELECT d.id, d.content, p.title, p.url, json_extract(d.metadata, '$.path')
FROM documents d
JOIN pages p ON d.page_id = p.id;
