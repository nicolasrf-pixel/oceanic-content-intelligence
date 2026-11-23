-- Oceanic Content Intelligence 1.0
CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  country TEXT,
  editorial_profile TEXT,
  keywords TEXT NOT NULL DEFAULT '[]',          -- JSON: palabras que identifican la linea en cuentas compartidas
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  platform TEXT NOT NULL,                        -- instagram | web | rss | manual
  handle TEXT,
  url TEXT NOT NULL,
  connector TEXT NOT NULL,                       -- instagram_discovery | html_news | rss | manual
  config_json TEXT NOT NULL DEFAULT '{}',        -- lines[], listUrl, linkPattern, allowedHosts[], maxItems
  enabled INTEGER NOT NULL DEFAULT 0,
  permission_status TEXT NOT NULL DEFAULT 'unverified',
  last_checked_at TEXT,
  last_status TEXT,                              -- ok | error | needs_credentials | blocked_robots | disabled
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  account_id TEXT NOT NULL REFERENCES social_accounts(id),
  source_url TEXT NOT NULL,
  external_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT,
  original_text TEXT NOT NULL,
  original_lang TEXT,
  media_type TEXT NOT NULL DEFAULT 'none',       -- image | video | none
  media_url TEXT,
  media_r2_key TEXT,
  media_rights TEXT NOT NULL DEFAULT 'link_only',-- link_only | confirmed_by_editor
  published_at TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'new',            -- new | pending | approved | discarded | saved | irrelevant
  category TEXT,
  score INTEGER,
  priority TEXT,                                 -- alta | media | baja
  discard_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_id)
);
CREATE UNIQUE INDEX idx_pub_hash ON publications(content_hash);
CREATE INDEX idx_pub_status ON publications(status, score DESC);
CREATE INDEX idx_pub_brand ON publications(brand_id, detected_at DESC);

CREATE TABLE editorial_analyses (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  relevant INTEGER NOT NULL,
  category TEXT NOT NULL,
  score INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  flags_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT NOT NULL,                        -- anthropic | openai | heuristic
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_analysis_pub ON editorial_analyses(publication_id, created_at DESC);

CREATE TABLE generated_copies (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  copy_es_cl TEXT NOT NULL,
  hashtags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,                          -- ai | heuristic | manual
  needs_ai INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  model TEXT,
  editor_report_json TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_copies_pub ON generated_copies(publication_id, version DESC);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  copy_id TEXT,
  action TEXT NOT NULL,                          -- approve | discard | save | reset | edit | regenerate | media
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_approvals_pub ON approvals(publication_id, created_at DESC);

CREATE TABLE editorial_calendar (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  copy_id TEXT,
  planned_date TEXT NOT NULL,                    -- YYYY-MM-DD (fecha tentativa; nunca publica)
  channel TEXT NOT NULL DEFAULT 'instagram',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_calendar_date ON editorial_calendar(planned_date);

CREATE TABLE monitoring_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,                            -- run_start | run_end | account | skipped
  account_id TEXT,
  status TEXT,
  found INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mlogs_created ON monitoring_logs(created_at DESC);

CREATE TABLE agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  publication_id TEXT,
  agent TEXT NOT NULL,                           -- scout | curator | copywriter | editor | coordinator
  status TEXT NOT NULL,                          -- ok | fallback | error
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_alogs_created ON agent_logs(created_at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_ip ON login_attempts(ip, created_at);
