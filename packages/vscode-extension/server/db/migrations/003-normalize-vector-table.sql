-- Migration: Normalize documents_vec table to use library_id and version_id
-- Optimized for large datasets (1GB+)

-- 1. Ensure optimal indexes for the migration JOIN
CREATE INDEX IF NOT EXISTS idx_documents_id_lib_ver ON documents(id, library_id, version_id);

-- 2. Create temporary table to store vector data with foreign key IDs
CREATE TEMPORARY TABLE temp_vector_migration AS
SELECT 
  dv.rowid,
  d.library_id,
  d.version_id,
  dv.embedding
FROM documents_vec dv
JOIN documents d ON dv.rowid = d.id;

-- 3. Drop the old virtual table
DROP TABLE documents_vec;

-- 4. Create new virtual table with normalized schema
CREATE VIRTUAL TABLE documents_vec USING vec0(
  library_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  embedding FLOAT[1536]
);

-- 5. Restore vector data using foreign key IDs
INSERT INTO documents_vec (rowid, library_id, version_id, embedding)
SELECT rowid, library_id, version_id, embedding
FROM temp_vector_migration;

-- 6. Clean up temporary table
DROP TABLE temp_vector_migration;
