import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import { getSkill } from '~/lib/skills/catalog'
import { doctrineFor } from '~/lib/skills/doctrine'
import { enrichSkillInputs } from '~/lib/auto/research'
import { writeAppLog } from '~/lib/logs/write'
import { hasManusConfig } from '~/lib/manus/client'
import { startChatResearch } from '~/lib/chat/researchJob'
import {
  formatArticlesForPrompt,
  searchNews,
} from '~/lib/medialyst/client'

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

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})

function isTrivialUserMessage(s: string) {
  const t = s.trim().toLowerCase()
  if (t.length < 8) return true
  return /^(hi|hello|hey|yo|test|ok|thanks|thank you)[.!?]*$/i.test(t)
}

function needsLiveResearch(slug: string | undefined, skillNeedsNews?: boolean) {
  if (!slug) return false
  if (skillNeedsNews) return true
  return [
    'newsjack-detector',
    'news-search',
    'story-origin-check',
    'newsjack-triage',
    'coverage-tracker',
    'pr-calendar',
    'find-journalists',
    'newsworthiness-check',
    'angle-generator',
    'reactive-comment',
  ].includes(slug)
}

export const runChat = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      messages: z.array(MessageSchema).min(1),
      skillSlug: z.string().optional(),
      skillValues: z.record(z.string()).optional(),
      profile: z.string().min(1),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const settings = resolveSettings(data.settings)
      const skill = data.skillSlug ? getSkill(data.skillSlug) : undefined
      const lastUser =
        [...data.messages].reverse().find((m) => m.role === 'user')?.content ||
        ''

      const wantResearch =
        Boolean(skill && needsLiveResearch(skill.slug, skill.needsNewsApi)) &&
        !isTrivialUserMessage(lastUser)

      // --- Path A: live research via Medialyst (sync) or Manus job (async callback) ---
      if (wantResearch && skill) {
        // Medialyst sync path
        if (settings.medialystApiKey) {
          const res = await searchNews(
            { query: lastUser.slice(0, 300) || skill.name, limit: 15 },
            {
              apiKey: settings.medialystApiKey,
              baseUrl: settings.medialystApiBase,
            },
          )
          if (res.ok && res.articles?.length) {
            const liveResearch = `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
            const system = `You are Newsjack Web. Use the live research below. Do not invent articles.

## Client profile
${data.profile}

## Skill /${skill.slug}
${doctrineFor(skill.slug)}

## Live research
${liveResearch}`
            const history = data.messages
              .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
              .join('\n\n')
            const { text, provider } = await callLlm(
              settings,
              system,
              `Conversation:\n\n${history}\n\nRespond using the research.`,
            )
            return {
              ok: true as const,
              content: text,
              provider,
              usedLiveResearch: true,
              pending: false as const,
            }
          }
        }

        // Manus async — create task + job; client polls / webhook completes
        if (hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
          const started = await startChatResearch({
            data: {
              messages: data.messages,
              skillSlug: skill.slug,
              skillValues: data.skillValues,
              profile: data.profile,
              settings: data.settings,
            },
          })
          if (!started.ok) {
            return {
              ok: false as const,
              error: started.error || 'Failed to start Manus research',
              content: `**Error:** ${started.error}`,
              pending: false as const,
            }
          }
          return {
            ok: true as const,
            content: started.content,
            provider: 'manus-pending',
            pending: true as const,
            jobId: started.jobId,
            manusTaskId: started.manusTaskId,
            manusTaskUrl: started.manusTaskUrl,
            usedLiveResearch: false,
          }
        }

        return {
          ok: false as const,
          error: 'No Medialyst or Manus configured for live research',
          content:
            '**Error:** Configure Medialyst or Manus API key in Settings for live news research.',
          pending: false as const,
        }
      }

      // --- Path B: normal chat / skill without live research ---
      let skillContext = ''
      if (skill) {
        let values = data.skillValues || {}
        const empty = Object.fromEntries(
          skill.inputs.map((i) => [i.id, values[i.id] || '']),
        )
        try {
          const enriched = await enrichSkillInputs({
            data: {
              slug: skill.slug,
              values: empty,
              profile: data.profile,
              settings: data.settings,
            },
          })
          if (enriched.ok) values = { ...empty, ...enriched.values, ...values }
        } catch {
          values = empty
        }
        const filled = skill.inputs
          .map((i) => {
            const v = values[i.id]?.trim()
            return v ? `### ${i.label}\n${v}` : null
          })
          .filter(Boolean)
          .join('\n\n')
        skillContext = `
## Attached skill: /${skill.slug}
${doctrineFor(skill.slug)}
### Form context
${filled || '(from profile + message)'}
`
      }

      const system = `You are Newsjack Web, a PR agent chat.
Ethics: no invented facts, journalists, or headlines.
## Client profile
${data.profile}
${skillContext}
Respond in clear markdown. If the user needs live news, ask them to attach a detect skill or configure Manus.`

      const history = data.messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n')
      const { text, provider } = await callLlm(
        settings,
        system,
        `Conversation:\n\n${history}\n\nRespond to the latest user message.`,
      )

      await writeAppLog({
        level: 'info',
        kind: 'chat',
        source: 'runChat',
        message: `sync reply via ${provider}`,
        response: { text_preview: text.slice(0, 400) },
      })

      return {
        ok: true as const,
        content: text,
        provider,
        pending: false as const,
        usedLiveResearch: false,
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      await writeAppLog({
        level: 'error',
        kind: 'chat',
        source: 'runChat',
        message: 'runChat failed',
        error: err,
      })
      return {
        ok: false as const,
        error: err,
        content: `**Error:** ${err}`,
        pending: false as const,
      }
    }
  })
