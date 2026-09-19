-- Records how many pages of a version produced stored content, alongside the
-- existing processed and total counters.
--
-- Existing rows default to NULL rather than 0: a job written before this column
-- existed does not know how many of its pages produced content, and 0 would
-- assert that it produced none. Consumers render NULL as unknown, and the value
-- is populated the next time that version is indexed.

-- @migration-step add progress_pages_indexed to versions
ALTER TABLE versions ADD COLUMN progress_pages_indexed INTEGER DEFAULT NULL;
