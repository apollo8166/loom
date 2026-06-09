import crypto from 'crypto'
import { getDb } from '@/shared/db/db'
import type { ImChannelRow, ImSessionResolution, IncomingImMessage } from './types'

interface ProjectRow {
  id: string
  name: string
  workspace_path: string
  default_model: string
}

interface SessionRow {
  id: string
  project_id: string
  title: string
  model: string
  runtime_session_id: string | null
  status: string
}

export class ImChannelRouter {
  resolveSession(message: IncomingImMessage, channel: ImChannelRow): ImSessionResolution {
    const db = getDb()
    const binding = db.prepare(
      `SELECT b.*, p.name AS project_name, p.workspace_path, p.default_model, s.title, s.model, s.runtime_session_id, s.status
       FROM im_channel_bindings b
       JOIN projects p ON p.id = b.project_id
       JOIN sessions s ON s.id = b.session_id
       WHERE b.channel_id = ? AND b.chat_id = ?`,
    ).get(message.channelId, message.chatId) as (Record<string, unknown> & {
      project_id: string
      project_name: string
      session_id: string
      workspace_path: string
      default_model: string
      title: string
      model: string
      runtime_session_id: string | null
      status: string
    }) | undefined

    if (binding && binding.status !== 'deleted') {
      const runtimeSessionId = binding.runtime_session_id || this.ensureRuntimeSession(binding.session_id)
      return {
        projectId: binding.project_id,
        projectName: binding.project_name,
        sessionId: binding.session_id,
        runtimeSessionId,
        model: binding.model || binding.default_model || channel.default_model || 'claude-sonnet-4-6',
        title: String(binding.title || '[Feishu] Conversation'),
        workspacePath: this.resolveWorkspace(binding.project_id, binding.workspace_path),
        isNew: false,
      }
    }

    const project = this.resolveDefaultProject(channel)
    const session = this.createSession({
      project,
      message,
      model: channel.default_model || project.default_model || 'claude-sonnet-4-6',
    })
    this.upsertBinding(message.channelId, message.chatId, message.chatName || '', project.id, session.id)
    return {
      projectId: project.id,
      projectName: project.name,
      sessionId: session.id,
      runtimeSessionId: session.runtimeSessionId,
      model: session.model,
      title: session.title,
      workspacePath: this.resolveWorkspace(project.id, project.workspace_path),
      isNew: true,
    }
  }

  createNewSession(message: IncomingImMessage, channel: ImChannelRow): ImSessionResolution {
    const db = getDb()
    const existing = db.prepare(
      `SELECT p.id, p.name, p.workspace_path, p.default_model
       FROM im_channel_bindings b
       JOIN projects p ON p.id = b.project_id
       WHERE b.channel_id = ? AND b.chat_id = ?`,
    ).get(message.channelId, message.chatId) as ProjectRow | undefined
    const project = existing ?? this.resolveDefaultProject(channel)
    const session = this.createSession({
      project,
      message,
      model: channel.default_model || project.default_model || 'claude-sonnet-4-6',
    })
    this.upsertBinding(message.channelId, message.chatId, message.chatName || '', project.id, session.id)
    return {
      projectId: project.id,
      projectName: project.name,
      sessionId: session.id,
      runtimeSessionId: session.runtimeSessionId,
      model: session.model,
      title: session.title,
      workspacePath: this.resolveWorkspace(project.id, project.workspace_path),
      isNew: true,
    }
  }

  bindSession(channelId: string, chatId: string, chatName: string, sessionIdOrPrefix: string) {
    const db = getDb()
    const session = this.findSession(sessionIdOrPrefix)
    if (!session) throw new Error(`未找到会话：${sessionIdOrPrefix}`)
    this.upsertBinding(channelId, chatId, chatName, session.project_id, session.id)
    const project = db.prepare('SELECT id, name, workspace_path, default_model FROM projects WHERE id = ?').get(session.project_id) as ProjectRow
    return { session, project }
  }

  getBinding(channelId: string, chatId: string) {
    return getDb().prepare(
      `SELECT b.*, p.name AS project_name, s.title AS session_title, s.model AS session_model
       FROM im_channel_bindings b
       LEFT JOIN projects p ON p.id = b.project_id
       LEFT JOIN sessions s ON s.id = b.session_id
       WHERE b.channel_id = ? AND b.chat_id = ?`,
    ).get(channelId, chatId) as Record<string, unknown> | undefined
  }

  listRecentSessions(limit = 10, projectId?: string) {
    const sql = projectId
      ? `SELECT s.id, s.title, s.project_id, s.updated_at, p.name AS project_name
         FROM sessions s JOIN projects p ON p.id = s.project_id
         WHERE s.status != 'deleted' AND s.project_id = ?
         ORDER BY s.updated_at DESC LIMIT ?`
      : `SELECT s.id, s.title, s.project_id, s.updated_at, p.name AS project_name
         FROM sessions s JOIN projects p ON p.id = s.project_id
         WHERE s.status != 'deleted'
         ORDER BY s.updated_at DESC LIMIT ?`
    return projectId
      ? getDb().prepare(sql).all(projectId, limit) as Array<Record<string, string>>
      : getDb().prepare(sql).all(limit) as Array<Record<string, string>>
  }

  private resolveDefaultProject(channel: ImChannelRow): ProjectRow {
    const db = getDb()
    const project = db.prepare(
      `SELECT id, name, workspace_path, default_model FROM projects
       WHERE id = ? AND status = 'active'`,
    ).get(channel.project_id) as ProjectRow | undefined
    if (!project) throw new Error('IM channel is not bound to an active project')
    return project
  }

  private createSession(params: { project: ProjectRow; message: IncomingImMessage; model: string }) {
    const db = getDb()
    const id = crypto.randomUUID()
    const runtimeSessionId = crypto.randomUUID()
    const titleSeed = params.message.text.trim() || params.message.chatName || params.message.senderName || 'New conversation'
    const title = `[Feishu] ${titleSeed.length > 42 ? `${titleSeed.slice(0, 39)}...` : titleSeed}`
    db.prepare(
      `INSERT INTO sessions (id, project_id, title, model, runtime_session_id, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    ).run(id, params.project.id, title, params.model, runtimeSessionId)
    db.prepare(
      `UPDATE projects SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
    ).run(params.project.id)
    return { id, runtimeSessionId, model: params.model, title }
  }

  private upsertBinding(channelId: string, chatId: string, chatName: string, projectId: string, sessionId: string) {
    getDb().prepare(
      `INSERT INTO im_channel_bindings (id, channel_id, chat_id, chat_name, project_id, session_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, chat_id) DO UPDATE SET
         chat_name = excluded.chat_name,
         project_id = excluded.project_id,
         session_id = excluded.session_id,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    ).run(crypto.randomUUID(), channelId, chatId, chatName, projectId, sessionId)
  }

  private findSession(prefix: string): SessionRow | null {
    const query = prefix.trim()
    if (!query) return null
    const exact = getDb().prepare(
      `SELECT id, project_id, title, model, runtime_session_id, status
       FROM sessions WHERE id = ? AND status != 'deleted'`,
    ).get(query) as SessionRow | undefined
    if (exact) return exact
    const matches = getDb().prepare(
      `SELECT id, project_id, title, model, runtime_session_id, status
       FROM sessions
       WHERE id LIKE ? AND status != 'deleted'
       ORDER BY updated_at DESC LIMIT 2`,
    ).all(`${query}%`) as SessionRow[]
    return matches.length === 1 ? matches[0] : null
  }

  private ensureRuntimeSession(sessionId: string): string {
    const runtimeSessionId = crypto.randomUUID()
    getDb().prepare(
      `UPDATE sessions SET runtime_session_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`,
    ).run(runtimeSessionId, sessionId)
    return runtimeSessionId
  }

  private resolveWorkspace(projectId: string, workspacePath: string): string {
    if (workspacePath?.trim()) return workspacePath
    if (!projectId) return workspacePath
    return workspacePath
  }
}
