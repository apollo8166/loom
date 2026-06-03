import path from 'path'
import fs from 'node:fs'
import os from 'node:os'
import { BRAND } from '@/brand/config'

/**
 * Resolve the Loom CC data directory.
 * Priority: LOOM_DATA_DIR env var (set by Electron main.ts in production)
 *   → fallback by NODE_ENV:
 *     production  → loom-cc
 *     development → loom-cc-dev  (isolated from production data)
 */
export function getLoomDataDir(): string {
  if (process.env.LOOM_DATA_DIR) return process.env.LOOM_DATA_DIR
  const name = process.env.NODE_ENV === 'production' ? BRAND.dataDir : BRAND.dataDirDev
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name)
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', name)
  }
  return path.join(os.homedir(), `.${name}`)
}

/** Resolve the DB file path, ensuring the data directory exists. */
export function getDbPath(): string {
  const dir = getLoomDataDir()
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, BRAND.dbName)
}

/** Uploads directory for file attachments. */
export function getUploadsDir(): string {
  const dir = path.join(getLoomDataDir(), 'uploads')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Global workspace root for projects that haven't set a custom path. */
export function getDefaultWorkspacesDir(): string {
  const dir = path.join(getLoomDataDir(), 'workspaces')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Safe default cwd for standalone Chat sessions without a user-selected workspace. */
export function getGlobalChatWorkspaceDir(): string {
  const dir = path.join(getLoomDataDir(), 'global-chat-workspace')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Resolve the legacy abmom-ai DB path (for migration). */
export function getLegacyAbmomDbPath(): string | null {
  const devPath = process.env.NODE_ENV === 'production'
    ? getAbmomDataPath('abmom-ai')
    : getAbmomDataPath('abmom-ai-dev')
  if (fs.existsSync(devPath)) return devPath

  // Also check the other environment
  const otherPath = process.env.NODE_ENV === 'production'
    ? getAbmomDataPath('abmom-ai-dev')
    : getAbmomDataPath('abmom-ai')
  if (fs.existsSync(otherPath)) return otherPath

  return null
}

function getAbmomDataPath(name: string): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name, 'abmom.db')
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', name, 'abmom.db')
  }
  return path.join(os.homedir(), `.${name}`, 'abmom.db')
}
