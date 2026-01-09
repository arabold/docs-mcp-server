-- Migration 007: Deduplicate unversioned versions
-- Goal: collapse multiple NULL-name version rows per library to a single canonical row
-- Steps:
-- 1. For each library, choose canonical NULL-name row:
--    a) Prefer a row referenced by any documents (highest document count)
--    b) Fallback to lowest id
-- 2. Repoint any documents referencing non-canonical NULL rows to canonical
-- 3. Delete surplus NULL-name rows with zero documents
-- 4. Convert remaining NULL names to empty string '' for future uniqueness enforcement
-- Safe to run multiple times (idempotent)

-- 1 & 2: Repoint documents
-- Use TEMP tables instead of CTEs because we need the canonical mapping
-- across multiple subsequent statements. All TEMP objects are connection-scoped
-- and vanish automatically; safe for repeated runs (we DROP IF EXISTS first).

DROP TABLE IF EXISTS temp_null_versions;
CREATE TEMP TABLE temp_null_versions AS
SELECT v.id, v.library_id,
       (SELECT COUNT(*) FROM documents d WHERE d.version_id = v.id) AS doc_count
FROM versions v
WHERE v.name IS NULL;

-- Build canonical mapping per library (one row per library_id)
DROP TABLE IF EXISTS temp_canonical_versions;
CREATE TEMP TABLE temp_canonical_versions AS
SELECT nv.library_id,
       COALESCE(
         (
           SELECT id FROM temp_null_versions nv2
           WHERE nv2.library_id = nv.library_id AND nv2.doc_count > 0
           ORDER BY nv2.doc_count DESC, nv2.id ASC LIMIT 1
         ),
         (
           SELECT id FROM temp_null_versions nv3
           WHERE nv3.library_id = nv.library_id
           ORDER BY nv3.id ASC LIMIT 1
         )
       ) AS keep_id
FROM temp_null_versions nv
GROUP BY nv.library_id;

-- Repoint documents from non-canonical NULL-name versions
UPDATE documents
SET version_id = (
  SELECT keep_id FROM temp_canonical_versions c
  WHERE c.library_id = documents.library_id
)
WHERE version_id IN (SELECT id FROM versions WHERE name IS NULL)
  AND version_id NOT IN (SELECT keep_id FROM temp_canonical_versions);

-- 3: Delete surplus NULL-name rows now unreferenced
DELETE FROM versions
WHERE name IS NULL
  AND id NOT IN (SELECT keep_id FROM temp_canonical_versions)
  AND (SELECT COUNT(*) FROM documents d WHERE d.version_id = versions.id) = 0;

-- 4: Normalize remaining NULL names to ''
UPDATE versions SET name = '' WHERE name IS NULL;

-- (Optional) Unique index already exists if schema defined; if not, we could add:
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_library_name ON versions(library_id, name);
