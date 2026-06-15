CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, label TEXT, color TEXT,
  provider TEXT DEFAULT 'claude-code', config_dir TEXT,
  is_default INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT, path TEXT,
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
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project_id TEXT, account_id TEXT,
  name TEXT, role TEXT, model TEXT, mode TEXT, cwd TEXT,
  mission_id TEXT, parent TEXT, reason TEXT, status TEXT,
  is_orchestrator INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, project_id TEXT, goal TEXT,
  autopilot INTEGER DEFAULT 0, status TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), current_project_id TEXT
);
INSERT OR IGNORE INTO app_state (id, current_project_id) VALUES (1, NULL);
