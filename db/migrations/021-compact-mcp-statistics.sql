-- @migration-step preserve historical counters in daily aggregates
CREATE TABLE mcp_stats_daily (
  day TEXT NOT NULL,
  token_id INTEGER NOT NULL DEFAULT 0,
  token_comment TEXT NOT NULL DEFAULT '' CHECK(length(token_comment) <= 100),
  tool TEXT NOT NULL CHECK(length(tool) <= 64),
  library TEXT NOT NULL DEFAULT '' CHECK(length(library) <= 256),
  version TEXT NOT NULL DEFAULT '' CHECK(length(version) <= 64),
  protocol TEXT NOT NULL DEFAULT 'http' CHECK(protocol IN ('http', 'sse', 'stdio')),
  calls INTEGER NOT NULL,
  success_calls INTEGER NOT NULL,
  total_duration_ms INTEGER NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (day, token_id, token_comment, tool, library, version, protocol)
);

INSERT INTO mcp_stats_daily
  (day, token_id, token_comment, tool, library, calls, success_calls,
   total_duration_ms, last_used_at)
SELECT date(created_at), COALESCE(token_id, 0), substr(COALESCE(token_comment, ''), 1, 100),
       substr(tool, 1, 64), substr(COALESCE(library, ''), 1, 256), COUNT(*),
       SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END),
       SUM(MAX(0, COALESCE(duration_ms, 0))), MAX(created_at)
FROM mcp_stats
GROUP BY date(created_at), COALESCE(token_id, 0), substr(tool, 1, 64),
         substr(COALESCE(library, ''), 1, 256), substr(COALESCE(token_comment, ''), 1, 100);

-- @migration-step replace payload columns with bounded metadata
CREATE TABLE mcp_stats_compact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER,
  token_comment TEXT CHECK(length(token_comment) <= 100),
  tool TEXT NOT NULL CHECK(length(tool) <= 64),
  library TEXT CHECK(length(library) <= 256),
  version TEXT CHECK(length(version) <= 64),
  target TEXT CHECK(length(target) <= 256),
  protocol TEXT NOT NULL CHECK(protocol IN ('http', 'sse', 'stdio')),
  success INTEGER NOT NULL CHECK(success IN (0, 1)),
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mcp_stats_compact
  (id, token_id, token_comment, tool, library, protocol, success, duration_ms, created_at)
SELECT id, token_id, substr(token_comment, 1, 100), substr(tool, 1, 64),
       substr(library, 1, 256), 'http', CASE WHEN success = 1 THEN 1 ELSE 0 END,
       MAX(0, COALESCE(duration_ms, 0)), created_at
FROM mcp_stats;

DROP TABLE mcp_stats;
ALTER TABLE mcp_stats_compact RENAME TO mcp_stats;
CREATE INDEX idx_mcp_stats_created_at ON mcp_stats(created_at);
CREATE INDEX idx_mcp_stats_token_id ON mcp_stats(token_id);
CREATE INDEX idx_mcp_stats_daily_token_id ON mcp_stats_daily(token_id, day);
