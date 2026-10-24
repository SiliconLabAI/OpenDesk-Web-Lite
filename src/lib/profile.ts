import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb, hasDb } from '~/lib/db/server'
import { ensureDefaultOrg } from '~/lib/db/org'

export type ClientProfile = {
  name: string
  standing: string
  beats: string
  competitors: string
  notes: string
}

export const emptyProfile = (): ClientProfile => ({
  name: '',
  standing: '',
  beats: '',
  competitors: '',
  notes: '',
})

const CACHE_KEY = 'newsjack-web-profile'

/** Sync read for forms (cache). Prefer loadProfileRemote on mount. */
export function loadProfile(): ClientProfile {
  if (typeof window === 'undefined') return emptyProfile()
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return emptyProfile()
    return { ...emptyProfile(), ...JSON.parse(raw) }
  } catch {
    return emptyProfile()
  }
}

function cacheProfile(p: ClientProfile) {
  if (typeof window === 'undefined') return
  localStorage.setItem(CACHE_KEY, JSON.stringify(p))
}

export function profileToPromptBlock(p: ClientProfile): string {
  const lines: string[] = []
  if (p.name) lines.push(`Company: ${p.name}`)
  if (p.standing) lines.push(`Standing / authority:\n${p.standing}`)
  if (p.beats) lines.push(`Beats / topics:\n${p.beats}`)
  if (p.competitors) lines.push(`Competitors:\n${p.competitors}`)
  if (p.notes) lines.push(`Notes:\n${p.notes}`)
  return lines.join('\n\n')
}

export const loadProfileRemote = createServerFn({ method: 'GET' }).handler(
  async () => {
    if (!hasDb()) {
      return { ok: false as const, profile: emptyProfile(), error: 'No database' }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { data, error } = await db
        .from('client_profiles')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) {
        return { ok: false as const, profile: emptyProfile(), error: error.message }
      }
      if (!data) {
        return { ok: true as const, profile: emptyProfile() }
      }
      const profile: ClientProfile = {
        name: data.name || '',
        standing: data.standing || '',
        beats: data.beats || '',
        competitors: data.competitors || '',
        notes: data.notes || '',
      }
      return { ok: true as const, profile }
    } catch (e) {
      return {
        ok: false as const,
        profile: emptyProfile(),
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

export const saveProfileRemote = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string(),
      standing: z.string(),
      beats: z.string(),
      competitors: z.string(),
      notes: z.string(),
      website: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, error: 'Database not configured' }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { error } = await db.from('client_profiles').upsert(
        {
          org_id: orgId,
          name: data.name,
          standing: data.standing,
          beats: data.beats,
          competitors: data.competitors,
          notes: data.notes,
          website: data.website || '',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id' },
      )
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

/** Client helper: save to SQLite + local cache */
export async function saveProfile(p: ClientProfile, website?: string) {
  cacheProfile(p)
  return saveProfileRemote({
    data: { ...p, website },
  })
}
