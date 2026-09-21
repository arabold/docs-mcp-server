-- Records where a page's content was actually retrieved from, when that differs
-- from the URL the page is recorded under.
--
-- A page's identity is an assertion about where it lives; the retrieval location
-- is a fact about where its bytes came from. They coincide for most pages and
-- diverge when a representation is served elsewhere — a published Markdown file
-- recorded under the page it represents, for example.
--
-- Existing rows stay NULL, meaning "retrieved from its own URL", which is true
-- of every page written before representations were resolved to a shared
-- identity. Readers coalesce NULL to `url`, so no backfill is required.

-- @migration-step add content_url to pages
ALTER TABLE pages ADD COLUMN content_url TEXT DEFAULT NULL;
