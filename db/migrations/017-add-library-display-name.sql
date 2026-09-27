-- Migration: add a required, case-preserving display name to libraries
-- `name` stays the lookup key (trimmed, lowercased). `display_name` is filled here for every row and is
-- NOT NULL, so no reader ever falls back to `name`. SQLite cannot ADD COLUMN ... NOT NULL without a
-- default, so the table is rebuilt. Foreign keys are enabled on this connection, and `versions`
-- references `libraries(id)`, so the parent rows are re-inserted after the DROP under deferred
-- foreign-key checks; renaming a pre-filled copy into place would fail at commit.

-- @migration-step rebuild libraries
-- Library records without versions are never listed and hold no documentation, but their name would
-- still block creating that library. Nothing references them.
DELETE FROM libraries WHERE id NOT IN (SELECT library_id FROM versions);

-- The characters JavaScript's String.prototype.trim() removes, which the lookup key trims: tab, LF, VT,
-- FF, CR, space, NBSP, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and the BOM.
DROP TABLE IF EXISTS _libraries_017_whitespace;
CREATE TEMP TABLE _libraries_017_whitespace AS SELECT char(
  9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
  8232, 8233, 8239, 8287, 12288, 65279
) AS chars;

-- Older releases stored names untrimmed, so a padded key such as ' react ' is unreachable by the trimmed
-- lookup key. Re-key it unless another row already trims to the same key; such a collision is left as it
-- is. The count is over trimmed names, which re-keying does not change, so the result does not depend on
-- the order in which rows are updated.
UPDATE libraries
SET name = trim(name, (SELECT chars FROM _libraries_017_whitespace))
WHERE name <> trim(name, (SELECT chars FROM _libraries_017_whitespace))
  AND (
    SELECT COUNT(*) FROM libraries AS other
    WHERE trim(other.name, (SELECT chars FROM _libraries_017_whitespace))
      = trim(libraries.name, (SELECT chars FROM _libraries_017_whitespace))
  ) = 1;

PRAGMA defer_foreign_keys = ON;

DROP TABLE IF EXISTS _libraries_017_rows;
DROP TABLE IF EXISTS _libraries_017_sequence;
CREATE TEMP TABLE _libraries_017_rows AS SELECT id, name, created_at FROM libraries;
CREATE TEMP TABLE _libraries_017_sequence AS
  SELECT seq FROM sqlite_sequence WHERE name = 'libraries';

DROP TABLE libraries;

CREATE TABLE libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO libraries (id, name, display_name, created_at)
SELECT id, name, trim(name, (SELECT chars FROM _libraries_017_whitespace)), created_at
FROM _libraries_017_rows;

-- Dropping the table reset its AUTOINCREMENT counter to MAX(id); restore it so the ids of deleted
-- libraries are never reused.
DELETE FROM sqlite_sequence WHERE name = 'libraries';
INSERT INTO sqlite_sequence (name, seq) SELECT 'libraries', seq FROM _libraries_017_sequence;

-- @migration-step recreate index
CREATE UNIQUE INDEX idx_libraries_lower_name ON libraries(LOWER(name));

DROP TABLE _libraries_017_rows;
DROP TABLE _libraries_017_sequence;
DROP TABLE _libraries_017_whitespace;

-- The runner applies every pending migration in one transaction; later migrations must check foreign
-- keys immediately again.
PRAGMA defer_foreign_keys = OFF;
