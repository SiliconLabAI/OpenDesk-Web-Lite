import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import {
  hasManusConfig,
  manusCreateTask,
  manusListMessages,
  extractManusResults,
} from '~/lib/manus/client'
import { searchNews } from '~/lib/medialyst/client'
import type { ClientProfile } from '~/lib/profile'
import { getSkill } from '~/lib/skills/catalog'

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

export type ResearchedProfile = ClientProfile & {
  website?: string
}

function parseProfileJson(text: string): Partial<ClientProfile> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>
    return {
      name: typeof obj.name === 'string' ? obj.name : '',
      standing: typeof obj.standing === 'string' ? obj.standing : '',
      beats: typeof obj.beats === 'string' ? obj.beats : '',
      competitors: typeof obj.competitors === 'string' ? obj.competitors : '',
      notes: typeof obj.notes === 'string' ? obj.notes : '',
    }
  } catch {
    return null
  }
}

/**
 * Build a structured client profile from a website URL.
 * Returns JSON fields that map 1:1 to the Profile page form.
 * standing / beats / competitors / notes may contain markdown.
 */
export const researchFromWebsite = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      website: z.string().min(3),
      companyName: z.string().optional(),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    let siteText = ''
    let newsBlock = ''

    const url = data.website.startsWith('http')
      ? data.website
      : `https://${data.website}`

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'NewsjackWeb/0.2 (+research)' },
        signal: AbortSignal.timeout(12000),
      })
      const html = await res.text()
      siteText = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 12000)
    } catch (e) {
      siteText = `(Could not fetch site: ${e instanceof Error ? e.message : String(e)})`
    }

    if (settings.medialystApiKey) {
      const q = data.companyName || url
      const news = await searchNews(
        { query: q, limit: 8 },
        { apiKey: settings.medialystApiKey, baseUrl: settings.medialystApiBase },
      )
      if (news.ok) {
        newsBlock = news.articles
          .map(
            (a, i) =>
              `${i + 1}. ${a.title} (${a.outlet || '?'}) ${a.published_at || ''} ${a.url || ''}`,
          )
          .join('\n')
      }
    } else if (hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
      try {
        const task = await manusCreateTask(
          {
            title: `research profile: ${data.companyName || url}`,
            prompt: `Visit ${url} and extract company facts for a PR agent: product, ICP, competitors, spokespeople, beat topics, recent news. Keep under 600 words.`,
            agentProfile: 'lite',
          },
          { apiKey: settings.manusApiKey || undefined },
        )
        await new Promise((r) => setTimeout(r, 10000))
        try {
          const msgs = await manusListMessages(task.task_id, 8, {
            apiKey: settings.manusApiKey || undefined,
          })
          newsBlock =
            extractManusResults(msgs).text ||
            `Manus task ${task.task_id} still running`
        } catch {
          newsBlock = `Manus research task started: ${task.task_id}`
        }
      } catch (e) {
        newsBlock = `Manus fallback failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    const system = `You build PR client profiles for newsjack web.
Return ONLY a JSON object with exactly these string keys:
{
  "name": "Company legal or product name",
  "standing": "Markdown: why this company has authority to speak — expertise, data, customers, founders. Use short paragraphs or bullets.",
  "beats": "Markdown: topic beats journalists care about (bullets ok)",
  "competitors": "Markdown: named competitors and brief positioning",
  "notes": "Markdown: spokespeople, proof assets, risks, open questions"
}
Rules:
- Do not invent funding amounts, customer counts, or quotes not in the sources.
- If unknown, write "Unknown — needs confirmation" for that part of the field.
- standing/beats/competitors/notes may use markdown (lists, bold). name is plain text.
- No preamble, no code fences — raw JSON only.`

    const user = `Company hint: ${data.companyName || '(none)'}
Website: ${url}

## Website extract
${siteText || '(empty)'}

## News / research
${newsBlock || '(none)'}

Return the JSON profile now.`

    try {
      const { text, provider } = await callLlm(settings, system, user)
      const parsed = parseProfileJson(text)
      if (!parsed) {
        return {
          ok: false as const,
          error: 'Model did not return valid profile JSON',
          raw: text,
          provider,
        }
      }
      const profile: ResearchedProfile = {
        name: parsed.name || data.companyName || url,
        standing: parsed.standing || '',
        beats: parsed.beats || '',
        competitors: parsed.competitors || '',
        notes: parsed.notes || '',
        website: url,
      }
      return { ok: true as const, profile, provider, website: url }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

export const enrichSkillInputs = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      slug: z.string(),
      values: z.record(z.string()),
      profile: z.string().optional(),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    const profile = data.profile || ''
    const skill = getSkill(data.slug)
    const fieldGuide =
      skill?.inputs
        .map(
          (i) =>
            `- ${i.id} (${i.label})${i.required ? ' [required]' : ''}: ${i.placeholder}`,
        )
        .join('\n') || Object.keys(data.values).join(', ')
    const exampleHint = skill?.examples
      ? `\n## Example shape (adapt to this client; do not copy blindly)\n${JSON.stringify(skill.examples, null, 2)}`
      : ''

    const system = `You prefill newsjack skill form fields for skill "/${data.slug}"${skill ? ` (${skill.name})` : ''}.
${skill ? `Skill purpose: ${skill.description}` : ''}
Return ONLY a JSON object mapping field ids to string values.
Only fill fields that are currently empty. Prefer facts from the profile and user message.
Do not invent hard news headlines or URLs.
Keys must be from: ${JSON.stringify(Object.keys(data.values))}

Field guide:
${fieldGuide}`

    const user = `## Profile + user context
${profile || '(none)'}

## Current values
${JSON.stringify(data.values, null, 2)}${exampleHint}

Return JSON only.`

    try {
      const { text } = await callLlm(settings, system, user)
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) {
        return {
          ok: true as const,
          values: data.values,
          profile,
          filled: [] as string[],
        }
      }
      const parsed = JSON.parse(match[0]) as Record<string, string>
      const next = { ...data.values }
      const filled: string[] = []
      for (const [k, v] of Object.entries(parsed)) {
        if (
          k in next &&
          !next[k]?.trim() &&
          typeof v === 'string' &&
          v.trim()
        ) {
          next[k] = v
          filled.push(k)
        }
      }
      return { ok: true as const, values: next, profile, filled }
    } catch {
      return {
        ok: true as const,
        values: data.values,
        profile,
        filled: [] as string[],
      }
    }
  })
