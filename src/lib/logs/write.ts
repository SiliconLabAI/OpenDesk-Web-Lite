import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb, hasDb } from '~/lib/db/server'
import { defaultOrgId, ensureDefaultOrg } from '~/lib/db/org'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogKind =
  | 'llm'
  | 'manus'
  | 'medialyst'
  | 'chat'
  | 'skill'
  | 'webhook'
  | 'sqlite'
  | 'http'
  | 'event'

export type AppLogInput = {
  level?: LogLevel
  source?: string
  kind?: LogKind | string
  message: string
  request?: Record<string, unknown>
  response?: Record<string, unknown>
  meta?: Record<string, unknown>
  durationMs?: number
  error?: string
}

function truncate(obj: unknown, max = 12_000): unknown {
  try {
    const s = JSON.stringify(obj)
    if (s.length <= max) return obj
    return { _truncated: true, preview: s.slice(0, max) }
  } catch {
    return { _unserializable: true }
  }
}

/** Fire-and-forget log write (never throws to callers). */
export async function writeAppLog(entry: AppLogInput): Promise<void> {
  if (!hasDb()) {
    console.log('[app_log]', entry.kind, entry.message, entry.error || '')
    return
  }
  try {
    const db = getDb()
    let orgId: string | null = null
    try {
      orgId = await ensureDefaultOrg(db)
    } catch {
      orgId = defaultOrgId()
    }
    await db.from('app_logs').insert({
      org_id: orgId,
      level: entry.level || 'info',
      source: entry.source || 'server',
      kind: entry.kind || 'event',
      message: entry.message.slice(0, 2000),
      request: truncate(entry.request || {}),
      response: truncate(entry.response || {}),
      meta: truncate(entry.meta || {}),
      duration_ms: entry.durationMs ?? null,
      error: entry.error?.slice(0, 4000) || null,
    })
  } catch (e) {
    console.error('[app_log] write failed', e)
  }
}

export const listAppLogs = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({
        limit: z.number().min(1).max(200).optional(),
        kind: z.string().optional(),
        level: z.string().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return {
        ok: false as const,
        logs: [] as unknown[],
        error: 'Database not configured',
      }
    }
    try {
      const db = getDb()
      let q = db
        .from('app_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(data?.limit ?? 100)
      if (data?.kind) q = q.eq('kind', data.kind)
      if (data?.level) q = q.eq('level', data.level)
      const { data: rows, error } = await q
      if (error) return { ok: false as const, logs: [], error: error.message }
      return { ok: true as const, logs: rows || [] }
    } catch (e) {
      return {
        ok: false as const,
        logs: [],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

export const clearAppLogs = createServerFn({ method: 'POST' }).handler(
  async () => {
    if (!hasDb()) {
      return { ok: false as const, error: 'No database' }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { error } = await db.from('app_logs').delete().eq('org_id', orgId)
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)
