/**
 * Medialyst public REST API client.
 */

export type MedialystCtx = { apiKey?: string; baseUrl?: string }

function resolveBase(ctx?: MedialystCtx): string {
  return (
    ctx?.baseUrl?.replace(/\/$/, '') ||
    process.env.MEDIALYST_API_BASE?.replace(/\/$/, '') ||
    'https://api.medialyst.ai'
  )
}

function resolveKey(ctx?: MedialystCtx): string | null {
  return ctx?.apiKey || process.env.MEDIALYST_API_KEY || null
}

export function hasMedialystConfig(ctx?: MedialystCtx): boolean {
  return Boolean(resolveKey(ctx))
}

async function medialystFetch<T>(
  path: string,
  init?: RequestInit,
  ctx?: MedialystCtx,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const key = resolveKey(ctx)
  if (!key) {
    return { ok: false, error: 'MEDIALYST_API_KEY not set', status: 0 }
  }
  try {
    const res = await fetch(`${resolveBase(ctx)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    if (!res.ok) {
      const msg =
        typeof data === 'object' && data && 'message' in data
          ? String((data as { message: string }).message)
          : text.slice(0, 200)
      return { ok: false, error: msg || `HTTP ${res.status}`, status: res.status }
    }
    return { ok: true, data: data as T }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      status: 0,
    }
  }
}

export type NewsArticle = {
  title?: string
  url?: string
  outlet?: string
  author?: string
  published_at?: string
  snippet?: string
  [key: string]: unknown
}

export async function searchNews(
  opts: { query: string; limit?: number; recency?: string },
  ctx?: MedialystCtx,
) {
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: opts.limit ?? 20,
  }
  if (opts.recency) body.recency = opts.recency

  const res = await medialystFetch<unknown>(
    '/api/v1/news/search',
    { method: 'POST', body: JSON.stringify(body) },
    ctx,
  )
  if (!res.ok) return { ok: false as const, error: res.error }

  return {
    ok: true as const,
    articles: normalizeArticles(res.data),
    raw: res.data,
  }
}

export async function queryPrCalendar(
  opts: { query: string; horizon?: string },
  ctx?: MedialystCtx,
) {
  const res = await medialystFetch<unknown>(
    '/api/v1/pr-calendar/query',
    {
      method: 'POST',
      body: JSON.stringify({ query: opts.query, horizon: opts.horizon }),
    },
    ctx,
  )
  if (!res.ok) return { ok: false as const, error: res.error }
  const raw = res.data as { events?: unknown[]; data?: unknown[] }
  const events = raw.events || raw.data || (Array.isArray(raw) ? raw : [])
  return { ok: true as const, events: events as unknown[], raw: res.data }
}

export async function lookupJournalists(
  opts: { query?: string; names?: string[]; article_url?: string },
  ctx?: MedialystCtx,
) {
  const res = await medialystFetch<unknown>(
    '/api/v1/journalists/lookup',
    { method: 'POST', body: JSON.stringify(opts) },
    ctx,
  )
  if (!res.ok) {
    const res2 = await medialystFetch<unknown>(
      '/api/v1/journalists/enrich',
      { method: 'POST', body: JSON.stringify(opts) },
      ctx,
    )
    if (!res2.ok) return { ok: false as const, error: res2.error }
    return {
      ok: true as const,
      journalists: normalizeList(res2.data),
      raw: res2.data,
    }
  }
  return {
    ok: true as const,
    journalists: normalizeList(res.data),
    raw: res.data,
  }
}

function normalizeList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.journalists)) return o.journalists
    if (Array.isArray(o.data)) return o.data
    if (Array.isArray(o.results)) return o.results
  }
  return []
}

function normalizeArticles(raw: unknown): NewsArticle[] {
  if (Array.isArray(raw)) return raw as NewsArticle[]
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const k of ['articles', 'results', 'data', 'items']) {
      if (Array.isArray(o[k])) return o[k] as NewsArticle[]
    }
  }
  return []
}

export function formatArticlesForPrompt(articles: NewsArticle[]): string {
  if (!articles.length) return '(no articles returned)'
  return articles
    .slice(0, 25)
    .map((a, i) => {
      const parts = [
        `${i + 1}. ${a.title || '(no title)'}`,
        a.outlet ? `   Outlet: ${a.outlet}` : null,
        a.author ? `   Author: ${a.author}` : null,
        a.published_at ? `   Published: ${a.published_at}` : null,
        a.url ? `   URL: ${a.url}` : null,
        a.snippet ? `   ${String(a.snippet).slice(0, 200)}` : null,
      ]
      return parts.filter(Boolean).join('\n')
    })
    .join('\n\n')
}
