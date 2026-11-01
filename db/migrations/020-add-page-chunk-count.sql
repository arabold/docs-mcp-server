-- Keeps each page's chunk count on the page, so listing libraries reads pages
-- instead of every chunk.
--
-- The listing counted documents through idx_documents_sort_order for every
-- version on every call. On a store of 20 million chunks that took 94 seconds,
-- on the thread that also answers searches and runs jobs, and it ran for each
-- list_libraries call and each search naming an unknown library.

-- @migration-step add and backfill page chunk counts
ALTER TABLE pages ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0;

UPDATE pages
SET chunk_count = (SELECT COUNT(*) FROM documents d WHERE d.page_id = pages.id);

-- @migration-step keep page chunk counts current
CREATE TRIGGER pages_chunk_count_after_insert
AFTER INSERT ON documents
BEGIN
  UPDATE pages SET chunk_count = chunk_count + 1 WHERE id = NEW.page_id;
END;

CREATE TRIGGER pages_chunk_count_after_delete
AFTER DELETE ON documents
BEGIN
  UPDATE pages SET chunk_count = chunk_count - 1 WHERE id = OLD.page_id;
END;

CREATE TRIGGER pages_chunk_count_after_update
AFTER UPDATE OF page_id ON documents
WHEN OLD.page_id IS NOT NEW.page_id
BEGIN
  UPDATE pages SET chunk_count = chunk_count - 1 WHERE id = OLD.page_id;
  UPDATE pages SET chunk_count = chunk_count + 1 WHERE id = NEW.page_id;
END;

-- @migration-step index the listing's page columns
-- Covers the listing's per-version aggregate, so it never reads page rows.
CREATE INDEX IF NOT EXISTS idx_pages_version_listing
ON pages(version_id, chunk_count, created_at);
