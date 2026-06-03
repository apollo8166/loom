/**
 * API provider resolution for Loom CC.
 * Priority: DB active provider -> ANTHROPIC_API_KEY env var -> Claude CLI OAuth
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export interface ResolvedProvider {
  apiKey: string
  baseUrl?: string
  provider: string
  providerId: string
  isCliAuth: boolean
  authType: 'api_key' | 'auth_token'
  supportsThinking: boolean
  apiFormat?: 'anthropic' | 'openai'
  upstreamBaseUrl?: string
  /** Actual model ID to send to the SDK (tier-mapped for non-Anthropic providers) */
  resolvedModelId?: string
}

export function getProxyBaseUrl(): string {
  const port = process.env.PORT || '3000'
  return `http://localhost:${port}/api/llm-proxy`
}

export function isClaudeCliAuthenticated(): boolean {
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json')
    if (!fs.existsSync(claudeJsonPath)) return false
    const content = fs.readFileSync(claudeJsonPath, 'utf-8')
    const parsed = JSON.parse(content)
    return !!(parsed.oauthAccount?.accountUuid)
  } catch {
    return false
  }
}

export function resolveProvider(_model?: string, providerIdOverride?: string): ResolvedProvider {
  // 1. Try DB-driven provider selection
  try {
    const { getDb } = require('@/shared/db/db') as typeof import('@/shared/db/db')
    const { getActiveProviderConfig, getAllProviderConfigs, isAnthropicProvider, mapModelToProvider } = require('@/shared/config/provider-config') as typeof import('@/shared/config/provider-config')
    const db = getDb()

    // Project-level provider override: find the specified provider config
    if (providerIdOverride) {
      const allConfigs = getAllProviderConfigs(db)
      const overrideConfig = allConfigs.find((c: { id: string }) => c.id === providerIdOverride)
      if (overrideConfig) {
        if (!isAnthropicProvider(overrideConfig) && overrideConfig.apiKey) {
          return {
            apiKey: overrideConfig.apiKey,
            baseUrl: getProxyBaseUrl(),
            provider: overrideConfig.id,
            providerId: overrideConfig.id,
            isCliAuth: false,
            authType: 'api_key',
            supportsThinking: overrideConfig.supportsThinking ?? false,
            apiFormat: overrideConfig.apiFormat ?? 'openai',
            upstreamBaseUrl: overrideConfig.baseUrl,
            resolvedModelId: _model ? mapModelToProvider(_model, overrideConfig) : undefined,
          }
        }
        if (isAnthropicProvider(overrideConfig)) {
          // Anthropic override: apply same logic (DB key → env var → CLI OAuth)
          const dbApiKey = overrideConfig.apiKey || ''
          const dbBaseUrl = overrideConfig.baseUrl || undefined
          if (dbApiKey) {
            return { apiKey: dbApiKey, baseUrl: dbBaseUrl, upstreamBaseUrl: dbBaseUrl, provider: 'anthropic', providerId: 'anthropic', isCliAuth: false, authType: 'api_key', supportsThinking: true, apiFormat: 'anthropic', resolvedModelId: _model ? mapModelToProvider(_model, overrideConfig) : undefined }
          }
          const envApiKey = process.env.ANTHROPIC_API_KEY || ''
          const effectiveBaseUrl = dbBaseUrl ?? process.env.ANTHROPIC_BASE_URL ?? undefined
          if (envApiKey) {
            return { apiKey: envApiKey, baseUrl: effectiveBaseUrl, upstreamBaseUrl: effectiveBaseUrl, provider: 'anthropic', providerId: 'anthropic', isCliAuth: false, authType: 'api_key', supportsThinking: true, apiFormat: 'anthropic', resolvedModelId: _model ? mapModelToProvider(_model, overrideConfig) : undefined }
          }
          if (isClaudeCliAuthenticated()) {
            return { apiKey: '', baseUrl: effectiveBaseUrl, upstreamBaseUrl: effectiveBaseUrl, provider: 'anthropic', providerId: 'anthropic', isCliAuth: true, authType: 'api_key', supportsThinking: true, apiFormat: 'anthropic', resolvedModelId: _model ? mapModelToProvider(_model, overrideConfig) : undefined }
          }
        }
        // Override config found but not usable → fall through to global active provider
      }
    }

    const config = getActiveProviderConfig(db)

    if (!isAnthropicProvider(config) && config.apiKey) {
      // Non-Anthropic provider with configured API key -> route through local proxy
      return {
        apiKey: config.apiKey,
        baseUrl: getProxyBaseUrl(),
        provider: config.id,
        providerId: config.id,
        isCliAuth: false,
        authType: 'api_key',
        supportsThinking: config.supportsThinking ?? false,
        apiFormat: config.apiFormat ?? 'openai',
        upstreamBaseUrl: config.baseUrl,
        resolvedModelId: _model ? mapModelToProvider(_model, config) : undefined,
      }
    }

    if (isAnthropicProvider(config)) {
      // Anthropic: use DB-stored apiKey/baseUrl if present, else fall through to env var
      const dbApiKey = config.apiKey || ''
      const dbBaseUrl = config.baseUrl || undefined
      if (dbApiKey) {
        return {
          apiKey: dbApiKey,
          baseUrl: dbBaseUrl,
          provider: 'anthropic',
          providerId: 'anthropic',
          isCliAuth: false,
          authType: 'api_key',
          supportsThinking: true,
          apiFormat: 'anthropic',
          upstreamBaseUrl: dbBaseUrl,
          resolvedModelId: _model ? mapModelToProvider(_model, config) : undefined,
        }
      }
      // No DB key -> env var or CLI auth (continue to step 2/3 below, but preserve dbBaseUrl)
      const envApiKey = process.env.ANTHROPIC_API_KEY || ''
      const effectiveBaseUrl = dbBaseUrl ?? process.env.ANTHROPIC_BASE_URL ?? undefined
      if (envApiKey) {
        return {
          apiKey: envApiKey,
          baseUrl: effectiveBaseUrl,
          provider: 'anthropic',
          providerId: 'anthropic',
          isCliAuth: false,
          authType: 'api_key',
          supportsThinking: true,
          apiFormat: 'anthropic',
          upstreamBaseUrl: effectiveBaseUrl,
          resolvedModelId: _model ? mapModelToProvider(_model, config) : undefined,
        }
      }
      if (isClaudeCliAuthenticated()) {
        return {
          apiKey: '',
          baseUrl: effectiveBaseUrl,
          provider: 'anthropic',
          providerId: 'anthropic',
          isCliAuth: true,
          authType: 'api_key',
          supportsThinking: true,
          apiFormat: 'anthropic',
          upstreamBaseUrl: effectiveBaseUrl,
          resolvedModelId: _model ? mapModelToProvider(_model, config) : undefined,
        }
      }
    }
  } catch { /* DB not available or schema not ready */ }

  // 2. Anthropic: env var (DB unavailable fallback)
  const apiKey = process.env.ANTHROPIC_API_KEY || ''
  const baseUrl = process.env.ANTHROPIC_BASE_URL || undefined

  if (apiKey) {
    return {
      apiKey,
      baseUrl,
      provider: 'anthropic',
      providerId: 'anthropic',
      isCliAuth: false,
      authType: 'api_key',
      supportsThinking: true,
      apiFormat: 'anthropic',
      upstreamBaseUrl: baseUrl,
    }
  }

  // 3. Anthropic: CLI OAuth
  if (isClaudeCliAuthenticated()) {
    return {
      apiKey: '',
      baseUrl,
      provider: 'anthropic',
      providerId: 'anthropic',
      isCliAuth: true,
      authType: 'api_key',
      supportsThinking: true,
      apiFormat: 'anthropic',
      upstreamBaseUrl: baseUrl,
    }
  }

  throw new Error(
    'No credentials found. Configure a provider in Settings, add ANTHROPIC_API_KEY to .env.local, ' +
    'or run `claude login` in your terminal.'
  )
}
