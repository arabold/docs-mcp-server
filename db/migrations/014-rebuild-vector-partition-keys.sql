-- Migration: rebuild documents_vec with sqlite-vec partition keys
-- This enables selective KNN queries by library_id and version_id.

-- Preserve compatible vectors from the existing vec table. This uses a
-- disk-backed staging table because large vector indexes can exceed memory.
DROP TABLE IF EXISTS _documents_vec_partition_migration;

CREATE TABLE _documents_vec_partition_migration AS
SELECT
  d.id AS rowid,
  v.library_id,
  v.id AS version_id,
  dv.embedding
FROM documents_vec dv
JOIN documents d ON dv.rowid = d.id
JOIN pages p ON d.page_id = p.id
JOIN versions v ON p.version_id = v.id
WHERE vec_length(dv.embedding) = 1536;

DROP TABLE documents_vec;

CREATE VIRTUAL TABLE documents_vec USING vec0(
  library_id INTEGER partition key,
  version_id INTEGER partition key,
  embedding FLOAT[1536]
);

INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
SELECT rowid, library_id, version_id, embedding
FROM _documents_vec_partition_migration;

-- Backfill any vectors stored on documents but missing from the vec table.
INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
SELECT
  d.id,
  v.library_id,
  v.id AS version_id,
  json_extract(d.embedding, '$') AS embedding
FROM documents d
JOIN pages p ON d.page_id = p.id
JOIN versions v ON p.version_id = v.id
WHERE d.embedding IS NOT NULL
  AND vec_length(json_extract(d.embedding, '$')) = 1536
  AND NOT EXISTS (
    SELECT 1 FROM documents_vec existing WHERE existing.rowid = d.id
  );

DROP TABLE _documents_vec_partition_migration;
