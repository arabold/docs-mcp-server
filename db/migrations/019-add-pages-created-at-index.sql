-- Indexes the page creation timestamps the dashboard's activity chart groups by.
--
-- The chart counts pages created in a trailing window, and the chunks of those
-- pages through idx_documents_page_id. Without this index, each request read
-- every row of pages and documents, which on a large store blocks the worker
-- for minutes.

-- @migration-step index pages.created_at
CREATE INDEX IF NOT EXISTS idx_pages_created_at ON pages(created_at);
