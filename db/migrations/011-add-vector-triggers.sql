-- Migration: ensure documents_vec stays in sync with documents (embeddings)
-- Adds triggers to maintain vector index and backfills existing embeddings

-- 1) Backfill existing embeddings into documents_vec (idempotent)
INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
SELECT
  d.id,
  v.library_id,
  v.id AS version_id,
  json_extract(d.embedding, '$') AS embedding
FROM documents d
JOIN pages p ON d.page_id = p.id
JOIN versions v ON p.version_id = v.id
WHERE d.embedding IS NOT NULL;

-- 2) Create trigger to add vectors on insert
CREATE TRIGGER IF NOT EXISTS documents_vec_after_insert
AFTER INSERT ON documents
WHEN NEW.embedding IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
  SELECT NEW.id, v.library_id, v.id, json_extract(NEW.embedding, '$')
  FROM pages p
  JOIN versions v ON p.version_id = v.id
  WHERE p.id = NEW.page_id;
END;

-- 3) Create trigger to update vectors on embedding change
CREATE TRIGGER IF NOT EXISTS documents_vec_after_update
AFTER UPDATE OF embedding, page_id ON documents
BEGIN
  DELETE FROM documents_vec WHERE rowid = OLD.id;
  INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
  SELECT NEW.id, v.library_id, v.id, json_extract(NEW.embedding, '$')
  FROM pages p
  JOIN versions v ON p.version_id = v.id
  WHERE p.id = NEW.page_id AND NEW.embedding IS NOT NULL;
END;

-- 4) Create trigger to remove vectors on delete
CREATE TRIGGER IF NOT EXISTS documents_vec_after_delete
AFTER DELETE ON documents
BEGIN
  DELETE FROM documents_vec WHERE rowid = OLD.id;
END;
