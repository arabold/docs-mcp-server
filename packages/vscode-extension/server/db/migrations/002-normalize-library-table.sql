-- Migration: Normalize schema by introducing libraries and versions tables

-- 1. Create libraries table
CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create versions table
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES libraries(id),
  name TEXT, -- NULL for unversioned content
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(library_id, name) -- Allows one NULL version per library
);

-- 3. Add foreign key columns to documents
ALTER TABLE documents ADD COLUMN library_id INTEGER REFERENCES libraries(id);
ALTER TABLE documents ADD COLUMN version_id INTEGER REFERENCES versions(id);

-- 4. Populate libraries table from existing documents
INSERT OR IGNORE INTO libraries (name)
SELECT DISTINCT library FROM documents;

-- 5. Populate versions table (convert empty string to NULL for unversioned)
INSERT OR IGNORE INTO versions (library_id, name)
SELECT DISTINCT 
  l.id,
  CASE WHEN d.version = '' THEN NULL ELSE d.version END
FROM documents d
JOIN libraries l ON l.name = d.library;

-- 6. Update documents with foreign key references
UPDATE documents
SET library_id = (SELECT id FROM libraries WHERE libraries.name = documents.library),
    version_id = (
      SELECT v.id FROM versions v
      JOIN libraries l ON v.library_id = l.id
      WHERE l.name = documents.library
      AND COALESCE(v.name, '') = COALESCE(documents.version, '')
    );

-- 7. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_library_id ON documents(library_id);
CREATE INDEX IF NOT EXISTS idx_documents_version_id ON documents(version_id);
CREATE INDEX IF NOT EXISTS idx_versions_library_id ON versions(library_id);

-- Note: documents_vec table and FTS triggers will be updated in subsequent migrations.
