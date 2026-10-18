-- Indexes the creation timestamps the dashboard's activity chart groups by.
--
-- The chart counts pages and chunks created in a trailing window. Without an
-- index on created_at, each request reads the whole documents table, which on
-- a large store blocks the worker for minutes. With these, the counts read only
-- the index entries inside the window.

-- @migration-step index pages.created_at
CREATE INDEX IF NOT EXISTS idx_pages_created_at ON pages(created_at);

-- @migration-step index documents.created_at
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
