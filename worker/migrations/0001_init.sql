PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, account TEXT NOT NULL, category TEXT NOT NULL,
  country TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'instagram', status TEXT NOT NULL DEFAULT 'active',
  editorial_profile TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), platform TEXT NOT NULL,
  source_url TEXT NOT NULL, acquisition_method TEXT NOT NULL, permission_status TEXT NOT NULL DEFAULT 'unverified',
  last_checked_at TEXT, enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), source_id TEXT REFERENCES sources(id),
  source_url TEXT NOT NULL, source_post_id TEXT, published_at TEXT, detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  title TEXT, original_caption TEXT, adapted_copy TEXT, content_type TEXT, relevance_score INTEGER,
  editorial_reason TEXT, media_object_key TEXT, media_rights_status TEXT DEFAULT 'link_only',
  status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, source_post_id)
);
CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL, started_at TEXT,
  finished_at TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_status_detected ON posts(status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_brand ON posts(brand_id, published_at DESC);
