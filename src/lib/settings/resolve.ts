import type { ProviderSettings } from './types'
import { DEFAULT_SETTINGS } from './types'

/**
 * Merge client-submitted settings with process.env (env wins when client field empty).
 */
export function resolveSettings(
  client?: Partial<ProviderSettings> | null,
): ProviderSettings {
  const c = client || {}
  return {
    preferredLlm: c.preferredLlm || DEFAULT_SETTINGS.preferredLlm,
    anthropicApiKey:
      c.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY || '',
    anthropicModel:
      c.anthropicModel?.trim() ||
      process.env.ANTHROPIC_MODEL ||
      DEFAULT_SETTINGS.anthropicModel,
    openaiApiKey: c.openaiApiKey?.trim() || process.env.OPENAI_API_KEY || '',
    openaiModel:
      c.openaiModel?.trim() ||
      process.env.OPENAI_MODEL ||
      DEFAULT_SETTINGS.openaiModel,
    openaiBaseUrl:
      c.openaiBaseUrl?.trim() ||
      process.env.OPENAI_BASE_URL ||
      DEFAULT_SETTINGS.openaiBaseUrl,
    openaiCompatibleEnabled:
      c.openaiCompatibleEnabled ??
      Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL),
    openaiCompatibleBaseUrl:
      c.openaiCompatibleBaseUrl?.trim() ||
      process.env.OPENAI_COMPATIBLE_BASE_URL ||
      '',
    openaiCompatibleApiKey:
      c.openaiCompatibleApiKey?.trim() ||
      process.env.OPENAI_COMPATIBLE_API_KEY ||
      '',
    openaiCompatibleModel:
      c.openaiCompatibleModel?.trim() ||
      process.env.OPENAI_COMPATIBLE_MODEL ||
      '',
    medialystApiKey:
      c.medialystApiKey?.trim() || process.env.MEDIALYST_API_KEY || '',
    medialystApiBase:
      c.medialystApiBase?.trim() ||
      process.env.MEDIALYST_API_BASE ||
      DEFAULT_SETTINGS.medialystApiBase,
    manusApiKey: c.manusApiKey?.trim() || process.env.MANUS_API_KEY || '',
    appUrl: c.appUrl?.trim() || process.env.APP_URL || '',
    slackWebhookUrl:
      c.slackWebhookUrl?.trim() || process.env.SLACK_WEBHOOK_URL || '',
  }
}
