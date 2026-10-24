import type { ProviderSettings } from '~/lib/settings/types'
import {
  formatArticlesForPrompt,
  lookupJournalists,
  queryPrCalendar,
  searchNews,
} from '~/lib/medialyst/client'
import {
  hasManusConfig,
  manusRunAndWait,
} from '~/lib/manus/client'
import { getSkill } from './catalog'

/**
 * Live web research via Manus when Medialyst is unavailable.
 */
export async function manusResearchPrompt(
  prompt: string,
  settings: ProviderSettings,
): Promise<string> {
  if (!hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
    return ''
  }
  try {
    // Pure agent task — no Playwright / connectors required
    const result = await manusRunAndWait(
      {
        title: `newsjack research: ${prompt.slice(0, 40)}`,
        prompt,
        agentProfile: 'standard',
        timeoutMs: 180_000,
        intervalMs: 3_000,
      },
      { apiKey: settings.manusApiKey || undefined },
    )
    if (result.text) {
      const link = result.taskUrl ? ` — ${result.taskUrl}` : ''
      return `### Manus live research (task ${result.taskId}${link})\n${result.text}`
    }
    const link = result.taskUrl ? ` — open: ${result.taskUrl}` : ''
    const hints = (result as { statusHints?: string[] }).statusHints?.join('; ') || 'no status'
    return `### Manus research pending\nTask \`${result.taskId}\`${link}.\nWait timed out (${hints}). Do not invent coverage; user can open the Manus link.`
  } catch (e) {
    return `### Manus research failed\n${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * Medialyst first; Manus browser/web research as fallback.
 */
export async function fetchToolContext(
  slug: string,
  values: Record<string, string>,
  settings: ProviderSettings,
  opts?: { userMessage?: string; profile?: string },
): Promise<string | undefined> {
  const hasMedialyst = Boolean(settings.medialystApiKey)
  const ctx = hasMedialyst
    ? { apiKey: settings.medialystApiKey, baseUrl: settings.medialystApiBase }
    : undefined
  const skill = getSkill(slug)
  const needsLive =
    Boolean(skill?.needsNewsApi) ||
    [
      'news-search',
      'story-origin-check',
      'newsjack-detector',
      'newsjack-triage',
      'coverage-tracker',
      'pr-calendar',
      'find-journalists',
      'journalist-fit-check',
      'same-outlet-ranker',
      'newsworthiness-check',
      'angle-generator',
      'reactive-comment',
    ].includes(slug)

  if (slug === 'news-search' || slug === 'story-origin-check') {
    const q = values.query || values.story || values.item || opts?.userMessage || ''
    if (!q.trim()) return undefined
    if (hasMedialyst) {
      const res = await searchNews({ query: q, limit: 15 }, ctx)
      if (res.ok) {
        return `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
      }
    }
    return (
      (await manusResearchPrompt(
        `Search the live web for recent news articles about: ${q}

Return up to 12 real articles with title, outlet, publish date, URL, and one-line snippet. Do not invent URLs.`,
        settings,
      )) || undefined
    )
  }

  if (slug === 'pr-calendar') {
    const q = values.company || values.query || opts?.userMessage || ''
    if (!q.trim()) return undefined
    if (hasMedialyst) {
      const res = await queryPrCalendar(
        { query: q, horizon: values.horizon },
        ctx,
      )
      if (res.ok) {
        return `### Medialyst PR calendar\n\`\`\`json\n${JSON.stringify(res.events, null, 2).slice(0, 8000)}\n\`\`\``
      }
    }
    return (
      (await manusResearchPrompt(
        `Build a 6-month PR calendar of real upcoming hooks, awareness days, conferences, and news pegs relevant to: ${q}
Horizon: ${values.horizon || '6 months'}
List dated moments with why they matter for PR. Prefer verifiable public events.`,
        settings,
      )) || undefined
    )
  }

  if (slug === 'find-journalists' || slug === 'journalist-fit-check' || slug === 'same-outlet-ranker') {
    const brief =
      values.brief ||
      values.journalist ||
      values.candidates ||
      values.pitch ||
      opts?.userMessage ||
      ''
    const candidates = values.candidates || ''
    if (hasMedialyst && slug === 'find-journalists') {
      const res = await lookupJournalists(
        {
          query: brief.slice(0, 500),
          names: candidates
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 10),
        },
        ctx,
      )
      if (res.ok) {
        return `### Medialyst journalist lookup\n\`\`\`json\n${JSON.stringify(res.journalists, null, 2).slice(0, 8000)}\n\`\`\``
      }
    }
    return (
      (await manusResearchPrompt(
        `Research real journalists/outlets relevant to this PR brief. Do not invent emails or bylines you cannot verify.

Brief / context:
${brief}

Seed candidates:
${candidates || '(none)'}

Profile context:
${(opts?.profile || '').slice(0, 1500)}

For each journalist: name, outlet, beat, 1–2 recent relevant pieces with URLs if found, and fit notes.`,
        settings,
      )) || undefined
    )
  }

  if (
    slug === 'newsjack-detector' ||
    slug === 'coverage-tracker' ||
    slug === 'newsjack-triage' ||
    slug === 'newsworthiness-check' ||
    slug === 'angle-generator' ||
    slug === 'reactive-comment'
  ) {
    const q =
      values.company ||
      values.keywords ||
      values.profile ||
      values.signals ||
      values.config ||
      values.hits ||
      values.item ||
      values.update ||
      values.request ||
      opts?.userMessage ||
      ''
    const query = (q || opts?.profile || '').split('\n')[0].slice(0, 300)
    if (!query.trim() && !needsLive) return undefined
    if (hasMedialyst && query.trim()) {
      const res = await searchNews({ query, limit: 20 }, ctx)
      if (res.ok) {
        return `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
      }
    }
    if (needsLive || query.trim()) {
      return (
        (await manusResearchPrompt(
          `Search recent live news relevant to this PR skill (${slug}).

Query / context:
${(q || opts?.userMessage || '').slice(0, 2000)}

Client profile:
${(opts?.profile || '').slice(0, 1500)}

Return dated headlines with outlets and URLs when possible. Do not invent articles.`,
          settings,
        )) || undefined
      )
    }
  }

  // Generic: any skill that needsNewsApi but wasn't matched above
  if (needsLive) {
    const blob = [
      opts?.userMessage,
      ...Object.values(values),
      opts?.profile?.slice(0, 800),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2500)
    if (!blob.trim()) return undefined
    if (hasMedialyst) {
      const q = blob.split('\n')[0].slice(0, 200)
      const res = await searchNews({ query: q, limit: 15 }, ctx)
      if (res.ok) {
        return `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
      }
    }
    return (
      (await manusResearchPrompt(
        `Live web research for newsjack skill /${slug}:\n${blob}\n\nReturn real recent coverage with titles, outlets, dates, URLs. Do not invent.`,
        settings,
      )) || undefined
    )
  }

  return undefined
}

export function researchCoverageNote(
  extra: string | undefined,
  settings: ProviderSettings,
): string {
  if (extra && (extra.includes('Medialyst') || extra.includes('Manus live'))) {
    return `LIVE RESEARCH ATTACHED: treat the tool-fetched block as real evidence. Do NOT say "Reduced Coverage Mode" or claim live search is unavailable.`
  }
  if (extra && extra.includes('Manus research started')) {
    return `Manus research was started; use any partial results. Do not invent articles. You may note research is still completing.`
  }
  if (extra && extra.includes('Manus research failed')) {
    return `Manus research failed. State that clearly. Still do not invent coverage.`
  }
  const hasAny =
    Boolean(settings.medialystApiKey) ||
    Boolean(settings.manusApiKey) ||
    Boolean(process.env.MEDIALYST_API_KEY) ||
    Boolean(process.env.MANUS_API_KEY)
  if (!hasAny) {
    return `No Medialyst or Manus keys configured. Work only from user/profile inputs; do not invent live news. Suggest adding Medialyst or Manus in Settings.`
  }
  return `No live research block returned for this turn. Do not invent articles; ask for a tighter query or wait for research.`
}
