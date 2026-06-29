CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, color TEXT,
  provider TEXT DEFAULT 'claude-code', config_dir TEXT NOT NULL,
  is_default INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
  account_strategy TEXT DEFAULT 'single', rr_cursor INTEGER DEFAULT 0,
  model_ceiling TEXT, autopilot INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS project_accounts (
  project_id TEXT, account_id TEXT, position INTEGER,
  PRIMARY KEY (project_id, account_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, label TEXT, emoji TEXT, mode TEXT,
  cmd TEXT DEFAULT 'claude',
  default_model TEXT, description TEXT, instructions TEXT,
  is_system INTEGER DEFAULT 0
);
-- NOTE: sessions intentionally has NO foreign keys on project_id/account_id.
-- These are historical records that must SURVIVE deletion of an account or
-- project; we deliberately do NOT cascade-delete session history. Intentional.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project_id TEXT, account_id TEXT,
  name TEXT, role TEXT, model TEXT, mode TEXT, cwd TEXT,
  mission_id TEXT, parent TEXT, reason TEXT, status TEXT,
  is_orchestrator INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
  created_at TEXT
);
-- NOTE: missions intentionally has NO foreign key on project_id, for the same
-- reason as sessions above: mission history must SURVIVE project deletion. We
-- deliberately do NOT cascade-delete mission history. Intentional, not an oversight.
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, project_id TEXT, goal TEXT,
  autopilot INTEGER DEFAULT 0, status TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), current_project_id TEXT
);
INSERT OR IGNORE INTO app_state (id, current_project_id) VALUES (1, NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
  feature TEXT, priority INTEGER DEFAULT 2, status TEXT DEFAULT 'ready',
  origin_quote TEXT, origin_source TEXT, description TEXT, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
-- Directional/symmetric links between tasks: blocks | related | subtask.
-- "A blocks B" => B is blocked by A. "A subtask B" => A is the parent of B.
-- "related" is symmetric. CASCADE so links vanish when either task is deleted.
CREATE TABLE IF NOT EXISTS task_links (
  id TEXT PRIMARY KEY, from_task TEXT NOT NULL, to_task TEXT NOT NULL,
  rel TEXT NOT NULL, created_at TEXT,
  FOREIGN KEY(from_task) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(to_task) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS task_nodes (
  task_id TEXT NOT NULL, node_id TEXT NOT NULL,
  PRIMARY KEY(task_id, node_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
-- An append-only activity trail per task: agent stage reports, system events
-- (pipeline started / shipped), and your own manual notes.
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
  author TEXT, kind TEXT DEFAULT 'note', body TEXT NOT NULL, created_at TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS brain_nodes (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
  label TEXT NOT NULL, detail TEXT, x REAL, y REAL, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS brain_edges (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, rel TEXT,
  FOREIGN KEY(from_id) REFERENCES brain_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(to_id) REFERENCES brain_nodes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
  status TEXT DEFAULT 'queued', current_stage INTEGER DEFAULT 0, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY, pipeline_run_id TEXT NOT NULL, role TEXT NOT NULL,
  stage_order INTEGER NOT NULL, state TEXT DEFAULT 'queued',
  session_id TEXT, account_id TEXT, created_at TEXT,
  FOREIGN KEY(pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
);

-- Simple key/value app settings (string values; booleans stored as '0'/'1').
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);

-- Sprints: a project's iteration cadence. Per-sprint task counts are derived
-- from pipeline runs at read time, not stored on the row.
CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, number INTEGER NOT NULL,
  day_label TEXT, state TEXT DEFAULT 'active', started_at TEXT, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Meetings: an ingested meeting record. attendees is a JSON-encoded TEXT array;
-- outcomes/transcript are a follow-up (client-seeded for now).
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
  date TEXT, summary TEXT, attendees TEXT, transcript TEXT, source TEXT, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Feedback clusters: a themed group of user reports. sources is a JSON array of
-- {name,n,color}; verbatim quotes are a follow-up (client-seeded for now).
CREATE TABLE IF NOT EXISTS feedback_clusters (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL,
  count INTEGER DEFAULT 0, sources TEXT, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Integrations: a project's connected external services (GitHub, Intercom, ...).
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
  category TEXT, status TEXT DEFAULT 'off', usage TEXT,
  connected INTEGER DEFAULT 0, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Chat threads + messages (the /ask session browser). A message `payload` is a
-- JSON blob carrying structured tool output (cites / plan / action cards).
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT,
  pinned INTEGER DEFAULT 0, updated_at TEXT, created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT, who TEXT,
  text TEXT, payload TEXT, created_at TEXT,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);
