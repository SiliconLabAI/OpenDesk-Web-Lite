import type { ProviderSettings } from '~/lib/settings/types'
import { writeAppLog } from '~/lib/logs/write'

export type LlmCallResult = {
  text: string
  provider: string
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

/** OpenAI Chat Completions API (official or compatible). */
export async function callChatCompletions(opts: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  user: string
  temperature?: number
}): Promise<string> {
  const base = normalizeBaseUrl(opts.baseUrl)
  const url = base.endsWith('/v1')
    ? `${base}/chat/completions`
    : `${base}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`
  }

  const body = {
    model: opts.model,
    temperature: opts.temperature ?? 0.4,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  }

  const started = Date.now()
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (e) {
    await writeAppLog({
      level: 'error',
      kind: 'llm',
      source: 'openai_compatible',
      message: `fetch failed ${url}`,
      request: {
        url,
        model: opts.model,
        system_len: opts.system.length,
        user_len: opts.user.length,
      },
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    })
    throw e
  }

  const raw = await res.text()
  let data: {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  } = {}
  try {
    data = JSON.parse(raw)
  } catch {
    data = {}
  }

  if (!res.ok) {
    const errMsg =
      data.error?.message || raw.slice(0, 500) || `HTTP ${res.status}`
    await writeAppLog({
      level: 'error',
      kind: 'llm',
      source: 'openai_compatible',
      message: `chat/completions ${res.status}`,
      request: {
        url,
        model: opts.model,
        system_preview: opts.system.slice(0, 400),
        user_preview: opts.user.slice(0, 400),
      },
      response: { status: res.status, body: raw.slice(0, 2000) },
      error: errMsg,
      durationMs: Date.now() - started,
    })
    throw new Error(errMsg)
  }

  const text = data.choices?.[0]?.message?.content || ''
  await writeAppLog({
    level: 'info',
    kind: 'llm',
    source: 'openai_compatible',
    message: `ok model=${opts.model}`,
    request: {
      url,
      model: opts.model,
      system_len: opts.system.length,
      user_len: opts.user.length,
      system_preview: opts.system.slice(0, 300),
      user_preview: opts.user.slice(0, 300),
    },
    response: { text_len: text.length, text_preview: text.slice(0, 800) },
    durationMs: Date.now() - started,
  })
  return text
}

export async function callAnthropic(opts: {
  apiKey: string
  model: string
  system: string
  user: string
}): Promise<string> {
  const started = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  })
  const raw = await res.text()
  let data: {
    content?: Array<{ type?: string; text?: string }>
    error?: { message?: string }
  } = {}
  try {
    data = JSON.parse(raw)
  } catch {
    data = {}
  }
  if (!res.ok) {
    const errMsg =
      data.error?.message || raw.slice(0, 500) || `HTTP ${res.status}`
    await writeAppLog({
      level: 'error',
      kind: 'llm',
      source: 'anthropic',
      message: `messages ${res.status}`,
      request: {
        model: opts.model,
        system_preview: opts.system.slice(0, 300),
        user_preview: opts.user.slice(0, 300),
      },
      response: { status: res.status, body: raw.slice(0, 2000) },
      error: errMsg,
      durationMs: Date.now() - started,
    })
    throw new Error(errMsg)
  }
  const text =
    data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') ||
    ''
  await writeAppLog({
    level: 'info',
    kind: 'llm',
    source: 'anthropic',
    message: `ok model=${opts.model}`,
    request: {
      model: opts.model,
      system_len: opts.system.length,
      user_len: opts.user.length,
    },
    response: { text_len: text.length, text_preview: text.slice(0, 800) },
    durationMs: Date.now() - started,
  })
  return text
}

/**
 * Route to preferred provider. Order for `auto`:
 * openai_compatible (if enabled) → anthropic → openai
 */
export async function callLlm(
  settings: ProviderSettings,
  system: string,
  user: string,
): Promise<LlmCallResult> {
  const pref = settings.preferredLlm

  const tryCompatible = async () => {
    if (
      !settings.openaiCompatibleEnabled &&
      !settings.openaiCompatibleBaseUrl
    ) {
      throw new Error('openai_compatible_disabled')
    }
    if (!settings.openaiCompatibleBaseUrl) {
      throw new Error('openai_compatible_missing_base')
    }
    const text = await callChatCompletions({
      baseUrl: settings.openaiCompatibleBaseUrl,
      apiKey: settings.openaiCompatibleApiKey,
      model: settings.openaiCompatibleModel || 'gpt-4o-mini',
      system,
      user,
    })
    return { text, provider: 'openai_compatible' as const }
  }

  const tryAnthropic = async () => {
    if (!settings.anthropicApiKey) throw new Error('no_anthropic')
    const text = await callAnthropic({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      system,
      user,
    })
    return { text, provider: 'anthropic' as const }
  }

  const tryOpenai = async () => {
    if (!settings.openaiApiKey) throw new Error('no_openai')
    const text = await callChatCompletions({
      baseUrl: settings.openaiBaseUrl || 'https://api.openai.com/v1',
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
      system,
      user,
    })
    return { text, provider: 'openai' as const }
  }

  try {
    if (pref === 'openai_compatible') return await tryCompatible()
    if (pref === 'anthropic') return await tryAnthropic()
    if (pref === 'openai') return await tryOpenai()

    // auto
    const errors: string[] = []
    if (settings.openaiCompatibleEnabled && settings.openaiCompatibleBaseUrl) {
      try {
        return await tryCompatible()
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    if (settings.anthropicApiKey) {
      try {
        return await tryAnthropic()
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    if (settings.openaiApiKey) {
      try {
        return await tryOpenai()
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    throw new Error(
      errors.length
        ? `No LLM succeeded: ${errors.join('; ')}`
        : 'No LLM API keys configured. Open Settings to add Anthropic, OpenAI, or an OpenAI-compatible endpoint.',
    )
  } catch (e) {
    await writeAppLog({
      level: 'error',
      kind: 'llm',
      source: 'router',
      message: 'callLlm failed',
      meta: { preferred: pref },
      error: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}
