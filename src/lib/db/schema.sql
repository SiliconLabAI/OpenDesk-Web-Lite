-- OpenDesk Web — SQLite schema

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  standing TEXT DEFAULT '',
  beats TEXT DEFAULT '',
  competitors TEXT DEFAULT '',
  spokespeople TEXT DEFAULT '',
  proof_assets TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',
  feeds TEXT NOT NULL DEFAULT '[]',
  schedule_cron TEXT NOT NULL DEFAULT '0 9 * * *',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  skill_slug TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  input TEXT DEFAULT '{}',
  output TEXT,
  output_text TEXT,
  error TEXT,
  manus_task_id TEXT,
  manus_task_url TEXT,
  manus_event_log TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS jobs_manus_task ON jobs(manus_task_id);
CREATE INDEX IF NOT EXISTS jobs_org_created ON jobs(org_id, created_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  storage_path TEXT,
  external_url TEXT,
  meta TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seen_signals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE CASCADE,
  signal_hash TEXT NOT NULL,
  headline TEXT,
  url TEXT,
  payload TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, signal_hash)
);

CREATE TABLE IF NOT EXISTS skill_drafts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  skill_slug TEXT NOT NULL,
  title TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  profile_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, skill_slug)
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS client_profiles (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT DEFAULT '',
  standing TEXT DEFAULT '',
  beats TEXT DEFAULT '',
  competitors TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  website TEXT DEFAULT '',
  payload TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  skill_slug TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  skill_slug TEXT,
  job_id TEXT,
  pending INTEGER DEFAULT 0,
  manus_task_id TEXT,
  manus_task_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages(thread_id);

CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'app',
  kind TEXT NOT NULL DEFAULT 'event',
  message TEXT NOT NULL DEFAULT '',
  request TEXT DEFAULT '{}',
  response TEXT DEFAULT '{}',
  meta TEXT DEFAULT '{}',
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS app_logs_created ON app_logs(created_at);
