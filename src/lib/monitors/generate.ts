import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'

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

export const generateMonitorDraft = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      profile: z.string().min(1),
      hint: z.string().optional(),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    const system = `You design a newsjack monitor (newsjack-monitor-setup).
Return ONLY JSON:
{
  "title": "short monitor title",
  "slug": "kebab-case-slug",
  "clientName": "company name",
  "topics": "comma-separated topic keywords for news search",
  "scheduleCron": "0 9 * * *"
}
Topics should be concrete search phrases, not vague. No invented customers.`

    const user = `## Client profile
${data.profile}

## User hint
${data.hint || '(none — infer from profile)'}

Return JSON only.`

    try {
      const { text, provider } = await callLlm(settings, system, user)
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) {
        return { ok: false as const, error: 'No JSON in model response' }
      }
      const obj = JSON.parse(match[0]) as Record<string, unknown>
      return {
        ok: true as const,
        provider,
        draft: {
          title: String(obj.title || ''),
          slug: String(obj.slug || ''),
          clientName: String(obj.clientName || ''),
          topics: String(obj.topics || ''),
          scheduleCron: String(obj.scheduleCron || '0 9 * * *'),
        },
      }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })
