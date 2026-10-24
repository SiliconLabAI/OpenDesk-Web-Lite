import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { manusRegisterWebhook, hasManusConfig } from '~/lib/manus/client'
import { resolveSettings } from './resolve'

const SettingsPartial = z.object({
  manusApiKey: z.string().optional(),
  appUrl: z.string().optional(),
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
  slackWebhookUrl: z.string().optional(),
})

export const registerManusWebhook = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      manusApiKey: z.string().min(1),
      appUrl: z.string().url(),
    }),
  )
  .handler(async ({ data }) => {
    const callback = `${data.appUrl.replace(/\/$/, '')}/api/webhooks/manus`
    try {
      const result = await manusRegisterWebhook(callback, {
        apiKey: data.manusApiKey,
      })
      return {
        ok: true as const,
        callback,
        webhook: result.webhook || result,
      }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        callback,
      }
    }
  })

export const getServerEnvHints = createServerFn({ method: 'GET' }).handler(
  async () => {
    return {
      hasAnthropicEnv: Boolean(process.env.ANTHROPIC_API_KEY),
      hasOpenaiEnv: Boolean(process.env.OPENAI_API_KEY),
      hasCompatibleEnv: Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL),
      hasMedialystEnv: Boolean(process.env.MEDIALYST_API_KEY),
      hasManusEnv: Boolean(process.env.MANUS_API_KEY),
      appUrlEnv: process.env.APP_URL || '',
    }
  },
)
