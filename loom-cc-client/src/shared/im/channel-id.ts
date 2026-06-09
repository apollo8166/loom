import { getDb } from '@/shared/db/db'
import type { ImChannelRow } from './types'

export function getProjectFeishuChannelId(projectId: string): string {
  return `feishu:${projectId}`
}

export function ensureProjectFeishuChannel(projectId: string): ImChannelRow {
  const db = getDb()
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND status = ?').get(projectId, 'active')
  if (!project) throw new Error('Project not found')

  const channelId = getProjectFeishuChannelId(projectId)
  db.prepare(
    `INSERT OR IGNORE INTO im_channels (id, type, project_id)
     VALUES (?, 'feishu', ?)`,
  ).run(channelId, projectId)

  return db.prepare('SELECT * FROM im_channels WHERE id = ?').get(channelId) as ImChannelRow
}
