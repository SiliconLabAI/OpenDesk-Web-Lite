import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb, hasDb } from '~/lib/db/server'
import { runDetectorJob } from '~/lib/detector/run'
import { loadSettings } from '~/lib/settings/client'
import {
  loadProfile,
  profileToPromptBlock,
} from '~/lib/profile'
import { generateMonitorDraft } from '~/lib/monitors/generate'

const listMonitors = createServerFn({ method: 'GET' }).handler(async () => {
  if (!hasDb()) {
    return { ok: false as const, monitors: [], error: 'Database not configured' }
  }
  const db = getDb()
  const { data, error } = await db
    .from('monitors')
    .select('*, clients(name)')
    .order('created_at', { ascending: false })
  if (error) return { ok: false as const, monitors: [], error: error.message }
  return { ok: true as const, monitors: data || [] }
})

const createMonitor = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1),
      slug: z.string().min(1),
      topics: z.string(),
      scheduleCron: z.string().default('0 9 * * *'),
      clientName: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, error: 'Database not configured' }
    }
    const orgId =
      process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001'
    const db = getDb()
    await db.from('orgs').upsert({ id: orgId, name: 'Default' }, { onConflict: 'id' })

    const clientSlug = data.clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const { data: client, error: cErr } = await db
      .from('clients')
      .upsert(
        {
          org_id: orgId,
          slug: clientSlug,
          name: data.clientName,
        },
        { onConflict: 'org_id,slug' },
      )
      .select('id')
      .single()
    if (cErr) return { ok: false as const, error: cErr.message }

    const topics = data.topics
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean)

    const { error } = await db.from('monitors').insert({
      org_id: orgId,
      client_id: client.id,
      slug: data.slug,
      title: data.title,
      topics,
      schedule_cron: data.scheduleCron,
      enabled: true,
    })
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  })

const deleteMonitor = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, error: 'Database not configured' }
    }
    const db = getDb()
    await db.from('seen_signals').delete().eq('monitor_id', data.id)
    const { error } = await db.from('monitors').delete().eq('id', data.id)
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  })

export const Route = createFileRoute('/monitors/')({
  loader: () => listMonitors(),
  component: MonitorsPage,
})

function MonitorsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [clientName, setClientName] = useState('')
  const [topics, setTopics] = useState('')
  const [aiHint, setAiHint] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    const res = await createMonitor({
      data: {
        title,
        slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        topics,
        clientName,
        scheduleCron: '0 9 * * *',
      },
    })
    setMsg(res.ok ? 'Monitor saved.' : res.error || 'Failed')
    if (res.ok) router.invalidate()
  }

  async function onDelete(id: string, t: string) {
    if (!confirm(`Remove monitor “${t}”? This cannot be undone.`)) return
    const res = await deleteMonitor({ data: { id } })
    setMsg(res.ok ? 'Monitor removed.' : res.error || 'Delete failed')
    if (res.ok) router.invalidate()
  }

  async function onAiGenerate() {
    const profile = profileToPromptBlock(loadProfile())
    if (!profile.trim()) {
      setMsg('Save a client profile first (Profile page), then generate.')
      return
    }
    setBusy(true)
    setMsg('Generating monitor from profile…')
    try {
      const res = await generateMonitorDraft({
        data: {
          profile,
          hint: aiHint || undefined,
          settings: loadSettings(),
        },
      })
      if (res.ok && res.draft) {
        setTitle(res.draft.title)
        setSlug(res.draft.slug)
        setClientName(res.draft.clientName || loadProfile().name)
        setTopics(res.draft.topics)
        setMsg(`AI draft ready via ${res.provider}. Review and Create.`)
      } else {
        setMsg(res.error || 'Generate failed')
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Monitors</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Full Mode monitoring profiles. Create manually or let AI draft from your
          client profile.
        </p>
      </div>

      {!data.ok && (
        <p className="text-sm text-[var(--muted)]">{data.error}</p>
      )}

      <ul className="space-y-2">
        {(data.monitors || []).map(
          (m: {
            id: string
            title: string
            slug: string
            enabled: boolean
            schedule_cron: string
            topics: string[]
            clients?: { name: string } | null
          }) => (
            <li
              key={m.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {m.title}{' '}
                    <span className="text-xs text-[var(--muted)]">/{m.slug}</span>
                  </div>
                  <div className="text-sm text-[var(--muted)] mt-1">
                    Client: {m.clients?.name || '—'} · cron {m.schedule_cron} ·{' '}
                    {m.enabled ? 'enabled' : 'paused'}
                  </div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    Topics: {(m.topics || []).join(', ') || '—'}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-red-400/90 hover:text-red-300 shrink-0"
                  onClick={() => onDelete(m.id, m.title)}
                >
                  Remove
                </button>
              </div>
              <button
                type="button"
                className="mt-2 text-xs underline text-[var(--accent-dim)]"
                onClick={async () => {
                  setMsg('Running detector…')
                  const res = await runDetectorJob({
                    data: {
                      monitorId: m.id,
                      settings: loadSettings(),
                    },
                  })
                  setMsg(
                    res.ok
                      ? `Detector done. Job ${res.jobId || ''} · ${res.newSignals ?? 0} new signals`
                      : res.error || 'Failed',
                  )
                }}
              >
                Run detector now
              </button>
            </li>
          ),
        )}
      </ul>

      <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">New monitor</h2>

        <div className="rounded-lg border border-dashed border-[var(--border)] p-3 space-y-2 bg-[var(--bg)]/40">
          <div className="text-xs text-[var(--muted)]">
            AI from profile ({loadProfile().name || 'no profile name'})
          </div>
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="Optional hint — e.g. focus on EU regulation"
            value={aiHint}
            onChange={(e) => setAiHint(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={onAiGenerate}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40"
          >
            {busy ? 'Generating…' : 'Generate with AI'}
          </button>
        </div>

        <form onSubmit={onCreate} className="space-y-3">
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="Slug (optional)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="Client name"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
          />
          <textarea
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="Topics (comma or newline separated)"
            rows={3}
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#0a0a0b' }}
          >
            Create monitor
          </button>
        </form>
      </div>

      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
    </div>
  )
}
