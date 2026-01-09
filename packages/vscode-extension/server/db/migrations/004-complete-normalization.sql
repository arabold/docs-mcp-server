-- Migration: Complete normalization by removing obsolete library and version columns
-- This migration finalizes the schema normalization process
-- Note: Must recreate table because obsolete columns are part of UNIQUE constraint

-- 1. Create new documents table with only foreign key references
CREATE TABLE documents_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES libraries(id),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  url TEXT NOT NULL,
  content TEXT,
  metadata JSON,
  sort_order INTEGER NOT NULL,
  indexed_at DATETIME,
  UNIQUE(url, library_id, version_id, sort_order)
);

-- 2. Copy data from old table (excluding obsolete library and version columns)
INSERT INTO documents_new (id, library_id, version_id, url, content, metadata, sort_order, indexed_at)
SELECT id, library_id, version_id, url, content, metadata, sort_order, indexed_at
FROM documents;

-- 3. Drop the old documents table
DROP TABLE documents;

-- 4. Rename the new table to documents
ALTER TABLE documents_new RENAME TO documents;

-- 5. Recreate indexes that were lost when dropping the table
CREATE INDEX IF NOT EXISTS idx_documents_library_id ON documents(library_id);
CREATE INDEX IF NOT EXISTS idx_documents_version_id ON documents(version_id);
CREATE INDEX IF NOT EXISTS idx_documents_lib_ver_id ON documents(library_id, version_id);

-- 6. Recreate FTS5 virtual table (gets dropped when main table is dropped)
-- Using external content approach - FTS index is maintained entirely through triggers
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  content,
  title,
  url,
  path,
  tokenize='porter unicode61'
);

-- 7. Recreate FTS triggers to maintain the index
-- Note: Triggers work directly with documents table, no JOIN needed for FTS content
CREATE TRIGGER IF NOT EXISTS documents_fts_after_delete AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, content, title, url, path)
  VALUES('delete', old.id, old.content, json_extract(old.metadata, '$.title'), old.url, json_extract(old.metadata, '$.path'));
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_after_update AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, content, title, url, path)
  VALUES('delete', old.id, old.content, json_extract(old.metadata, '$.title'), old.url, json_extract(old.metadata, '$.path'));
  INSERT INTO documents_fts(rowid, content, title, url, path)
  VALUES(new.id, new.content, json_extract(new.metadata, '$.title'), new.url, json_extract(new.metadata, '$.path'));
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_after_insert AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, content, title, url, path)
  VALUES(new.id, new.content, json_extract(new.metadata, '$.title'), new.url, json_extract(new.metadata, '$.path'));
END;

-- 8. Rebuild FTS index from existing documents data
-- Manually populate the FTS index since we're using external content approach
INSERT INTO documents_fts(rowid, content, title, url, path)
SELECT id, content, json_extract(metadata, '$.title'), url, json_extract(metadata, '$.path')
FROM documents;