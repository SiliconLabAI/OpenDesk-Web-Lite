import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { doctrineFor } from '~/lib/skills/doctrine'
import {
  formatArticlesForPrompt,
  searchNews,
} from '~/lib/medialyst/client'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import type { ProviderSettings } from '~/lib/settings/types'
import { getDb, hasDb } from '~/lib/db/server'
import {
  hasManusConfig,
  manusCreateTask,
  manusListMessages,
  extractManusResults,
} from '~/lib/manus/client'

const SettingsPartial = z
  .object({
    preferredLlm: z
      .enum(['auto', 'anthropic', 'openai', 'openai_compatible'])
      .optional(),
    anthropicApiKey: z.string().optional(),
    anthropicModel: z.string().optional(),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().optional(),
    openaiBaseUrl: z.string().optional(),
    openaiCompatibleEnabled: z.boolean().optional(),
    openaiCompatibleBaseUrl: z.string().optional(),
    openaiCompatibleApiKey: z.string().optional(),
    openaiCompatibleModel: z.string().optional(),
    medialystApiKey: z.string().optional(),
    medialystApiBase: z.string().optional(),
    manusApiKey: z.string().optional(),
    appUrl: z.string().optional(),
    slackWebhookUrl: z.string().optional(),
  })
  .optional()

function fingerprint(title: string, url?: string): string {
  const base = `${(url || '').toLowerCase().trim()}|${title.toLowerCase().trim()}`
  let h = 0
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0
  return `fp_${Math.abs(h).toString(36)}_${base.slice(0, 40).replace(/\W+/g, '_')}`
}

async function fetchNewsViaManus(
  topics: string[],
  settings: ProviderSettings,
): Promise<{ articles: Array<{ title: string; url?: string; outlet?: string; published_at?: string; snippet?: string }>; note: string }> {
  if (!hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
    return { articles: [], note: 'No Medialyst and no Manus — LLM will judge profile-only context.' }
  }
  const prompt = `You are a news research agent for a PR tool.

Search the live web for recent news (last 7–14 days) about these topics:
${topics.map((t) => `- ${t}`).join('\n')}

Return a concise markdown list of up to 15 articles. For each item include:
- Title
- Outlet
- Approximate publish date (ISO if possible)
- URL
- One-line snippet

Only real articles you can verify from search. Do not invent URLs.`

  try {
    const task = await manusCreateTask(
      {
        title: `newsjack news research: ${topics[0] || 'topics'}`,
        prompt,
        agentProfile: 'lite',
      },
      { apiKey: settings.manusApiKey || undefined },
    )
    // Best-effort poll once for quick text (webhook still handles long jobs elsewhere)
    await new Promise((r) => setTimeout(r, 8000))
    let text = ''
    try {
      const msgs = await manusListMessages(task.task_id, 10, {
        apiKey: settings.manusApiKey || undefined,
      })
      text = extractManusResults(msgs).text
    } catch {
      text = ''
    }
    return {
      articles: [],
      note: text
        ? `Manus research (task ${task.task_id}):\n${text}`
        : `Manus task started: ${task.task_id} (${task.task_url || 'no url'}). Results may still be running — check Manus or Runs after webhook.`,
    }
  } catch (e) {
    return {
      articles: [],
      note: `Manus research failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function runDetectorForMonitor(
  monitorId: string,
  clientSettings?: Partial<ProviderSettings> | null,
): Promise<{
  ok: boolean
  jobId?: string
  output?: string
  error?: string
  newSignals?: number
}> {
  if (!hasDb()) {
    return { ok: false, error: 'Database not configured' }
  }
  const settings = resolveSettings(clientSettings)
  const db = getDb()

  const { data: monitor, error: mErr } = await db
    .from('monitors')
    .select('*, clients(*)')
    .eq('id', monitorId)
    .single()
  if (mErr || !monitor) {
    return { ok: false, error: mErr?.message || 'Monitor not found' }
  }

  const client = monitor.clients as {
    name?: string
    standing?: string
    beats?: string
    competitors?: string
  } | null

  const topics: string[] = monitor.topics?.length
    ? monitor.topics
    : [client?.name || monitor.title].filter(Boolean)

  const allArticles: Array<{
    title: string
    url?: string
    outlet?: string
    published_at?: string
    snippet?: string
  }> = []
  let newsSource = 'none'
  let manusNote = ''

  if (settings.medialystApiKey) {
    newsSource = 'medialyst'
    for (const topic of topics.slice(0, 5)) {
      const res = await searchNews(
        { query: topic, limit: 15, recency: '7d' },
        { apiKey: settings.medialystApiKey, baseUrl: settings.medialystApiBase },
      )
      if (res.ok) {
        for (const a of res.articles) {
          if (a.title) {
            allArticles.push({
              title: a.title,
              url: a.url,
              outlet: a.outlet,
              published_at: a.published_at,
              snippet: a.snippet,
            })
          }
        }
      }
    }
  } else {
    newsSource = 'manus_fallback'
    const man = await fetchNewsViaManus(topics, settings)
    manusNote = man.note
  }

  const { data: seenRows } = await db
    .from('seen_signals')
    .select('fingerprint')
    .eq('org_id', monitor.org_id)
    .eq('monitor_id', monitorId)
    .limit(5000)

  const seen = new Set(
    (seenRows || []).map((r: { fingerprint: string }) => r.fingerprint),
  )
  const fresh = allArticles.filter((a) => {
    const fp = fingerprint(a.title, a.url)
    return !seen.has(fp)
  })

  const profileBlock = [
    `Client: ${client?.name || 'unknown'}`,
    client?.standing ? `Standing:\n${client.standing}` : null,
    client?.beats ? `Beats:\n${client.beats}` : null,
    client?.competitors ? `Competitors:\n${client.competitors}` : null,
    `Monitor topics: ${topics.join(', ')}`,
    `News source: ${newsSource}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const headlinesBlock =
    fresh.length > 0
      ? formatArticlesForPrompt(fresh)
      : allArticles.length > 0
        ? '(all fetched articles already seen)\n' +
          formatArticlesForPrompt(allArticles.slice(0, 10))
        : manusNote ||
          '(no articles fetched — configure Medialyst or Manus in Settings)'

  const system = doctrineFor('newsjack-detector')
  const user = `## Client / monitor profile
${profileBlock}

## Candidate signals
${headlinesBlock}

Run coarse relevance + triage + detector judgment.`

  let outputText: string
  try {
    const { text, provider } = await callLlm(settings, system, user)
    outputText = `_(judge via ${provider})_\n\n${text}`
  } catch (e) {
    outputText = `## Detector offline\n\n${e instanceof Error ? e.message : String(e)}\n\n### Candidates\n${headlinesBlock}`
  }

  const { data: job, error: jErr } = await db
    .from('jobs')
    .insert({
      org_id: monitor.org_id,
      client_id: monitor.client_id,
      monitor_id: monitorId,
      kind: 'detector_run',
      skill_slug: 'newsjack-detector',
      status: 'completed',
      input: {
        monitor_id: monitorId,
        topics,
        news_source: newsSource,
        candidate_count: fresh.length,
      },
      output_text: outputText,
      output: {
        news_source: newsSource,
        fresh_count: fresh.length,
        total_fetched: allArticles.length,
      },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (jErr) {
    return { ok: false, error: jErr.message, output: outputText }
  }

  let newSignals = 0
  for (const a of fresh.slice(0, 50)) {
    const fp = fingerprint(a.title, a.url)
    const { error } = await db.from('seen_signals').upsert(
      {
        org_id: monitor.org_id,
        monitor_id: monitorId,
        fingerprint: fp,
        title: a.title,
        url: a.url || null,
        first_public_at: a.published_at || null,
      },
      { onConflict: 'org_id,fingerprint' },
    )
    if (!error) newSignals++
  }

  await db
    .from('monitors')
    .update({ last_run_at: new Date().toISOString() })
    .eq('id', monitorId)

  const slack =
    settings.slackWebhookUrl ||
    undefined
  if (slack?.startsWith('https://')) {
    try {
      await fetch(slack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*Newsjack detector — ${monitor.title}*\n${outputText.slice(0, 3500)}`,
        }),
      })
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    jobId: job.id,
    output: outputText,
    newSignals,
  }
}

export const runDetectorJob = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      monitorId: z.string().uuid(),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) =>
    runDetectorForMonitor(data.monitorId, data.settings),
  )

export const runAllEnabledMonitors = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      cronSecret: z.string().optional(),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    const expected = process.env.CRON_SECRET
    if (expected && data.cronSecret !== expected) {
      return { ok: false as const, error: 'Unauthorized', results: [] }
    }
    if (!hasDb()) {
      return { ok: false as const, error: 'No database', results: [] }
    }
    const db = getDb()
    const { data: monitors } = await db
      .from('monitors')
      .select('id')
      .eq('enabled', true)
      .limit(50)
    const results = []
    for (const m of monitors || []) {
      results.push(await runDetectorForMonitor(m.id, data.settings))
    }
    return { ok: true as const, results }
  })
