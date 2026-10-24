/**
 * Manus API v2 client — agent tasks (like Grok/Manus web agents).
 * Research uses the built-in agent only (no Playwright/connectors required).
 * Optional connectors can be passed explicitly for browser jobs if the user has them.
 */

import { writeAppLog } from '~/lib/logs/write'

const BASE = 'https://api.manus.ai'

/** @deprecated Playwright is optional — only pass when user has it installed */
export const MANUS_PLAYWRIGHT_CONNECTOR = '356d5bc1-fb9f-4fa1-babb-05039dc09d63'

export type ManusCtx = { apiKey?: string }

export type ManusCreateTaskResult = {
  ok: boolean
  request_id?: string
  task_id: string
  task_title?: string
  task_url?: string
  share_url?: string
  error?: { code: string; message: string }
}

export type ManusWebhookEnvelope = {
  event_id: string
  event_type: string
  task_detail?: {
    task_id: string
    task_title?: string
    task_url?: string
    agent_status?: string
    status?: string
  }
  task_id?: string
  [key: string]: unknown
}

function resolveKey(ctx?: ManusCtx): string {
  const k = ctx?.apiKey || process.env.MANUS_API_KEY
  if (!k) throw new Error('MANUS_API_KEY is not set (add it in Settings or env)')
  return k
}

export function hasManusConfig(ctx?: ManusCtx): boolean {
  return Boolean(ctx?.apiKey || process.env.MANUS_API_KEY)
}

/**
 * Create a Manus agent task.
 *
 * By default: no connectors (clear_connectors: true) — the agent handles web
 * research itself. Only pass `connectors` if you explicitly need Gmail/Slack/etc.
 */
export async function manusCreateTask(
  opts: {
    prompt: string
    title?: string
    /** Optional connector UUIDs. Omit for pure agent research. */
    connectors?: string[]
    agentProfile?: 'standard' | 'lite' | 'max'
    structuredOutputSchema?: Record<string, unknown>
    hideInTaskList?: boolean
    /** When true (default if no connectors), do not load account default connectors */
    clearConnectors?: boolean
  },
  ctx?: ManusCtx,
): Promise<ManusCreateTaskResult> {
  const hasConnectors = Boolean(opts.connectors && opts.connectors.length > 0)
  const clearConnectors =
    opts.clearConnectors !== undefined
      ? opts.clearConnectors
      : !hasConnectors

  const message: Record<string, unknown> = {
    // API accepts string content for simple agent prompts
    content: opts.prompt,
  }
  if (hasConnectors) {
    message.connectors = opts.connectors
  }

  const body: Record<string, unknown> = {
    message,
    agent_profile: opts.agentProfile ?? 'standard',
    interactive_mode: false,
    hide_in_task_list: opts.hideInTaskList ?? false,
  }
  // Start without connectors so Playwright/etc. is never required
  if (clearConnectors && !hasConnectors) {
    body.clear_connectors = true
  }
  if (opts.title) body.title = opts.title
  if (opts.structuredOutputSchema) {
    body.structured_output_schema = opts.structuredOutputSchema
  }

  const res = await fetch(`${BASE}/v2/task.create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-manus-api-key': resolveKey(ctx),
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as ManusCreateTaskResult
  if (!res.ok || data.ok === false) {
    const errMsg =
      data.error?.message || `Manus task.create failed (${res.status})`
    await writeAppLog({
      level: 'error',
      kind: 'manus',
      source: 'task.create',
      message: errMsg,
      request: { title: opts.title, has_connectors: hasConnectors, clear_connectors: clearConnectors },
      response: data as unknown as Record<string, unknown>,
      error: errMsg,
    })
    throw new Error(errMsg)
  }
  await writeAppLog({
    level: 'info',
    kind: 'manus',
    source: 'task.create',
    message: `task ${data.task_id}`,
    request: {
      title: opts.title,
      prompt_preview: opts.prompt.slice(0, 400),
      agent_profile: opts.agentProfile ?? 'standard',
      clear_connectors: clearConnectors,
    },
    response: {
      task_id: data.task_id,
      task_url: data.task_url,
    },
  })
  return data
}

export async function manusListMessages(
  taskId: string,
  limit = 20,
  ctx?: ManusCtx,
  opts?: { verbose?: boolean; markdownFormat?: 'markdown' | 'pdf' | 'docx' },
) {
  const url = new URL(`${BASE}/v2/task.listMessages`)
  url.searchParams.set('task_id', taskId)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('limit', String(limit))
  if (opts?.verbose) url.searchParams.set('verbose', 'true')
  if (opts?.markdownFormat) {
    url.searchParams.set('markdown_format', opts.markdownFormat)
  }
  const res = await fetch(url.toString(), {
    headers: { 'x-manus-api-key': resolveKey(ctx) },
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus listMessages failed (${res.status})`,
    )
  }
  return data
}

export async function manusGetTask(taskId: string, ctx?: ManusCtx) {
  const url = new URL(`${BASE}/v2/task.detail`)
  url.searchParams.set('task_id', taskId)
  const res = await fetch(url.toString(), {
    headers: { 'x-manus-api-key': resolveKey(ctx) },
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus task.detail failed (${res.status})`,
    )
  }
  return data
}

/** Extract assistant text from task.listMessages (Manus v2 event shape). */
export function extractManusResults(listMessagesResponse: unknown): {
  text: string
  allTexts?: string[]
  fileUrls: string[]
  sandboxPaths?: string[]
  eventIds?: string[]
  statusHints: string[]
  rawTypes: string[]
} {
  const data = listMessagesResponse as {
    messages?: Array<Record<string, unknown>>
    data?: Array<Record<string, unknown>>
  }
  const messages = data.messages || data.data || []
  const texts: string[] = []
  const fileUrls: string[] = []
  const statusHints: string[] = []
  const rawTypes: string[] = []

  const eventIds: string[] = []
  const sandboxPaths: string[] = []

  const pushAttachments = (atts: unknown, eventId?: string) => {
    if (!Array.isArray(atts)) return
    for (const a of atts) {
      if (a && typeof a === 'object') {
        const o = a as {
          url?: string
          path?: string
          file_url?: string
          filename?: string
        }
        if (o.url) fileUrls.push(o.url)
        if (o.file_url) fileUrls.push(o.file_url)
        if (o.path) {
          sandboxPaths.push(o.path)
          if (eventId) eventIds.push(eventId)
        }
      }
    }
  }

  for (const m of messages) {
    const type = String(m.type || m.role || '')
    rawTypes.push(type)

    if (type === 'assistant_message' || m.assistant_message) {
      const am = (m.assistant_message || m) as {
        content?: string | unknown
        attachments?: unknown
      }
      if (typeof am.content === 'string' && am.content.trim()) {
        texts.push(am.content.trim())
      } else if (Array.isArray(am.content)) {
        for (const part of am.content) {
          if (typeof part === 'string') texts.push(part)
          else if (
            part &&
            typeof part === 'object' &&
            typeof (part as { text?: string }).text === 'string'
          ) {
            texts.push((part as { text: string }).text)
          }
        }
      }
      pushAttachments(am.attachments, typeof m.id === 'string' ? m.id : undefined)
    }

    if (type === 'structured_output_result' && m.structured_output_result) {
      const so = m.structured_output_result as {
        success?: boolean
        value?: unknown
      }
      if (so.value != null) {
        texts.push(
          typeof so.value === 'string'
            ? so.value
            : ('```' + 'json\n' + JSON.stringify(so.value, null, 2) + '\n```'),
        )
      }
    }

    if (type === 'status_update' || m.status_update) {
      const su = (m.status_update || {}) as {
        agent_status?: string
        brief?: string
        description?: string
      }
      const hint = [su.agent_status, su.brief, su.description]
        .filter(Boolean)
        .join(' — ')
      if (hint) statusHints.push(hint)
    }

    if (type === 'error_message' || m.error_message) {
      const em = (m.error_message || {}) as {
        content?: string
        error_type?: string
      }
      if (em.content) statusHints.push(`error: ${em.content}`)
    }

    if (typeof m.content === 'string' && type !== 'user_message') {
      texts.push(m.content)
    }
  }

  const cleaned = texts.filter(Boolean)
  const text =
    cleaned.length <= 1
      ? (cleaned[0] || '').trim()
      : cleaned.slice().sort((a, b) => b.length - a.length)[0].trim()

  return {
    text,
    allTexts: cleaned,
    fileUrls: [...new Set(fileUrls)],
    sandboxPaths: [...new Set(sandboxPaths)],
    eventIds: [...new Set(eventIds)],
    statusHints,
    rawTypes,
  }
}

/**
 * Create task and poll until assistant_message appears or timeout.
 * Tasks are visible in Manus UI (hide_in_task_list: false).
 */

/** True when text looks like finished research, not an intermediate ack. */
export function isSubstantialManusResearch(text: string): boolean {
  const t = (text || '').trim()
  if (t.length < 120) return false
  const lower = t.toLowerCase()
  // Intermediate agent chatter
  const ackPatterns = [
    /i.?ll (review|search|look|start|begin)/i,
    /let me (search|look|find|review)/i,
    /i am (searching|looking|reviewing)/i,
    /i.?m (searching|looking|reviewing|on it)/i,
    /starting (the )?search/i,
    /review the research guidance/i,
    /then search current news/i,
    /working on (it|this)/i,
    /please wait/i,
  ]
  const onlyAck =
    t.length < 600 &&
    ackPatterns.some((re) => re.test(t)) &&
    !/(https?:\/\/|www\.)/i.test(t)
  if (onlyAck) return false

  // Prefer signals of real coverage
  const hasUrl = /https?:\/\/\S+/i.test(t)
  const hasOutletish =
    /\b(reuters|bloomberg|techcrunch|wsj|nytimes|forbes|the verge|wired|cnbc|bbc|guardian|axios|politico|pr newswire|business wire)\b/i.test(
      t,
    )
  const hasStructure =
    (t.match(/^#{1,3}\s/gm) || []).length >= 1 ||
    (t.match(/^[-*]\s/gm) || []).length >= 2 ||
    (t.match(/\n\d+\./g) || []).length >= 2
  if (hasUrl || hasOutletish) return true
  if (t.length >= 400 && hasStructure) return true
  if (t.length >= 600) return true
  // Report-like files often use ## headings without external URLs yet
  if ((t.match(/^#{1,3}\s/gm) || []).length >= 2 && t.length >= 250) return true
  return false
}


/**
 * Turn Manus sandbox paths (/home/ubuntu/...) into browser-openable preview URLs.
 * Pattern: https://manus.im/app/{taskId}?previewEventId={eventId}&previewSandboxPath={encodedPath}
 */

/**
 * Download markdown/file attachments from listMessages and inline their content.
 * Prefer attachment.url (presigned) over opening manus.im preview pages.
 */
export async function expandManusMarkdownAttachments(
  listMessagesResponse: unknown,
  extracted: ReturnType<typeof extractManusResults>,
): Promise<{ text: string; files: Array<{ filename: string; path?: string; content: string; url?: string }> }> {
  const data = listMessagesResponse as {
    messages?: Array<Record<string, unknown>>
  }
  const messages = data.messages || []
  const files: Array<{
    filename: string
    path?: string
    content: string
    url?: string
  }> = []

  const seen = new Set<string>()

  for (const m of messages) {
    const am = (m.assistant_message || m.user_message) as
      | { attachments?: unknown }
      | undefined
    if (!am || !Array.isArray(am.attachments)) continue
    for (const a of am.attachments) {
      if (!a || typeof a !== 'object') continue
      const att = a as {
        url?: string
        path?: string
        filename?: string
        content_type?: string
        type?: string
      }
      const name = att.filename || att.path || 'file'
      const isMd =
        /\.(md|markdown)$/i.test(name) ||
        /markdown/i.test(att.content_type || '') ||
        /\.md$/i.test(att.path || '')
      if (!att.url) {
        // path-only attachment — still record for preview links
        if (att.path) {
          files.push({
            filename: name.split('/').pop() || name,
            path: att.path,
            content: '',
            url: undefined,
          })
        }
        continue
      }
      const key = att.url
      if (seen.has(key)) continue
      seen.add(key)
      if (isMd) {
        try {
          const res = await fetch(att.url)
          if (res.ok) {
            const content = await res.text()
            files.push({
              filename: name.split('/').pop() || name,
              path: att.path,
              content: (content || '').trim(),
              url: att.url,
            })
            continue
          }
        } catch {
          /* fall through — still keep url */
        }
      }
      files.push({
        filename: name.split('/').pop() || name,
        path: att.path,
        content: '',
        url: att.url,
      })
    }
  }

  // Also try fileUrls that look like md downloads
  for (const u of extracted.fileUrls || []) {
    if (seen.has(u)) continue
    if (!/\.(md|markdown)(\?|$)/i.test(u) && !u.includes('markdown')) continue
    seen.add(u)
    try {
      const res = await fetch(u)
      if (!res.ok) continue
      const content = await res.text()
      if (content && content.trim().length > 20) {
        files.push({
          filename: u.split('/').pop()?.split('?')[0] || 'report.md',
          content: content.trim(),
          url: u,
        })
      }
    } catch {
      /* skip */
    }
  }

  let text = extracted.text || ''
  if (files.length) {
    // Prefer file bodies as primary research when longer than chat acks
    const longest = files.slice().sort((a, b) => b.content.length - a.content.length)[0]
    if (longest.content.length > (text?.length || 0) || isSubstantialManusResearch(longest.content)) {
      text = files
        .map(
          (f) =>
            `### ${f.filename}\n\n${f.content}`,
        )
        .join('\n\n---\n\n')
    } else {
      text =
        (text ? text + '\n\n' : '') +
        files.map((f) => `### ${f.filename}\n\n${f.content}`).join('\n\n---\n\n')
    }
  }

  return { text, files }
}


/** Build a markdown section listing Manus attachment download + preview URLs. */
export function formatManusAttachmentsSection(
  opts: {
    files?: Array<{ filename: string; path?: string; content?: string; url?: string }>
    fileUrls?: string[]
    sandboxPaths?: string[]
    taskId?: string
    taskUrl?: string
    eventId?: string
  },
): string {
  const lines: string[] = []
  const seen = new Set<string>()

  const push = (label: string, url: string) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    lines.push(`- [${label}](${url})`)
  }

  for (const f of opts.files || []) {
    const name = f.filename || f.path?.split('/').pop() || 'file'
    if (f.url) push(name, f.url)
    if (f.path && opts.taskId) {
      const preview = rewriteManusSandboxLinks(f.path, {
        taskId: opts.taskId,
        taskUrl: opts.taskUrl,
        eventId: opts.eventId,
      })
      if (preview.startsWith('http')) push(`${name} (Manus preview)`, preview)
    }
  }

  for (const u of opts.fileUrls || []) {
    const name = u.split('/').pop()?.split('?')[0] || 'attachment'
    push(name, u)
  }

  for (const sp of opts.sandboxPaths || []) {
    if (!opts.taskId) continue
    const preview = rewriteManusSandboxLinks(sp, {
      taskId: opts.taskId,
      taskUrl: opts.taskUrl,
      eventId: opts.eventId,
    })
    if (preview.startsWith('http')) {
      push(sp.split('/').pop() || sp, preview)
    }
  }

  if (!lines.length) return ''
  return `## Attachments\n\n${lines.join('\n')}`
}

export function rewriteManusSandboxLinks(
  text: string,
  opts: { taskId?: string; taskUrl?: string; eventId?: string },
): string {
  if (!text) return text
  const taskId =
    opts.taskId ||
    (opts.taskUrl || '').match(/manus\.im\/app\/([^/?#]+)/)?.[1] ||
    ''
  if (!taskId) return text

  const toPreview = (filePath: string, eventId?: string) => {
    const path = filePath.startsWith('/') ? filePath : `/${filePath}`
    const params = new URLSearchParams()
    if (eventId || opts.eventId) {
      params.set('previewEventId', eventId || opts.eventId || '')
    }
    params.set('previewSandboxPath', path)
    return `https://manus.im/app/${taskId}?${params.toString()}`
  }

  let out = text

  // Markdown links: [label](/home/ubuntu/...) or [label](home/ubuntu/...)
  out = out.replace(
    /\[([^\]]*)\]\((\/?(?:home\/ubuntu|tmp|workspace)\/[^)\s]+)\)/gi,
    (_m, label: string, filePath: string) => {
      const path = filePath.startsWith('/') ? filePath : `/${filePath}`
      return `[${label}](${toPreview(path)})`
    },
  )

  // Bare paths in text (not already inside a URL)
  out = out.replace(
    /(?<![\w:/])(\/(?:home\/ubuntu|tmp|workspace)\/[^\s)\]"'<>]+)/gi,
    (filePath: string) => toPreview(filePath),
  )

  // Relative-looking sandbox paths without leading slash
  out = out.replace(
    /(?<![\w:/])((?:home\/ubuntu)\/[^\s)\]"'<>]+)/gi,
    (filePath: string) => toPreview(`/${filePath}`),
  )

  return out
}

export async function manusRunAndWait(
  opts: {
    prompt: string
    title?: string
    agentProfile?: 'standard' | 'lite' | 'max'
    /** total wait ms (default 120s) */
    timeoutMs?: number
    /** poll interval ms */
    intervalMs?: number
  },
  ctx?: ManusCtx,
): Promise<{
  taskId: string
  taskUrl?: string
  text: string
  fileUrls: string[]
  timedOut: boolean
  statusHints: string[]
}> {
  const task = await manusCreateTask(
    {
      prompt: opts.prompt,
      title: opts.title,
      agentProfile: opts.agentProfile ?? 'lite',
      clearConnectors: true,
      hideInTaskList: false,
    },
    ctx,
  )

  const timeoutMs = opts.timeoutMs ?? 120_000
  const intervalMs = opts.intervalMs ?? 3_000
  const started = Date.now()
  let text = ''
  let fileUrls: string[] = []
  let statusHints: string[] = []
  let lastTypes: string[] = []

  // Initial short delay before first poll
  await new Promise((r) => setTimeout(r, 2000))

  while (Date.now() - started < timeoutMs) {
    try {
      const msgs = await manusListMessages(task.task_id, 50, ctx)
      const extracted = extractManusResults(msgs)
      lastTypes = extracted.rawTypes
      if (extracted.statusHints.length) statusHints = extracted.statusHints
      if (extracted.text && extracted.text.length > 20) {
        text = extracted.text
        fileUrls = extracted.fileUrls
        break
      }
      // Also check task.detail status if available
      try {
        const detail = await manusGetTask(task.task_id, ctx)
        const status =
          (detail as { status?: string; task?: { status?: string } }).status ||
          (detail as { task?: { status?: string } }).task?.status ||
          (detail as { data?: { status?: string } }).data?.status
        if (status === 'stopped' || status === 'completed' || status === 'error') {
          // one more message pull
          const msgs2 = await manusListMessages(task.task_id, 50, ctx)
          const ex2 = extractManusResults(msgs2)
          if (ex2.text) {
            text = ex2.text
            fileUrls = ex2.fileUrls
          }
          break
        }
      } catch {
        /* detail optional */
      }
    } catch (e) {
      statusHints.push(
        `poll error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }

  await writeAppLog({
    level: text ? 'info' : 'warn',
    kind: 'manus',
    source: 'runAndWait',
    message: text ? `got ${text.length} chars` : 'timed out / empty',
    request: { title: opts.title, timeoutMs },
    response: {
      task_id: task.task_id,
      task_url: task.task_url,
      text_preview: text.slice(0, 600),
      timed_out: !text,
      status_hints: statusHints.slice(-5),
      message_types_seen: lastTypes.slice(0, 30),
      message_sample: (() => {
        try {
          return JSON.stringify(lastTypes)
        } catch {
          return []
        }
      })(),
    },
  })

  return {
    taskId: task.task_id,
    taskUrl: task.task_url,
    text,
    fileUrls,
    timedOut: !text,
    statusHints,
  }
}


export async function manusRegisterWebhook(
  url: string,
  events: string[],
  ctx?: ManusCtx,
) {
  const res = await fetch(`${BASE}/v2/webhook.create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-manus-api-key': resolveKey(ctx),
    },
    body: JSON.stringify({ url, events }),
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus webhook.create failed (${res.status})`,
    )
  }
  return data
}

export async function verifyManusWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = process.env.MANUS_WEBHOOK_SECRET
  if (!secret) return true // no secret configured — accept
  if (!signatureHeader) return false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(rawBody),
    )
    const hex = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return (
      signatureHeader === hex ||
      signatureHeader === `sha256=${hex}` ||
      signatureHeader.toLowerCase().includes(hex)
    )
  } catch {
    return false
  }
}
