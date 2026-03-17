-- Migration: Create metadata table for tracking global configuration state.
-- Used to persist the active embedding model and vector dimension so the system
-- can detect configuration changes between startups and prevent silent data corruption.
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
