import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { hasManusConfig, manusCreateTask } from '~/lib/manus/client'
import {
  coverageReelPrompt,
  pressClipPrompt,
  PRESS_CLIP_SCHEMA,
} from '~/lib/manus/prompts'
import { getDb, hasDb } from '~/lib/db/server'

const PressClipInput = z.object({
  orgId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  url: z.string().url(),
  mention: z.string().min(1),
  brandNotes: z.string().optional(),
  manusApiKey: z.string().optional(),
})

const CoverageReelInput = z.object({
  orgId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  notes: z.string().min(10),
  brandNotes: z.string().optional(),
  formats: z.string().optional(),
  manusApiKey: z.string().optional(),
})

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001'

async function ensureDemoOrg(orgId: string) {
  if (!hasDb()) return
  const db = getDb()
  await db.from('orgs').upsert({ id: orgId, name: 'Default' }, { onConflict: 'id' })
}

export const startPressClipJob = createServerFn({ method: 'POST' })
  .validator(PressClipInput)
  .handler(async ({ data }) => {
    const manusCtx = data.manusApiKey ? { apiKey: data.manusApiKey } : undefined
    if (!hasManusConfig(manusCtx)) {
      return {
        ok: false as const,
        error:
          'MANUS_API_KEY not configured. Add it in Settings or env.',
        jobId: null as string | null,
      }
    }

    const orgId = data.orgId || process.env.DEFAULT_ORG_ID || DEFAULT_ORG
    const prompt = pressClipPrompt({
      url: data.url,
      mention: data.mention,
      brandNotes: data.brandNotes,
    })

    const task = await manusCreateTask({
      title: `press-clip: ${data.mention}`,
      prompt,
      structuredOutputSchema: PRESS_CLIP_SCHEMA as unknown as Record<string, unknown>,
    }, manusCtx)

    let jobId: string | null = null
    if (hasDb()) {
      await ensureDemoOrg(orgId)
      const db = getDb()
      const { data: row, error } = await db
        .from('jobs')
        .insert({
          org_id: orgId,
          client_id: data.clientId || null,
          kind: 'press_clip',
          skill_slug: 'press-clip',
          status: 'waiting_manus',
          input: {
            url: data.url,
            mention: data.mention,
            brandNotes: data.brandNotes,
          },
          manus_task_id: task.task_id,
          manus_task_url: task.task_url || null,
        })
        .select('id')
        .single()
      if (error) {
        return {
          ok: false as const,
          error: error.message,
          jobId: null,
          manusTaskId: task.task_id,
          manusTaskUrl: task.task_url,
        }
      }
      jobId = row.id
    }

    return {
      ok: true as const,
      jobId,
      manusTaskId: task.task_id,
      manusTaskUrl: task.task_url,
      message:
        'Press-clip task started on Manus. Results arrive via webhook when the browser job completes.',
    }
  })

export const startCoverageReelJob = createServerFn({ method: 'POST' })
  .validator(CoverageReelInput)
  .handler(async ({ data }) => {
    const manusCtx = data.manusApiKey ? { apiKey: data.manusApiKey } : undefined
    if (!hasManusConfig(manusCtx)) {
      return {
        ok: false as const,
        error: 'MANUS_API_KEY not configured. Add it in Settings or env.',
        jobId: null as string | null,
      }
    }

    const orgId = data.orgId || process.env.DEFAULT_ORG_ID || DEFAULT_ORG
    const prompt = coverageReelPrompt({
      notes: data.notes,
      brandNotes: data.brandNotes,
      formats: data.formats,
    })

    const task = await manusCreateTask({
      title: 'coverage-reel',
      prompt,
      agentProfile: 'standard',
    }, manusCtx)

    let jobId: string | null = null
    if (hasDb()) {
      await ensureDemoOrg(orgId)
      const db = getDb()
      const { data: row, error } = await db
        .from('jobs')
        .insert({
          org_id: orgId,
          client_id: data.clientId || null,
          kind: 'coverage_reel',
          skill_slug: 'coverage-reel',
          status: 'waiting_manus',
          input: {
            notes: data.notes,
            brandNotes: data.brandNotes,
            formats: data.formats,
          },
          manus_task_id: task.task_id,
          manus_task_url: task.task_url || null,
        })
        .select('id')
        .single()
      if (error) {
        return {
          ok: false as const,
          error: error.message,
          jobId: null,
          manusTaskId: task.task_id,
          manusTaskUrl: task.task_url,
        }
      }
      jobId = row.id
    }

    return {
      ok: true as const,
      jobId,
      manusTaskId: task.task_id,
      manusTaskUrl: task.task_url,
      message:
        'Coverage-reel task started on Manus. Webhook will update the job when complete.',
    }
  })

export const getJob = createServerFn({ method: 'GET' })
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, error: 'Database not configured', job: null }
    }
    const db = getDb()
    const { data: job, error } = await db
      .from('jobs')
      .select('*')
      .eq('id', data.jobId)
      .single()
    if (error) return { ok: false as const, error: error.message, job: null }
    return { ok: true as const, job }
  })
