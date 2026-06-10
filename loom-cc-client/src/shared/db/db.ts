import Database from 'better-sqlite3'
import { getDbPath, getLegacyAbmomDbPath } from './paths'
import { migrateFromAbmom } from './migrations'
import { logger } from '@/shared/logging/logger'

declare const globalThis: {
  __loomDb?: Database.Database
  __loomDbMigratedVersion?: number
} & typeof global

/** Schema version — bump when adding new tables/columns */
const SCHEMA_VERSION = 16

export const GLOBAL_CHAT_PROJECT_ID = '__global_chat__'

function shouldMigrateLegacyAbmomDb(): boolean {
  return process.env.LOOM_MIGRATE_LEGACY_ABMOM === '1'
}

function applySchema(db: Database.Database) {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    -- ── Core product model ──────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS projects (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      workspace_path  TEXT NOT NULL,
      claude_dir      TEXT NOT NULL DEFAULT '',
      default_model   TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      is_pinned       INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'deleted')),
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_opened_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_projects_pinned     ON projects(is_pinned DESC, last_opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_updated    ON projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      id                    TEXT PRIMARY KEY,
      project_id            TEXT NOT NULL,
      title                 TEXT NOT NULL DEFAULT 'New Session',
      model                 TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      runtime_session_id    TEXT,
      runtime_provider_id   TEXT NOT NULL DEFAULT '',
      runtime_model_id      TEXT NOT NULL DEFAULT '',
      status                TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'archived', 'deleted')),
      context_version       INTEGER NOT NULL DEFAULT 0,
      compact_summary       TEXT,
      workspace_path        TEXT,
      attached_folder_paths TEXT,
      use_worktree          INTEGER NOT NULL DEFAULT 0,
      runtime_target        TEXT NOT NULL DEFAULT 'local',
      worktree_path         TEXT,
      worktree_branch       TEXT,
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_message_at       TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project        ON sessions(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_message   ON sessions(last_message_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      context_version INTEGER NOT NULL DEFAULT 0,
      role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content         TEXT NOT NULL,
      elapsed_seconds INTEGER NOT NULL DEFAULT 0,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      sdk_context_usage TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, context_version, created_at);

    -- ── Skills layer ────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS skills (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      slug         TEXT NOT NULL UNIQUE,
      description  TEXT NOT NULL DEFAULT '',
      source_type  TEXT NOT NULL DEFAULT 'project'
                     CHECK (source_type IN ('builtin', 'global', 'project', 'session')),
      storage_path TEXT NOT NULL DEFAULT '',
      version      TEXT NOT NULL DEFAULT '0.1.0',
      is_pinned    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS project_skills (
      project_id  TEXT NOT NULL,
      skill_id    TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, skill_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id)   REFERENCES skills(id)   ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_skills (
      session_id  TEXT NOT NULL,
      skill_id    TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      source      TEXT NOT NULL DEFAULT 'project',
      PRIMARY KEY (session_id, skill_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id)   REFERENCES skills(id)   ON DELETE CASCADE
    );

    -- ── Session context tracking ────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS session_boundaries (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT NOT NULL,
      boundary_type           TEXT NOT NULL
                                CHECK (boundary_type IN ('clear', 'compact', 'manual')),
      from_runtime_session_id TEXT,
      to_runtime_session_id   TEXT,
      summary                 TEXT,
      compact_source          TEXT NOT NULL DEFAULT 'loom',
      metadata                TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_boundaries_session ON session_boundaries(session_id, created_at);

    -- ── Scheduled tasks ────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      name            TEXT NOT NULL,
      schedule        TEXT NOT NULL,
      prompt          TEXT NOT NULL DEFAULT '',
      agent_name      TEXT NOT NULL DEFAULT '',
      model           TEXT NOT NULL DEFAULT '',
      enabled         INTEGER NOT NULL DEFAULT 1,
      last_run_at     TEXT,
      last_run_result TEXT,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project ON scheduled_tasks(project_id, enabled);

    CREATE TABLE IF NOT EXISTS task_executions (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      session_id  TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
      result      TEXT NOT NULL DEFAULT '',
      executed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_executions_task ON task_executions(task_id, executed_at DESC);

    -- ── App & project settings ──────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS project_settings (
      project_id TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      PRIMARY KEY (project_id, key),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_jobs (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      project_id        TEXT NOT NULL DEFAULT '',
      workspace_path    TEXT NOT NULL DEFAULT '',
      reason            TEXT NOT NULL,
      context_version   INTEGER NOT NULL DEFAULT 0,
      message_hash      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'done', 'failed', 'skipped')),
      candidate_count   INTEGER NOT NULL DEFAULT 0,
      error             TEXT NOT NULL DEFAULT '',
      started_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      completed_at      TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_jobs_unique
      ON memory_jobs(session_id, reason, context_version, message_hash);

    CREATE INDEX IF NOT EXISTS idx_memory_jobs_session
      ON memory_jobs(session_id, started_at DESC);

    -- ── Memory evolution layer ─────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS evolution_events (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL DEFAULT '',
      session_id       TEXT NOT NULL DEFAULT '',
      workspace_path   TEXT NOT NULL DEFAULT '',
      event_type       TEXT NOT NULL,
      trigger          TEXT NOT NULL DEFAULT '',
      entity_type      TEXT NOT NULL DEFAULT '',
      entity_id        TEXT NOT NULL DEFAULT '',
      summary          TEXT NOT NULL DEFAULT '',
      payload          TEXT NOT NULL DEFAULT '',
      rollback_payload TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_evolution_events_project
      ON evolution_events(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_evolution_events_workspace
      ON evolution_events(workspace_path, created_at DESC);

    CREATE TABLE IF NOT EXISTS skill_runs (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL DEFAULT '',
      session_id      TEXT NOT NULL DEFAULT '',
      workspace_path  TEXT NOT NULL DEFAULT '',
      skill_name      TEXT NOT NULL,
      trigger         TEXT NOT NULL DEFAULT '',
      input_hash      TEXT NOT NULL DEFAULT '',
      input_summary   TEXT NOT NULL DEFAULT '',
      output_summary  TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'done', 'failed', 'skipped')),
      token_estimate  INTEGER NOT NULL DEFAULT 0,
      error           TEXT NOT NULL DEFAULT '',
      started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      completed_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_skill_runs_project
      ON skill_runs(project_id, started_at DESC);

    -- ── IM bridge ───────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS im_channels (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL DEFAULT 'feishu'
                         CHECK (type IN ('feishu')),
      project_id       TEXT NOT NULL DEFAULT '',
      enabled          INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'not_configured'
                         CHECK (status IN ('connected', 'connecting', 'disconnected', 'not_configured', 'error')),
      credentials      TEXT NOT NULL DEFAULT '{}',
      dm_policy        TEXT NOT NULL DEFAULT 'open'
                         CHECK (dm_policy IN ('open', 'allowlist', 'disabled')),
      group_policy     TEXT NOT NULL DEFAULT 'mention'
                         CHECK (group_policy IN ('mention', 'open', 'allowlist', 'disabled')),
      trigger_mode     TEXT NOT NULL DEFAULT 'mention'
                         CHECK (trigger_mode IN ('mention', 'all')),
      sender_whitelist TEXT NOT NULL DEFAULT '[]',
      group_whitelist  TEXT NOT NULL DEFAULT '[]',
      default_project_id TEXT NOT NULL DEFAULT '',
      default_model    TEXT NOT NULL DEFAULT '',
      permission_mode  TEXT NOT NULL DEFAULT 'confirm'
                         CHECK (permission_mode IN ('confirm', 'read-only', 'full')),
      last_connected_at TEXT,
      last_error       TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `)
  // Existing v12 databases created before project-scoped channels need this
  // column before the project/type index can be created.
  try { db.exec(`ALTER TABLE im_channels ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_im_channels_project_type
      ON im_channels(project_id, type)
      WHERE project_id != '';

    CREATE TABLE IF NOT EXISTS im_channel_bindings (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      chat_name   TEXT NOT NULL DEFAULT '',
      project_id  TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(channel_id, chat_id),
      FOREIGN KEY (channel_id) REFERENCES im_channels(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_im_bindings_project ON im_channel_bindings(project_id);
    CREATE INDEX IF NOT EXISTS idx_im_bindings_session ON im_channel_bindings(session_id);

    CREATE TABLE IF NOT EXISTS im_message_dedupe (
      message_key TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS im_audit_logs (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL DEFAULT '',
      chat_id     TEXT NOT NULL DEFAULT '',
      project_id  TEXT NOT NULL DEFAULT '',
      session_id  TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'ok',
      details     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_im_audit_logs_time ON im_audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS im_permission_requests (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      sender_id   TEXT NOT NULL DEFAULT '',
      session_id  TEXT NOT NULL DEFAULT '',
      tool_name   TEXT NOT NULL DEFAULT '',
      tool_input  TEXT NOT NULL DEFAULT '{}',
      status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'allowed', 'denied', 'timeout')),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_im_permission_requests_status ON im_permission_requests(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL CHECK (scope IN ('session', 'project')),
      scope_id   TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT '',
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_events_scope
      ON runtime_events(scope, scope_id, id);

    CREATE INDEX IF NOT EXISTS idx_runtime_events_created
      ON runtime_events(created_at);

    CREATE TABLE IF NOT EXISTS project_rules (
      id                       TEXT PRIMARY KEY,
      project_id               TEXT NOT NULL DEFAULT '',
      workspace_path           TEXT NOT NULL DEFAULT '',
      title                    TEXT NOT NULL,
      rule                     TEXT NOT NULL,
      rationale                TEXT NOT NULL DEFAULT '',
      scope                    TEXT NOT NULL DEFAULT 'project'
                               CHECK (scope IN ('project', 'module', 'workflow', 'global')),
      priority                 TEXT NOT NULL DEFAULT 'medium'
                               CHECK (priority IN ('low', 'medium', 'high', 'critical')),
      impact                   TEXT NOT NULL DEFAULT 'medium'
                               CHECK (impact IN ('low', 'medium', 'high')),
      risk                     TEXT NOT NULL DEFAULT 'medium'
                               CHECK (risk IN ('low', 'medium', 'high')),
      status                   TEXT NOT NULL DEFAULT 'candidate'
                               CHECK (status IN ('candidate', 'shadow', 'active', 'paused', 'deprecated', 'superseded')),
      evidence_ids             TEXT NOT NULL DEFAULT '[]',
      promoted_from_ids        TEXT NOT NULL DEFAULT '[]',
      conflicts_with           TEXT NOT NULL DEFAULT '[]',
      supersedes               TEXT NOT NULL DEFAULT '[]',
      confidence               REAL NOT NULL DEFAULT 0,
      strength                 REAL NOT NULL DEFAULT 0,
      occurrences              INTEGER NOT NULL DEFAULT 0,
      applied_count            INTEGER NOT NULL DEFAULT 0,
      success_count            INTEGER NOT NULL DEFAULT 0,
      conflict_count           INTEGER NOT NULL DEFAULT 0,
      negative_evidence_count  INTEGER NOT NULL DEFAULT 0,
      stale_score              REAL NOT NULL DEFAULT 0,
      token_impact             INTEGER NOT NULL DEFAULT 0,
      user_confirmed           INTEGER NOT NULL DEFAULT 0,
      needs_user_confirmation  INTEGER NOT NULL DEFAULT 0,
      created_by_skill         TEXT NOT NULL DEFAULT '',
      created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_applied_at          TEXT,
      last_reinforced_at       TEXT,
      expires_at               TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_project_rules_project
      ON project_rules(project_id, status, priority);

    CREATE INDEX IF NOT EXISTS idx_project_rules_workspace
      ON project_rules(workspace_path, status, priority);

    CREATE TABLE IF NOT EXISTS rule_applications (
      id             TEXT PRIMARY KEY,
      rule_id        TEXT NOT NULL,
      project_id     TEXT NOT NULL DEFAULT '',
      session_id     TEXT NOT NULL DEFAULT '',
      trigger        TEXT NOT NULL DEFAULT '',
      task_summary   TEXT NOT NULL DEFAULT '',
      outcome        TEXT NOT NULL DEFAULT 'observed'
                     CHECK (outcome IN ('observed', 'success', 'conflict', 'ignored')),
      token_impact   INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (rule_id) REFERENCES project_rules(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rule_applications_rule
      ON rule_applications(rule_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rule_conflicts (
      id              TEXT PRIMARY KEY,
      rule_id         TEXT NOT NULL,
      conflicting_id  TEXT NOT NULL DEFAULT '',
      project_id      TEXT NOT NULL DEFAULT '',
      summary         TEXT NOT NULL DEFAULT '',
      severity        TEXT NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low', 'medium', 'high')),
      status          TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved', 'ignored')),
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      resolved_at     TEXT,
      FOREIGN KEY (rule_id) REFERENCES project_rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_operations (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL DEFAULT '',
      session_id      TEXT NOT NULL DEFAULT '',
      workspace_path  TEXT NOT NULL DEFAULT '',
      operation       TEXT NOT NULL,
      memory_type     TEXT NOT NULL DEFAULT '',
      candidate_id    TEXT NOT NULL DEFAULT '',
      target_path     TEXT NOT NULL DEFAULT '',
      summary         TEXT NOT NULL DEFAULT '',
      payload         TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    -- ── Four-layer memory model ─────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS fact_records (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL DEFAULT '',
      session_id      TEXT NOT NULL DEFAULT '',
      workspace_path  TEXT NOT NULL DEFAULT '',
      source_type     TEXT NOT NULL DEFAULT 'message',
      source_id       TEXT NOT NULL DEFAULT '',
      kind            TEXT NOT NULL DEFAULT 'message',
      role            TEXT NOT NULL DEFAULT '',
      content         TEXT NOT NULL DEFAULT '',
      content_hash    TEXT NOT NULL DEFAULT '',
      metadata        TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_records_hash
      ON fact_records(project_id, session_id, source_type, content_hash);

    CREATE INDEX IF NOT EXISTS idx_fact_records_project
      ON fact_records(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS session_observations (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL DEFAULT '',
      session_id       TEXT NOT NULL DEFAULT '',
      workspace_path   TEXT NOT NULL DEFAULT '',
      observation_key  TEXT NOT NULL DEFAULT '',
      category         TEXT NOT NULL DEFAULT 'general',
      content          TEXT NOT NULL DEFAULT '',
      confidence       REAL NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'promoted', 'archived', 'rejected')),
      evidence_ids     TEXT NOT NULL DEFAULT '[]',
      source_trigger   TEXT NOT NULL DEFAULT '',
      expires_at       TEXT,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_session_observations_project
      ON session_observations(project_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_session_observations_key
      ON session_observations(project_id, observation_key, status);

    CREATE TABLE IF NOT EXISTS semantic_memories (
      id                       TEXT PRIMARY KEY,
      project_id               TEXT NOT NULL DEFAULT '',
      workspace_path           TEXT NOT NULL DEFAULT '',
      memory_key               TEXT NOT NULL DEFAULT '',
      title                    TEXT NOT NULL DEFAULT '',
      content                  TEXT NOT NULL DEFAULT '',
      category                 TEXT NOT NULL DEFAULT 'general',
      status                   TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('candidate', 'active', 'stale', 'archived', 'rejected')),
      confidence               REAL NOT NULL DEFAULT 0,
      strength                 REAL NOT NULL DEFAULT 0,
      occurrences              INTEGER NOT NULL DEFAULT 0,
      evidence_ids             TEXT NOT NULL DEFAULT '[]',
      source_observation_ids   TEXT NOT NULL DEFAULT '[]',
      negative_evidence_count  INTEGER NOT NULL DEFAULT 0,
      confirmed_by_user        INTEGER NOT NULL DEFAULT 0,
      stale_score              REAL NOT NULL DEFAULT 0,
      last_reinforced_at       TEXT,
      expires_at               TEXT,
      created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_memories_key
      ON semantic_memories(project_id, memory_key);

    CREATE INDEX IF NOT EXISTS idx_semantic_memories_project
      ON semantic_memories(project_id, status, strength DESC);

    CREATE TABLE IF NOT EXISTS project_dossiers (
      id                         TEXT PRIMARY KEY,
      project_id                 TEXT NOT NULL DEFAULT '',
      workspace_path             TEXT NOT NULL DEFAULT '',
      version                    INTEGER NOT NULL DEFAULT 1,
      summary                    TEXT NOT NULL DEFAULT '',
      current_goal               TEXT NOT NULL DEFAULT '',
      user_preferences           TEXT NOT NULL DEFAULT '',
      stable_rules               TEXT NOT NULL DEFAULT '',
      recent_risks               TEXT NOT NULL DEFAULT '',
      repeated_issues            TEXT NOT NULL DEFAULT '',
      deprecated_understanding   TEXT NOT NULL DEFAULT '',
      next_steps                 TEXT NOT NULL DEFAULT '',
      source                     TEXT NOT NULL DEFAULT 'deterministic',
      token_budget_chars         INTEGER NOT NULL DEFAULT 1200,
      created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_project_dossiers_project
      ON project_dossiers(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS negative_priors (
      id                  TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL DEFAULT '',
      workspace_path      TEXT NOT NULL DEFAULT '',
      prior_key           TEXT NOT NULL DEFAULT '',
      content             TEXT NOT NULL DEFAULT '',
      source_entity_type  TEXT NOT NULL DEFAULT '',
      source_entity_id    TEXT NOT NULL DEFAULT '',
      strength            REAL NOT NULL DEFAULT 1,
      expires_at          TEXT,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_negative_priors_project
      ON negative_priors(project_id, prior_key, created_at DESC);

    -- ── Image generation jobs ───────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS image_generation_jobs (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'merging', 'submitting', 'waiting', 'success', 'error')),
      provider_id     TEXT NOT NULL DEFAULT '',
      model           TEXT NOT NULL DEFAULT '',
      prompt          TEXT NOT NULL DEFAULT '',
      final_prompt    TEXT NOT NULL DEFAULT '',
      aspect_ratio    TEXT NOT NULL DEFAULT '1:1',
      style_id        TEXT NOT NULL DEFAULT 'none',
      size            TEXT NOT NULL DEFAULT '1024x1024',
      count           INTEGER NOT NULL DEFAULT 1,
      reference_images TEXT NOT NULL DEFAULT '[]',
      result_urls     TEXT NOT NULL DEFAULT '[]',
      result_metadata TEXT NOT NULL DEFAULT '{}',
      error_message   TEXT NOT NULL DEFAULT '',
      started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      completed_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_session
      ON image_generation_jobs(session_id, started_at DESC);
  `)

  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

function runIncrementalMigrations(db: Database.Database) {
  // v2: project description
  try { db.exec(`ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  // v3: scheduled_tasks description + skill_name
  try { db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN skill_name TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN agent_name TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  // v4: per-session workspace override
  try { db.exec(`ALTER TABLE sessions ADD COLUMN workspace_path TEXT`) } catch { /* already exists */ }
  // v5: standalone Chat primary workspace + extra context folders
  try { db.exec(`ALTER TABLE sessions ADD COLUMN attached_folder_paths TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 0`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN runtime_target TEXT NOT NULL DEFAULT 'local'`) } catch { /* already exists */ }
  // v6: provider/model used by the current SDK runtime session
  try { db.exec(`ALTER TABLE sessions ADD COLUMN runtime_provider_id TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN runtime_model_id TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  // v7: background memory extraction status + dedupe
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_jobs (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      project_id        TEXT NOT NULL DEFAULT '',
      workspace_path    TEXT NOT NULL DEFAULT '',
      reason            TEXT NOT NULL,
      context_version   INTEGER NOT NULL DEFAULT 0,
      message_hash      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'done', 'failed', 'skipped')),
      candidate_count   INTEGER NOT NULL DEFAULT 0,
      error             TEXT NOT NULL DEFAULT '',
      started_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      completed_at      TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_jobs_unique
      ON memory_jobs(session_id, reason, context_version, message_hash);

    CREATE INDEX IF NOT EXISTS idx_memory_jobs_session
      ON memory_jobs(session_id, started_at DESC);
  `)
  // v8: distinguish SDK-managed compact from Loom fallback compact.
  try { db.exec(`ALTER TABLE session_boundaries ADD COLUMN compact_source TEXT NOT NULL DEFAULT 'loom'`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE session_boundaries ADD COLUMN metadata TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  // v9: persist SDK-reported context window usage per assistant turn.
  try { db.exec(`ALTER TABLE messages ADD COLUMN sdk_context_usage TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }
  // v10: memory evolution state, project rules, skill runs, and audit trail.
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_events (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL DEFAULT '',
      session_id       TEXT NOT NULL DEFAULT '',
      workspace_path   TEXT NOT NULL DEFAULT '',
      event_type       TEXT NOT NULL,
      trigger          TEXT NOT NULL DEFAULT '',
      entity_type      TEXT NOT NULL DEFAULT '',
      entity_id        TEXT NOT NULL DEFAULT '',
      summary          TEXT NOT NULL DEFAULT '',
      payload          TEXT NOT NULL DEFAULT '',
      rollback_payload TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_evolution_events_project
      ON evolution_events(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_evolution_events_workspace
      ON evolution_events(workspace_path, created_at DESC);

    CREATE TABLE IF NOT EXISTS skill_runs (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL DEFAULT '',
      session_id      TEXT NOT NULL DEFAULT '',
      workspace_path  TEXT NOT NULL DEFAULT '',
      skill_name      TEXT NOT NULL,
      trigger         TEXT NOT NULL DEFAULT '',
      input_hash      TEXT NOT NULL DEFAULT '',
      input_summary   TEXT NOT NULL DEFAULT '',
      output_summary  TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'done', 'failed', 'skipped')),
      token_estimate  INTEGER NOT NULL DEFAULT 0,
      error           TEXT NOT NULL DEFAULT '',
      started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      completed_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_skill_runs_project
      ON skill_runs(project_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS project_rules (
      id                       TEXT PRIMARY KEY,
      project_id               TEXT NOT NULL DEFAULT '',
      workspace_path           TEXT NOT NULL DEFAULT '',
      title                    TEXT NOT NULL,
      rule                     TEXT NOT NULL,
      rationale                TEXT NOT NULL DEFAULT '',
      scope                    TEXT NOT NULL DEFAULT 'project'
                               CHECK (scope IN ('project', 'module', 'workflow', 'global')),
      priority                 TEXT NOT NULL DEFAULT 'medium'
                               CHECK (priority IN ('low', 'medium', 'high', 'critical')),
      impact                   TEXT NOT NULL DEFAULT 'medium'
                               CHECK (impact IN ('low', 'medium', 'high')),
      risk                     TEXT NOT NULL DEFAULT 'medium'
                               CHECK (risk IN ('low', 'medium', 'high')),
      status                   TEXT NOT NULL DEFAULT 'candidate'
                               CHECK (status IN ('candidate', 'shadow', 'active', 'paused', 'deprecated', 'superseded')),
      evidence_ids             TEXT NOT NULL DEFAULT '[]',
      promoted_from_ids        TEXT NOT NULL DEFAULT '[]',
      conflicts_with           TEXT NOT NULL DEFAULT '[]',
      supersedes               TEXT NOT NULL DEFAULT '[]',
      confidence               REAL NOT NULL DEFAULT 0,
      applied_count            INTEGER NOT NULL DEFAULT 0,
      success_count            INTEGER NOT NULL DEFAULT 0,
      conflict_count           INTEGER NOT NULL DEFAULT 0,
      token_impact             INTEGER NOT NULL DEFAULT 0,
      user_confirmed           INTEGER NOT NULL DEFAULT 0,
      needs_user_confirmation  INTEGER NOT NULL DEFAULT 0,
      created_by_skill         TEXT NOT NULL DEFAULT '',
      created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_applied_at          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_project_rules_project
      ON project_rules(project_id, status, priority);

    CREATE INDEX IF NOT EXISTS idx_project_rules_workspace
      ON project_rules(workspace_path, status, priority);

    CREATE TABLE IF NOT EXISTS rule_applications (
      id             TEXT PRIMARY KEY,
      rule_id        TEXT NOT NULL,
      project_id     TEXT NOT NULL DEFAULT '',
      session_id     TEXT NOT NULL DEFAULT '',
      trigger        TEXT NOT NULL DEFAULT '',
      task_summary   TEXT NOT NULL DEFAULT '',
      outcome        TEXT NOT NULL DEFAULT 'observed'
                     CHECK (outcome IN ('observed', 'success', 'conflict', 'ignored')),
      token_impact   INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (rule_id) REFERENCES project_rules(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rule_applications_rule
      ON rule_applications(rule_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rule_conflicts (
      id              TEXT PRIMARY KEY,
      rule_id         TEXT NOT NULL,
      conflicting_id  TEXT NOT NULL DEFAULT '',
      project_id      TEXT NOT NULL DEFAULT '',
      summary         TEXT NOT NULL DEFAULT '',
      severity        TEXT NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low', 'medium', 'high')),
      status          TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved', 'ignored')),
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      resolved_at     TEXT,
      FOREIGN KEY (rule_id) REFERENCES project_rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_operations (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL DEFAULT '',
      session_id      TEXT NOT NULL DEFAULT '',
      workspace_path  TEXT NOT NULL DEFAULT '',
      operation       TEXT NOT NULL,
      memory_type     TEXT NOT NULL DEFAULT '',
      candidate_id    TEXT NOT NULL DEFAULT '',
      target_path     TEXT NOT NULL DEFAULT '',
      summary         TEXT NOT NULL DEFAULT '',
      payload         TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `)
  // v11: four-layer memory model, semantic lifecycle, and negative priors.
  try { db.exec(`ALTER TABLE project_rules ADD COLUMN strength REAL NOT NULL DEFAULT 0`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE project_rules ADD COLUMN occurrences INTEGER NOT NULL DEFAULT 0`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE project_rules ADD COLUMN negative_evidence_count INTEGER NOT NULL DEFAULT 0`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE project_rules ADD COLUMN stale_score REAL NOT NULL DEFAULT 0`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE project_rules ADD COLUMN last_reinforced_at TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE project_rules ADD COLUMN expires_at TEXT`) } catch { /* already exists */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS fact_records (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL DEFAULT '',
      session_id      TEXT NOT NULL DEFAULT '',
      workspace_path  TEXT NOT NULL DEFAULT '',
      source_type     TEXT NOT NULL DEFAULT 'message',
      source_id       TEXT NOT NULL DEFAULT '',
      kind            TEXT NOT NULL DEFAULT 'message',
      role            TEXT NOT NULL DEFAULT '',
      content         TEXT NOT NULL DEFAULT '',
      content_hash    TEXT NOT NULL DEFAULT '',
      metadata        TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_records_hash
      ON fact_records(project_id, session_id, source_type, content_hash);

    CREATE INDEX IF NOT EXISTS idx_fact_records_project
      ON fact_records(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS session_observations (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL DEFAULT '',
      session_id       TEXT NOT NULL DEFAULT '',
      workspace_path   TEXT NOT NULL DEFAULT '',
      observation_key  TEXT NOT NULL DEFAULT '',
      category         TEXT NOT NULL DEFAULT 'general',
      content          TEXT NOT NULL DEFAULT '',
      confidence       REAL NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'promoted', 'archived', 'rejected')),
      evidence_ids     TEXT NOT NULL DEFAULT '[]',
      source_trigger   TEXT NOT NULL DEFAULT '',
      expires_at       TEXT,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_session_observations_project
      ON session_observations(project_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_session_observations_key
      ON session_observations(project_id, observation_key, status);

    CREATE TABLE IF NOT EXISTS semantic_memories (
      id                       TEXT PRIMARY KEY,
      project_id               TEXT NOT NULL DEFAULT '',
      workspace_path           TEXT NOT NULL DEFAULT '',
      memory_key               TEXT NOT NULL DEFAULT '',
      title                    TEXT NOT NULL DEFAULT '',
      content                  TEXT NOT NULL DEFAULT '',
      category                 TEXT NOT NULL DEFAULT 'general',
      status                   TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('candidate', 'active', 'stale', 'archived', 'rejected')),
      confidence               REAL NOT NULL DEFAULT 0,
      strength                 REAL NOT NULL DEFAULT 0,
      occurrences              INTEGER NOT NULL DEFAULT 0,
      evidence_ids             TEXT NOT NULL DEFAULT '[]',
      source_observation_ids   TEXT NOT NULL DEFAULT '[]',
      negative_evidence_count  INTEGER NOT NULL DEFAULT 0,
      confirmed_by_user        INTEGER NOT NULL DEFAULT 0,
      stale_score              REAL NOT NULL DEFAULT 0,
      last_reinforced_at       TEXT,
      expires_at               TEXT,
      created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_memories_key
      ON semantic_memories(project_id, memory_key);

    CREATE INDEX IF NOT EXISTS idx_semantic_memories_project
      ON semantic_memories(project_id, status, strength DESC);

    CREATE TABLE IF NOT EXISTS project_dossiers (
      id                         TEXT PRIMARY KEY,
      project_id                 TEXT NOT NULL DEFAULT '',
      workspace_path             TEXT NOT NULL DEFAULT '',
      version                    INTEGER NOT NULL DEFAULT 1,
      summary                    TEXT NOT NULL DEFAULT '',
      current_goal               TEXT NOT NULL DEFAULT '',
      user_preferences           TEXT NOT NULL DEFAULT '',
      stable_rules               TEXT NOT NULL DEFAULT '',
      recent_risks               TEXT NOT NULL DEFAULT '',
      repeated_issues            TEXT NOT NULL DEFAULT '',
      deprecated_understanding   TEXT NOT NULL DEFAULT '',
      next_steps                 TEXT NOT NULL DEFAULT '',
      source                     TEXT NOT NULL DEFAULT 'deterministic',
      token_budget_chars         INTEGER NOT NULL DEFAULT 1200,
      created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_project_dossiers_project
      ON project_dossiers(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS negative_priors (
      id                  TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL DEFAULT '',
      workspace_path      TEXT NOT NULL DEFAULT '',
      prior_key           TEXT NOT NULL DEFAULT '',
      content             TEXT NOT NULL DEFAULT '',
      source_entity_type  TEXT NOT NULL DEFAULT '',
      source_entity_id    TEXT NOT NULL DEFAULT '',
      strength            REAL NOT NULL DEFAULT 1,
      expires_at          TEXT,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_negative_priors_project
      ON negative_priors(project_id, prior_key, created_at DESC);
  `)
  // v12: Feishu-only IM bridge.
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_channels (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL DEFAULT 'feishu'
                         CHECK (type IN ('feishu')),
      project_id       TEXT NOT NULL DEFAULT '',
      enabled          INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'not_configured'
                         CHECK (status IN ('connected', 'connecting', 'disconnected', 'not_configured', 'error')),
      credentials      TEXT NOT NULL DEFAULT '{}',
      dm_policy        TEXT NOT NULL DEFAULT 'open'
                         CHECK (dm_policy IN ('open', 'allowlist', 'disabled')),
      group_policy     TEXT NOT NULL DEFAULT 'mention'
                         CHECK (group_policy IN ('mention', 'open', 'allowlist', 'disabled')),
      trigger_mode     TEXT NOT NULL DEFAULT 'mention'
                         CHECK (trigger_mode IN ('mention', 'all')),
      sender_whitelist TEXT NOT NULL DEFAULT '[]',
      group_whitelist  TEXT NOT NULL DEFAULT '[]',
      default_project_id TEXT NOT NULL DEFAULT '',
      default_model    TEXT NOT NULL DEFAULT '',
      permission_mode  TEXT NOT NULL DEFAULT 'confirm'
                         CHECK (permission_mode IN ('confirm', 'read-only', 'full')),
      last_connected_at TEXT,
      last_error       TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `)
  // v13: IM channels are project-scoped. Legacy v12 rows can remain inert,
  // but the column must exist before creating the project/type index.
  try { db.exec(`ALTER TABLE im_channels ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`) } catch { /* already exists */ }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_im_channels_project_type
      ON im_channels(project_id, type)
      WHERE project_id != '';

    CREATE TABLE IF NOT EXISTS im_channel_bindings (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      chat_name   TEXT NOT NULL DEFAULT '',
      project_id  TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(channel_id, chat_id),
      FOREIGN KEY (channel_id) REFERENCES im_channels(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_im_bindings_project ON im_channel_bindings(project_id);
    CREATE INDEX IF NOT EXISTS idx_im_bindings_session ON im_channel_bindings(session_id);

    CREATE TABLE IF NOT EXISTS im_message_dedupe (
      message_key TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS im_audit_logs (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL DEFAULT '',
      chat_id     TEXT NOT NULL DEFAULT '',
      project_id  TEXT NOT NULL DEFAULT '',
      session_id  TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'ok',
      details     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_im_audit_logs_time ON im_audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS im_permission_requests (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      sender_id   TEXT NOT NULL DEFAULT '',
      session_id  TEXT NOT NULL DEFAULT '',
      tool_name   TEXT NOT NULL DEFAULT '',
      tool_input  TEXT NOT NULL DEFAULT '{}',
      status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'allowed', 'denied', 'timeout')),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_im_permission_requests_status ON im_permission_requests(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL CHECK (scope IN ('session', 'project')),
      scope_id   TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT '',
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_events_scope
      ON runtime_events(scope, scope_id, id);

    CREATE INDEX IF NOT EXISTS idx_runtime_events_created
      ON runtime_events(created_at);
  `)
  migrateLegacySessionWorkspaceArrays(db)
  // v15: image generation async job queue.
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_generation_jobs (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'merging', 'submitting', 'waiting', 'success', 'error')),
      provider_id     TEXT NOT NULL DEFAULT '',
      model           TEXT NOT NULL DEFAULT '',
      prompt          TEXT NOT NULL DEFAULT '',
      final_prompt    TEXT NOT NULL DEFAULT '',
      aspect_ratio    TEXT NOT NULL DEFAULT '1:1',
      style_id        TEXT NOT NULL DEFAULT 'none',
      size            TEXT NOT NULL DEFAULT '1024x1024',
      count           INTEGER NOT NULL DEFAULT 1,
      reference_images TEXT NOT NULL DEFAULT '[]',
      result_urls     TEXT NOT NULL DEFAULT '[]',
      result_metadata TEXT NOT NULL DEFAULT '{}',
      error_message   TEXT NOT NULL DEFAULT '',
      started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      completed_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_session
      ON image_generation_jobs(session_id, started_at DESC);
  `)
  try { db.exec(`ALTER TABLE image_generation_jobs ADD COLUMN reference_images TEXT NOT NULL DEFAULT '[]'`) } catch { /* already exists */ }
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

function migrateLegacySessionWorkspaceArrays(db: Database.Database) {
  const rows = db.prepare(
    `SELECT id, workspace_path, attached_folder_paths FROM sessions
     WHERE workspace_path LIKE '[%'`
  ).all() as Array<{ id: string; workspace_path: string | null; attached_folder_paths: string | null }>

  const update = db.prepare(
    `UPDATE sessions
     SET workspace_path = ?, attached_folder_paths = ?
     WHERE id = ?`
  )

  for (const row of rows) {
    if (!row.workspace_path) continue
    try {
      const parsed = JSON.parse(row.workspace_path)
      if (!Array.isArray(parsed)) continue
      const paths = [...new Set(parsed
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map(p => p.trim()))]
      if (paths.length === 0) {
        update.run(null, row.attached_folder_paths ?? null, row.id)
        continue
      }
      const existingAttached = parsePathList(row.attached_folder_paths)
      const attached = [...new Set([...paths.slice(1), ...existingAttached])]
      update.run(paths[0], attached.length > 0 ? JSON.stringify(attached) : null, row.id)
    } catch {
      // Legacy single-path values are already in the desired shape.
    }
  }
}

function parsePathList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return [...new Set(parsed
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map(p => p.trim()))]
    }
  } catch { /* legacy */ }
  const trimmed = value.trim()
  return trimmed ? [trimmed] : []
}

export function ensureGlobalChatProject(db: Database.Database = getDb()) {
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(GLOBAL_CHAT_PROJECT_ID)
  if (existing) {
    db.prepare(
      `UPDATE projects
       SET status = 'active', name = 'Chat', workspace_path = ''
       WHERE id = ?`
    ).run(GLOBAL_CHAT_PROJECT_ID)
    return
  }

  db.prepare(
    `INSERT INTO projects (id, name, description, workspace_path, default_model, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  ).run(
    GLOBAL_CHAT_PROJECT_ID,
    'Chat',
    'System project for global chat sessions',
    '',
    'claude-sonnet-4-6',
  )
}

export function getDb(): Database.Database {
  if (globalThis.__loomDb) {
    // Re-run migrations if SCHEMA_VERSION changed (handles hot-reload without server restart)
    if (globalThis.__loomDbMigratedVersion !== SCHEMA_VERSION) {
      runIncrementalMigrations(globalThis.__loomDb)
      globalThis.__loomDbMigratedVersion = SCHEMA_VERSION
    }
    return globalThis.__loomDb
  }

  const dbPath = getDbPath()
  const isNewDb = !require('node:fs').existsSync(dbPath)
  const db = new Database(dbPath)
  applySchema(db)

  // One-time migration from legacy abmom-ai DB. This is opt-in only: release
  // builds must start with a clean user database and must not import old data.
  if (isNewDb && shouldMigrateLegacyAbmomDb()) {
    const migrationDone = (db.prepare(
      "SELECT value FROM app_settings WHERE key = 'migration_from_abmom'"
    ).get() as { value: string } | undefined)?.value

    if (!migrationDone) {
      const legacyPath = getLegacyAbmomDbPath()
      if (legacyPath) {
        try {
          migrateFromAbmom(legacyPath, db)
          db.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('migration_from_abmom', 'completed')"
          ).run()
          logger.info('db.legacy_migration_done', { legacyPath })
        } catch (err) {
          logger.error('db.legacy_migration_failed', err, { legacyPath })
        }
      }
    }
  }

  runIncrementalMigrations(db)
  globalThis.__loomDb = db
  globalThis.__loomDbMigratedVersion = SCHEMA_VERSION
  return db
}
