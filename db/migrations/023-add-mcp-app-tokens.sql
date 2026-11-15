CREATE TABLE mcp_app_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

-- Start after any token IDs still referenced by historical statistics.
INSERT INTO sqlite_sequence (name, seq)
SELECT 'mcp_app_tokens', MAX(
  COALESCE((SELECT MAX(token_id) FROM mcp_stats), 0),
  COALESCE((SELECT MAX(token_id) FROM mcp_stats_daily), 0)
);
