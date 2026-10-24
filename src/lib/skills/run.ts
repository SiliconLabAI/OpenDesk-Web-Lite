import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSkill } from './catalog'
import { buildSystemPrompt, buildUserPrompt, offlineDemoResult } from './prompts'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import { fetchToolContext } from './toolContext'
import { writeAppLog } from '~/lib/logs/write'

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

const RunInput = z.object({
  slug: z.string(),
  values: z.record(z.string()),
  profile: z.string().optional(),
  settings: SettingsPartial,
})

export const runSkill = createServerFn({ method: 'POST' })
  .validator(RunInput)
  .handler(async ({ data }) => {
    const skill = getSkill(data.slug)
    if (!skill) {
      return { ok: false as const, error: 'Unknown skill', output: '' }
    }

    const settings = resolveSettings(data.settings)
    const system = buildSystemPrompt(skill)
    let extra: string | undefined
    try {
      extra = await fetchToolContext(skill.slug, data.values, settings, {
        profile: data.profile,
      })
    } catch (e) {
      extra = `Tool context failed: ${e instanceof Error ? e.message : String(e)}`
    }
    const user = buildUserPrompt(skill, data.values, data.profile, extra)

    try {
      await writeAppLog({
        level: 'info',
        kind: 'skill',
        source: 'runSkill',
        message: `/${skill.slug}`,
        request: {
          slug: skill.slug,
          value_keys: Object.keys(data.values),
          extra_len: extra?.length || 0,
        },
      })
      const { text, provider } = await callLlm(settings, system, user)
      await writeAppLog({
        level: 'info',
        kind: 'skill',
        source: 'runSkill',
        message: `/${skill.slug} via ${provider}`,
        response: { text_preview: text.slice(0, 600) },
      })
      return {
        ok: true as const,
        provider,
        output: text,
        usedMedialyst: Boolean(extra && extra.includes('Medialyst')),
        usedManus: Boolean(extra && extra.includes('Manus')),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await writeAppLog({
        level: 'error',
        kind: 'skill',
        source: 'runSkill',
        message: `/${skill.slug} failed`,
        error: msg,
      })
      return {
        ok: false as const,
        error: msg,
        output: offlineDemoResult(skill, data.values),
      }
    }
  })

export const testLlmConnection = createServerFn({ method: 'POST' })
  .validator(z.object({ settings: SettingsPartial }))
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    try {
      const { text, provider } = await callLlm(
        settings,
        'Reply with exactly: ok',
        'ping',
      )
      return { ok: true as const, provider, sample: text.slice(0, 80) }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })
