import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { logger } from '@/shared/logging/logger'

/**
 * One-time migration from abmom-ai (legacy) database to loom-cc database.
 *
 * Mapping:
 *   conversations → projects  (title→name, model→default_model)
 *   sessions      → sessions  (conversation_id→project_id, status remapped)
 *   sessions(status='history') → session_boundaries
 *   messages      → messages  (+ context_version=0)
 *   settings      → app_settings
 *
 * Dropped (not migrated):
 *   exams, errors, practice_sessions, vocab_lists, vocab_items, vocab_reviews
 */
export function migrateFromAbmom(
  legacyDbPath: string,
  targetDb: Database.Database,
): void {
  logger.info('db.migration.read_legacy', { legacyDbPath })
  const src = new Database(legacyDbPath, { readonly: true })

  const migrate = targetDb.transaction(() => {
    // ── 1. Conversations → Projects ────────────────────────────────────────
    const conversations = src.prepare(
      'SELECT id, title, model, created_at, updated_at FROM conversations'
    ).all() as { id: string; title: string; model: string; created_at: string; updated_at: string }[]

    const insertProject = targetDb.prepare(`
      INSERT OR IGNORE INTO projects
        (id, name, workspace_path, default_model, is_pinned, created_at, updated_at)
      VALUES (?, ?, '', ?, 0, ?, ?)
    `)

    for (const conv of conversations) {
      insertProject.run(
        conv.id,
        conv.title || 'Imported Project',
        conv.model || 'claude-sonnet-4-6',
        conv.created_at,
        conv.updated_at,
      )
    }
    logger.info('db.migration.projects_done', { projectCount: conversations.length })

    // ── 2. Sessions → Sessions ─────────────────────────────────────────────
    const sessions = src.prepare(
      'SELECT id, conversation_id, title, model, status, compact_summary, created_at, updated_at FROM sessions'
    ).all() as {
      id: string
      conversation_id: string | null
      title: string
      model: string
      status: string
      compact_summary: string | null
      created_at: string
      updated_at: string
    }[]

    const insertSession = targetDb.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, project_id, title, model, status, compact_summary, context_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `)

    const insertBoundary = targetDb.prepare(`
      INSERT INTO session_boundaries
        (id, session_id, boundary_type, summary, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    let sessionCount = 0
    let boundaryCount = 0

    for (const s of sessions) {
      const projectId = s.conversation_id || 'orphan'
      // Map old status values
      const newStatus = s.status === 'active' ? 'active' : 'archived'

      insertSession.run(
        s.id,
        projectId,
        s.title || 'Imported Session',
        s.model || 'claude-sonnet-4-6',
        newStatus,
        s.compact_summary,
        s.created_at,
        s.updated_at,
      )
      sessionCount++

      // history sessions → session_boundary
      if (s.status === 'history') {
        const boundaryType = s.compact_summary ? 'compact' : 'clear'
        insertBoundary.run(
          nanoid(),
          s.id,
          boundaryType,
          s.compact_summary,
          s.updated_at,
        )
        boundaryCount++
      }
    }
    logger.info('db.migration.sessions_done', { sessionCount, boundaryCount })

    // ── 3. Messages → Messages ─────────────────────────────────────────────
    const messages = src.prepare(
      'SELECT id, session_id, role, content, elapsed_seconds, input_tokens, output_tokens, created_at FROM messages'
    ).all() as {
      id: string
      session_id: string
      role: string
      content: string
      elapsed_seconds: number
      input_tokens: number
      output_tokens: number
      created_at: string
    }[]

    const insertMessage = targetDb.prepare(`
      INSERT OR IGNORE INTO messages
        (id, session_id, context_version, role, content, elapsed_seconds, input_tokens, output_tokens, created_at)
      VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
    `)

    for (const m of messages) {
      insertMessage.run(
        m.id,
        m.session_id,
        m.role,
        m.content,
        m.elapsed_seconds || 0,
        m.input_tokens || 0,
        m.output_tokens || 0,
        m.created_at,
      )
    }
    logger.info('db.migration.messages_done', { messageCount: messages.length })

    // Update last_message_at on sessions
    targetDb.exec(`
      UPDATE sessions
      SET last_message_at = (
        SELECT MAX(created_at) FROM messages WHERE messages.session_id = sessions.id
      )
      WHERE EXISTS (SELECT 1 FROM messages WHERE messages.session_id = sessions.id)
    `)

    // ── 4. Settings → App Settings ─────────────────────────────────────────
    let settingsRows: { key: string; value: string }[] = []
    try {
      settingsRows = src.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    } catch {
      // old DB might not have this table
    }

    const insertSetting = targetDb.prepare(
      "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)"
    )
    for (const row of settingsRows) {
      insertSetting.run(row.key, row.value)
    }
    logger.info('db.migration.settings_done', { settingsCount: settingsRows.length })
  })

  migrate()
  src.close()
  logger.info('db.migration.done', { legacyDbPath })
}
