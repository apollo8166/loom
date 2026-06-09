/**
 * Multi-provider configuration for Loom CC.
 * Supports Anthropic + third-party OpenAI-compatible providers.
 */

import type Database from 'better-sqlite3'

// ── Types ───────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string
  name: string
  apiKey: string
  baseUrl: string           // empty string = direct Anthropic
  fastModel: string         // haiku tier  -> background / sub-agent tasks
  mainModel: string         // sonnet tier -> primary tasks
  heavyModel: string        // opus tier   -> complex reasoning
  fastContextWindowTokens?: number
  mainContextWindowTokens?: number
  heavyContextWindowTokens?: number
  supportsThinking: boolean
  supportsVision: boolean
  supportsPDF: boolean
  apiFormat: 'anthropic' | 'openai'  // wire format the provider speaks
}

// ── Built-in presets ────────────────────────────────────────────

export const PROVIDER_PRESETS: Record<string, Omit<ProviderConfig, 'apiKey'>> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: '',
    fastModel: 'claude-haiku-4-5-20251001',
    mainModel: 'claude-sonnet-4-6',
    heavyModel: 'claude-opus-4-6',
    supportsThinking: true,
    supportsVision: true,
    supportsPDF: true,
    apiFormat: 'anthropic',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    fastModel: 'deepseek-v4-flash',
    mainModel: 'deepseek-v4-pro',
    heavyModel: 'deepseek-v4-pro',
    supportsThinking: true,
    supportsVision: false,
    supportsPDF: false,
    apiFormat: 'anthropic',
  },
  qwen: {
    id: 'qwen',
    name: '千问 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    fastModel: 'qwen3.5-plus',
    mainModel: 'qwen3.5-plus',
    heavyModel: 'qwen3.6-plus',
    supportsThinking: false,
    supportsVision: true,
    supportsPDF: false,
    apiFormat: 'openai',
  },
  glm: {
    id: 'glm',
    name: 'GLM (智谱)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    fastModel: 'glm-5',
    mainModel: 'glm-5',
    heavyModel: 'glm-5.1',
    supportsThinking: true,
    supportsVision: false,
    supportsPDF: false,
    apiFormat: 'openai',
  },
  doubao: {
    id: 'doubao',
    name: '豆包 (Doubao)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    fastModel: 'ark-code-latest',
    mainModel: 'ark-code-latest',
    heavyModel: 'ark-code-latest',
    supportsThinking: false,
    supportsVision: false,
    supportsPDF: false,
    apiFormat: 'openai',
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    baseUrl: 'https://tts.ab-mom.com/v1',
    fastModel: 'gpt-5.5',
    mainModel: 'gpt-5.5',
    heavyModel: 'gpt-5.5',
    supportsThinking: true,
    supportsVision: true,
    supportsPDF: true,
    apiFormat: 'openai',
  },
  custom: {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    fastModel: '',
    mainModel: '',
    heavyModel: '',
    supportsThinking: false,
    supportsVision: false,
    supportsPDF: false,
    apiFormat: 'openai',
  },
}

export const PROVIDER_ORDER = ['anthropic', 'deepseek', 'qwen', 'glm', 'doubao', 'chatgpt', 'custom']

// ── DB helpers ──────────────────────────────────────────────────

const KEY_ACTIVE = 'active_provider_id'
const KEY_CONFIGS = 'provider_configs'

const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  const preset = PROVIDER_PRESETS[config.id]
  const next: ProviderConfig = {
    ...config,
    apiFormat: config.apiFormat ?? preset?.apiFormat ?? 'openai',
  }
  if (config.id === 'anthropic') {
    next.fastModel = ANTHROPIC_MODEL_ALIASES[next.fastModel] ?? next.fastModel
    next.mainModel = ANTHROPIC_MODEL_ALIASES[next.mainModel] ?? next.mainModel
    next.heavyModel = ANTHROPIC_MODEL_ALIASES[next.heavyModel] ?? next.heavyModel
  }
  return next
}

function dbGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function dbSet(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value)
}

export function getActiveProviderId(db: Database.Database): string {
  return dbGet(db, KEY_ACTIVE) ?? 'anthropic'
}

export function setActiveProviderId(db: Database.Database, id: string): void {
  dbSet(db, KEY_ACTIVE, id)
}

export function getAllProviderConfigs(db: Database.Database): ProviderConfig[] {
  const raw = dbGet(db, KEY_CONFIGS)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ProviderConfig[]
      // Backfill apiFormat for configs saved before this field was added
      const existing = parsed.map(c => normalizeProviderConfig(c))
      // Backfill any new providers added to PROVIDER_ORDER after the user last saved
      const existingIds = new Set(existing.map(c => c.id))
      const backfilled = PROVIDER_ORDER
        .filter(id => !existingIds.has(id) && PROVIDER_PRESETS[id])
        .map(id => ({ ...PROVIDER_PRESETS[id], apiKey: '' }))
      // Preserve existing order, append new providers at their PROVIDER_ORDER position
      const merged: ProviderConfig[] = []
      for (const id of PROVIDER_ORDER) {
        const e = existing.find(c => c.id === id)
        if (e) merged.push(e)
        else if (backfilled.find(c => c.id === id)) merged.push(backfilled.find(c => c.id === id)!)
      }
      // Append any saved configs whose id isn't in PROVIDER_ORDER (custom entries)
      for (const c of existing) {
        if (!PROVIDER_ORDER.includes(c.id)) merged.push(c)
      }
      return merged
    } catch { /* fall through */ }
  }
  // First-time defaults: return presets with empty apiKey
  return PROVIDER_ORDER.map(id => ({ ...PROVIDER_PRESETS[id], apiKey: '' }))
}

export function saveAllProviderConfigs(db: Database.Database, configs: ProviderConfig[]): void {
  dbSet(db, KEY_CONFIGS, JSON.stringify(configs.map(c => normalizeProviderConfig(c))))
}

export function getActiveProviderConfig(db: Database.Database): ProviderConfig {
  const activeId = getActiveProviderId(db)
  const configs = getAllProviderConfigs(db)
  return configs.find(c => c.id === activeId) ?? { ...PROVIDER_PRESETS.anthropic, apiKey: '' }
}

export function isAnthropicProvider(config: ProviderConfig): boolean {
  return config.id === 'anthropic'
}

/** True when the provider's wire format is Anthropic (including custom Anthropic-compatible gateways) */
export function isAnthropicFormatProvider(config: ProviderConfig): boolean {
  return (config.apiFormat ?? 'openai') === 'anthropic'
}

/** Map a Claude tier model ID to the provider's actual model name */
export function mapModelToProvider(claudeModelId: string, config: ProviderConfig): string {
  // Session/project state must not pin native provider model IDs. If older data
  // contains a native ID such as gpt-5.4, treat it as the provider's main tier so
  // the concrete model still follows the current global provider settings.
  const normalized = claudeModelId.toLowerCase()
  if (!/claude|haiku|sonnet|opus/i.test(claudeModelId)) return config.mainModel || claudeModelId
  if (normalized.includes('haiku'))  return config.fastModel  || claudeModelId
  if (normalized.includes('sonnet')) return config.mainModel  || claudeModelId
  if (normalized.includes('opus'))   return config.heavyModel || claudeModelId
  return config.mainModel || claudeModelId
}
