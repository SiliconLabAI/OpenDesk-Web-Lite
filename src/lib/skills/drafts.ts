import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb, hasDb } from '~/lib/db/server'
import { ensureDefaultOrg } from '~/lib/db/org'

export const saveSkillDraft = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      skillSlug: z.string().min(1),
      values: z.record(z.string()),
      title: z.string().optional(),
      profileName: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return {
        ok: false as const,
        error: 'Database not configured — cannot save skill draft',
      }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const row = {
        org_id: orgId,
        skill_slug: data.skillSlug,
        title: data.title || data.skillSlug,
        payload: data.values,
        profile_name: data.profileName || null,
        updated_at: new Date().toISOString(),
      }
      // Try payload column first; fall back to values for old schema
      let { error } = await db
        .from('skill_drafts')
        .upsert(row, { onConflict: 'org_id,skill_slug' })
      if (error && /payload|column/i.test(error.message)) {
        const { error: e2 } = await db.from('skill_drafts').upsert(
          {
            org_id: orgId,
            skill_slug: data.skillSlug,
            title: data.title || data.skillSlug,
            values: data.values,
            profile_name: data.profileName || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,skill_slug' },
        )
        error = e2
      }
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

export const loadSkillDraft = createServerFn({ method: 'GET' })
  .validator(z.object({ skillSlug: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return {
        ok: false as const,
        values: null as Record<string, string> | null,
        error: 'No database',
      }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { data: row, error } = await db
        .from('skill_drafts')
        .select('*')
        .eq('org_id', orgId)
        .eq('skill_slug', data.skillSlug)
        .maybeSingle()
      if (error) {
        return { ok: false as const, values: null, error: error.message }
      }
      if (!row) return { ok: true as const, values: null }
      const payload =
        (row.payload as Record<string, string> | null) ||
        (row.values as Record<string, string> | null) ||
        null
      return {
        ok: true as const,
        values: payload,
        updatedAt: row.updated_at as string,
      }
    } catch (e) {
      return {
        ok: false as const,
        values: null,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

export const listSkillDrafts = createServerFn({ method: 'GET' }).handler(
  async () => {
    if (!hasDb()) {
      return { ok: false as const, drafts: [] as unknown[], error: 'No database' }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { data, error } = await db
        .from('skill_drafts')
        .select('skill_slug, title, updated_at, profile_name')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
      if (error) return { ok: false as const, drafts: [], error: error.message }
      return { ok: true as const, drafts: data || [] }
    } catch (e) {
      return {
        ok: false as const,
        drafts: [],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)
