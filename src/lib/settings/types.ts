export type ProviderSettings = {
  /** Preferred LLM: anthropic | openai | openai_compatible | auto */
  preferredLlm: 'auto' | 'anthropic' | 'openai' | 'openai_compatible'

  anthropicApiKey: string
  anthropicModel: string

  openaiApiKey: string
  openaiModel: string
  /** Official OpenAI only when base is empty or default */
  openaiBaseUrl: string

  /** Any OpenAI-compatible API (Ollama, Groq, Together, Azure-style, LiteLLM, etc.) */
  openaiCompatibleEnabled: boolean
  openaiCompatibleBaseUrl: string
  openaiCompatibleApiKey: string
  openaiCompatibleModel: string

  medialystApiKey: string
  medialystApiBase: string

  manusApiKey: string
  appUrl: string

  /** Optional Slack incoming webhook for detector alerts */
  slackWebhookUrl: string
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  preferredLlm: 'auto',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-20250514',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiCompatibleEnabled: false,
  openaiCompatibleBaseUrl: '',
  openaiCompatibleApiKey: '',
  openaiCompatibleModel: '',
  medialystApiKey: '',
  medialystApiBase: 'https://api.medialyst.ai',
  manusApiKey: '',
  appUrl: '',
  slackWebhookUrl: '',
}

export const SETTINGS_STORAGE_KEY = 'newsjack.providerSettings.v1'
