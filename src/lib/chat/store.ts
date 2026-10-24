import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb, hasDb } from '~/lib/db/server'
import { ensureDefaultOrg } from '~/lib/db/org'
import type { ChatMessage, ChatThread } from './history'

export const listChatThreads = createServerFn({ method: 'GET' }).handler(
  async () => {
    if (!hasDb()) {
      return { ok: false as const, threads: [] as ChatThread[], error: 'No database' }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { data: threads, error } = await db
        .from('chat_threads')
        .select('*')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(50)
      if (error) return { ok: false as const, threads: [], error: error.message }

      const result: ChatThread[] = []
      for (const t of threads || []) {
        const { data: msgs } = await db
          .from('chat_messages')
          .select('*')
          .eq('thread_id', t.id)
          .order('created_at', { ascending: true })
        result.push({
          id: t.id,
          title: t.title || 'New chat',
          skillSlug: t.skill_slug || undefined,
          updatedAt: t.updated_at,
          messages: (msgs || []).map((m) => ({
            id: m.id,
            role: m.role as ChatMessage['role'],
            content: m.content,
            skillSlug: m.skill_slug || undefined,
            createdAt: m.created_at,
          })),
        })
      }
      return { ok: true as const, threads: result }
    } catch (e) {
      return {
        ok: false as const,
        threads: [],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

export const upsertChatThread = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      title: z.string(),
      skillSlug: z.string().optional(),
      messages: z.array(
        z.object({
          id: z.string(),
          role: z.enum(['user', 'assistant', 'system']),
          content: z.string(),
          skillSlug: z.string().optional(),
          createdAt: z.string(),
        }),
      ),
    }),
  )
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, error: 'Database not configured' }
    }
    try {
      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { error: tErr } = await db.from('chat_threads').upsert(
        {
          id: data.id,
          org_id: orgId,
          title: data.title,
          skill_slug: data.skillSlug || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      if (tErr) return { ok: false as const, error: tErr.message }

      // Replace messages for thread (simple sync)
      await db.from('chat_messages').delete().eq('thread_id', data.id)
      if (data.messages.length) {
        const rows = data.messages.map((m) => ({
          id: m.id,
          thread_id: data.id,
          org_id: orgId,
          role: m.role,
          content: m.content,
          skill_slug: m.skillSlug || null,
          created_at: m.createdAt,
        }))
        const { error: mErr } = await db.from('chat_messages').insert(rows)
        if (mErr) return { ok: false as const, error: mErr.message }
      }
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

export const deleteChatThread = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, error: 'Database not configured' }
    }
    try {
      const db = getDb()
      const { error } = await db.from('chat_threads').delete().eq('id', data.id)
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })
