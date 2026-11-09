-- Adds the index the dashboard's activity chart needs and drops indexes that
-- only cost space and write time.
--
-- The chart counts pages created in a trailing window, and the chunks of those
-- pages through idx_documents_sort_order. Without an index on created_at, each
-- request read every row of pages and documents, which on a large store blocks
-- the worker for minutes.
--
-- Every index dropped here is either the leading column of a wider index on
-- the same table, which SQLite uses in its place, or one no query filters or
-- sorts on. Each insert into documents, the largest and most written table,
-- updates one index fewer.

-- @migration-step index pages.created_at
CREATE INDEX IF NOT EXISTS idx_pages_created_at ON pages(created_at);

-- @migration-step drop indexes a wider index covers
-- idx_documents_sort_order is (page_id, sort_order).
DROP INDEX IF EXISTS idx_documents_page_id;
-- UNIQUE(version_id, url) on pages.
DROP INDEX IF EXISTS idx_pages_version_id;
-- UNIQUE(library_id, name) on versions.
DROP INDEX IF EXISTS idx_versions_library_id;

-- @migration-step drop indexes no query uses
DROP INDEX IF EXISTS idx_pages_url;
DROP INDEX IF EXISTS idx_pages_etag;
DROP INDEX IF EXISTS idx_versions_library_status;
DROP INDEX IF EXISTS idx_versions_started_at;
DROP INDEX IF EXISTS idx_versions_scraper_options_scope;
