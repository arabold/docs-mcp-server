-- Stores document embeddings as float32 blobs instead of JSON text.
--
-- JSON text took 3-5x the space of the binary vector (about 20-32 KB per chunk
-- at 1536 dimensions versus 6 KB), on top of the binary copy in documents_vec.
-- sqlite-vec accepts both forms, so the vector triggers pass the blob through.
--
-- The full-text update trigger is narrowed first: it fired on every column,
-- so converting embeddings would have rewritten the whole full-text index.

-- @migration-step scope full-text update trigger
-- Only content, metadata (path) and page_id (title, url) feed documents_fts.
DROP TRIGGER IF EXISTS documents_fts_after_update;

CREATE TRIGGER documents_fts_after_update
AFTER UPDATE OF content, metadata, page_id ON documents
BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
  INSERT INTO documents_fts(rowid, content, title, url, path)
  SELECT new.id, new.content, p.title, p.url, json_extract(new.metadata, '$.path')
  FROM pages p WHERE p.id = new.page_id;
END;

-- @migration-step convert embeddings to float32 blobs
-- The vector triggers are dropped so the conversion does not rewrite
-- documents_vec, which already holds the same vectors in binary form.
-- Every stored value already went through sqlite-vec's parser when it was
-- written (the triggers below, and the backfill in 011), so vec_f32 accepts it.
DROP TRIGGER IF EXISTS documents_vec_after_insert;
DROP TRIGGER IF EXISTS documents_vec_after_update;

UPDATE documents
SET embedding = vec_f32(embedding)
WHERE typeof(embedding) = 'text';

-- @migration-step recreate vector triggers
CREATE TRIGGER documents_vec_after_insert
AFTER INSERT ON documents
WHEN NEW.embedding IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
  SELECT NEW.id, v.library_id, v.id, NEW.embedding
  FROM pages p
  JOIN versions v ON p.version_id = v.id
  WHERE p.id = NEW.page_id;
END;

CREATE TRIGGER documents_vec_after_update
AFTER UPDATE OF embedding, page_id ON documents
BEGIN
  DELETE FROM documents_vec WHERE rowid = OLD.id;
  INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
  SELECT NEW.id, v.library_id, v.id, NEW.embedding
  FROM pages p
  JOIN versions v ON p.version_id = v.id
  WHERE p.id = NEW.page_id AND NEW.embedding IS NOT NULL;
END;
