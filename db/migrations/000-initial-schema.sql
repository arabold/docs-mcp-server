-- Initial database schema setup

-- Documents table
CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  content TEXT,
  metadata JSON,
  sort_order INTEGER NOT NULL,
  UNIQUE(url, library, version, sort_order)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_library_lower ON documents(lower(library));
CREATE INDEX IF NOT EXISTS idx_documents_version_lower ON documents(lower(library), lower(version));

-- Create Embeddings virtual table
-- Note: Dimension is hardcoded here based on the value in schema.ts at the time of creation.
-- If EMBEDDINGS_VECTOR_DIMENSION changes, a separate migration would be needed to update/recreate this table.
CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(
  library TEXT NOT NULL,
  version TEXT NOT NULL,
  embedding FLOAT[1536]
);

-- Create FTS5 virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  content,
  title,
  url,
  path,
  tokenize='porter unicode61',
  content='documents',
  content_rowid='id'
);

-- Delete trigger to maintain FTS index
CREATE TRIGGER IF NOT EXISTS documents_fts_after_delete AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, content, title, url, path)
  VALUES('delete', old.id, old.content, json_extract(old.metadata, '$.title'), old.url, json_extract(old.metadata, '$.path'));
END;

-- Update trigger to maintain FTS index
CREATE TRIGGER IF NOT EXISTS documents_fts_after_update AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, content, title, url, path)
  VALUES('delete', old.id, old.content, json_extract(old.metadata, '$.title'), old.url, json_extract(old.metadata, '$.path'));
  INSERT INTO documents_fts(rowid, content, title, url, path)
  VALUES(new.id, new.content, json_extract(new.metadata, '$.title'), new.url, json_extract(new.metadata, '$.path'));
END;

-- Insert trigger to maintain FTS index
CREATE TRIGGER IF NOT EXISTS documents_fts_after_insert AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, content, title, url, path)
  VALUES(new.id, new.content, json_extract(new.metadata, '$.title'), new.url, json_extract(new.metadata, '$.path'));
END;
