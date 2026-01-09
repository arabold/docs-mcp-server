-- We only need to normalize existing strings to lower-case and add expression unique indexes
-- for defense-in-depth. Idempotent: LOWER(name) is stable on re-run.

UPDATE libraries SET name = LOWER(name);
UPDATE versions SET name = LOWER(name) WHERE name IS NOT NULL AND name <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_libraries_lower_name ON libraries(LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_library_lower_name ON versions(library_id, LOWER(name));

-- Existing UNIQUE(library_id, name) plus these expression indexes enforce case-insensitive uniqueness.
