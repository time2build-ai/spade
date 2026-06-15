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
CREATE TABLE IF NOT EXISTS task_nodes (
  task_id TEXT NOT NULL, node_id TEXT NOT NULL,
  PRIMARY KEY(task_id, node_id),
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
