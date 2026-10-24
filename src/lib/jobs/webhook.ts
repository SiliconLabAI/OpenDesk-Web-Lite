import { createHash, createVerify, createPublicKey } from 'node:crypto'
import {
  extractManusResults,
  isSubstantialManusResearch,
  expandManusMarkdownAttachments,
  formatManusAttachmentsSection,
  manusListMessages,
  manusPublicKey,
  type ManusWebhookEnvelope,
} from '~/lib/manus/client'
import { getDb, hasDb } from '~/lib/db/server'
import { completeChatResearchJob } from '~/lib/chat/researchJob'
import { writeAppLog } from '~/lib/logs/write'

let cachedPublicKey: string | null = null

async function getPublicKeyPem(): Promise<string | null> {
  if (cachedPublicKey) return cachedPublicKey
  try {
    cachedPublicKey = await manusPublicKey()
    return cachedPublicKey
  } catch {
    return null
  }
}

/**
 * Verify Manus RSA-SHA256 signature.
 * Signed content: `{timestamp}.{url}.{sha256_hex(body)}`
 * Headers: X-Webhook-Signature, X-Webhook-Timestamp
 */
export async function verifyManusSignature(
  rawBody: string,
  headers: Headers,
  webhookUrl: string,
): Promise<{ ok: boolean; reason?: string }> {
  const skip = process.env.MANUS_WEBHOOK_SKIP_VERIFY === '1'
  if (skip) return { ok: true, reason: 'skipped' }

  const sig = headers.get('x-webhook-signature') || headers.get('X-Webhook-Signature')
  const ts = headers.get('x-webhook-timestamp') || headers.get('X-Webhook-Timestamp')
  if (!sig || !ts) {
    // Allow unsigned in dev when no key yet
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, reason: 'dev_unsigned' }
    }
    return { ok: false, reason: 'missing signature headers' }
  }

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad timestamp' }
  const age = Math.abs(Date.now() / 1000 - tsNum)
  if (age > 5 * 60) return { ok: false, reason: 'timestamp too old' }

  const pem = await getPublicKeyPem()
  if (!pem) {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, reason: 'no_public_key_dev' }
    }
    return { ok: false, reason: 'cannot load public key' }
  }

  const bodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const signed = `${ts}.${webhookUrl}.${bodyHash}`

  try {
    // pem may be raw key material or full PEM
    let keyPem = pem
    if (!pem.includes('BEGIN')) {
      keyPem = `-----BEGIN PUBLIC KEY-----\n${pem}\n-----END PUBLIC KEY-----`
    }
    const key = createPublicKey(keyPem)
    const verifier = createVerify('RSA-SHA256')
    verifier.update(signed)
    verifier.end()
    const ok = verifier.verify(key, Buffer.from(sig, 'base64'))
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'verify failed',
    }
  }
}

async function storeArtifactFromUrl(
  orgId: string,
  jobId: string,
  kind: string,
  url: string,
): Promise<void> {
  if (!hasDb()) return
  const db = getDb()

  // Always record external URL
  let storage_path: string | null = null
  try {
    const res = await fetch(url)
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      const ext =
        url.includes('.pdf') ? 'pdf' : url.includes('.mp4') ? 'mp4' : 'bin'
      const path = `artifacts/${orgId}/${jobId}/${Date.now()}.${ext}`
      const { error } = await db.storage
        .from('newsjack-artifacts')
        .upload(path, buf, {
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          upsert: true,
        })
      if (!error) storage_path = path
    }
  } catch {
    // keep external_url only
  }

  await db.from('artifacts').insert({
    org_id: orgId,
    job_id: jobId,
    kind,
    storage_path,
    external_url: url,
    meta: { source: 'manus' },
  })
}

export async function handleManusWebhook(
  body: ManusWebhookEnvelope,
  rawBody?: string,
  headers?: Headers,
  webhookUrl?: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (rawBody && headers && webhookUrl) {
    const v = await verifyManusSignature(rawBody, headers, webhookUrl)
    if (!v.ok) {
      return { ok: false, detail: `signature: ${v.reason}` }
    }
  }

  if (!hasDb()) {
    return { ok: true, detail: 'no sqlite — acknowledged only' }
  }

  const taskId = String(
    body.task_detail?.task_id ||
      body.task_id ||
      (body as { taskId?: string }).taskId ||
      (body as { task_detail?: { id?: string } }).task_detail?.id ||
      '',
  ).trim()
  if (!taskId) {
    await writeAppLog({
      level: 'warn',
      kind: 'webhook',
      source: 'manus',
      message: 'webhook without task_id',
      request: { event_type: body.event_type, keys: Object.keys(body) },
    })
    return { ok: true, detail: 'no task_id in payload' }
  }

  const db = getDb()
  let { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('manus_task_id', taskId)
    .maybeSingle()

  // Fallback: newest waiting chat_research job (if Manus id format mismatch)
  if (!job) {
    const { data: recent } = await db
      .from('jobs')
      .select('*')
      .eq('kind', 'chat_research')
      .eq('status', 'waiting_manus')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (recent && recent.manus_task_id && String(recent.manus_task_id) === taskId) {
      job = recent
    }
  }

  await writeAppLog({
    level: 'info',
    kind: 'webhook',
    source: 'manus',
    message: `event ${body.event_type} task ${taskId} job=${job?.id || 'none'}`,
    meta: {
      task_id: taskId,
      event_type: body.event_type,
      job_id: job?.id,
      job_kind: job?.kind,
    },
  })

  if (!job) {
    // Still acknowledge — may complete via client poll
    await writeAppLog({
      level: 'info',
      kind: 'webhook',
      source: 'manus',
      message: `no job for task ${taskId}`,
      meta: { task_id: taskId, event_type: body.event_type },
    })
    return { ok: true, detail: 'no matching job' }
  }

  const jobSettings = ((job.input || {}) as { settings?: { manusApiKey?: string } })
    .settings
  const manusCtx = jobSettings?.manusApiKey
    ? { apiKey: jobSettings.manusApiKey }
    : undefined

  const eventLog = Array.isArray(job.manus_event_log)
    ? [...job.manus_event_log]
    : []
  eventLog.push({
    at: new Date().toISOString(),
    event_type: body.event_type,
    event_id: body.event_id,
    payload: body,
  })

  const agentStatus =
    body.task_detail?.agent_status ||
    body.task_detail?.status ||
    (body as { agent_status?: string }).agent_status

  const terminalSuccess =
    body.event_type === 'task_stopped' ||
    body.event_type === 'task_completed' ||
    agentStatus === 'stopped' ||
    agentStatus === 'completed'

  const terminalFail =
    agentStatus === 'error' || body.event_type === 'task_failed'

  if (terminalSuccess) {
    let output_text = job.output_text
    let output = job.output
    const artifactUrls: string[] = []

    try {
      const messages = await manusListMessages(taskId, 50, manusCtx, {
        markdownFormat: 'markdown',
      })
      let extracted = extractManusResults(messages)
      let expanded: Awaited<ReturnType<typeof expandManusMarkdownAttachments>> | null =
        null
      try {
        expanded = await expandManusMarkdownAttachments(messages, extracted)
        if (expanded.text) {
          extracted = { ...extracted, text: expanded.text }
        }
      } catch { /* */ }
      if (extracted.text) output_text = extracted.text
      artifactUrls.push(...extracted.fileUrls)
      const attSection = formatManusAttachmentsSection({
        files: expanded?.files,
        fileUrls: extracted.fileUrls,
        sandboxPaths: extracted.sandboxPaths,
        taskId,
        taskUrl: job.manus_task_url || undefined,
      })
      if (attSection && output_text && !String(output_text).includes('## Attachments')) {
        output_text = String(output_text).trimEnd() + '\n\n' + attSection
      }
      if (attSection) {
        output = {
          ...(typeof output === 'object' && output ? output : {}),
          attachments_markdown: attSection,
        }
      }
      output = {
        ...(typeof output === 'object' && output ? output : {}),
        manus_messages_summary: true,
        artifact_urls: artifactUrls,
      }
    } catch {
      // keep prior
    }

    for (const url of artifactUrls) {
      await storeArtifactFromUrl(
        job.org_id,
        job.id,
        job.kind === 'press_clip' ? 'press_clip_pdf' : 'coverage_reel',
        url,
      )
    }

    // Press-clip QA gate in output_text
    if (job.kind === 'press_clip' && output_text) {
      const mention = (job.input as { mention?: string })?.mention
      if (mention && !output_text.toLowerCase().includes(mention.toLowerCase())) {
        output_text +=
          '\n\n## QA warning\nClient mention not clearly present in Manus output text — review artifacts manually.'
      }
    }

    // Chat research: only complete when Manus returned real research (not an ack)
    if (job.kind === 'chat_research') {
      if (output_text && isSubstantialManusResearch(output_text)) {
        await db
          .from('jobs')
          .update({
            manus_event_log: eventLog,
            output: {
              ...(typeof output === 'object' && output ? output : {}),
              research_raw: true,
            },
          })
          .eq('id', job.id)
        const done = await completeChatResearchJob(
          job.id,
          output_text,
          job.manus_task_url || undefined,
          (output as { attachments_markdown?: string })?.attachments_markdown,
        )
        await writeAppLog({
          level: done.ok ? 'info' : 'error',
          kind: 'webhook',
          source: 'manus',
          message: done.ok
            ? 'chat_research completed via callback'
            : 'chat_research LLM failed',
          meta: { job_id: job.id, task_id: taskId },
          error: done.error,
        })
        return {
          ok: true,
          detail: done.ok
            ? 'chat_research completed'
            : `chat_research llm: ${done.error}`,
        }
      }
      // Intermediate message / empty — keep waiting for a later event or poll
      await db
        .from('jobs')
        .update({
          status: 'waiting_manus',
          manus_event_log: eventLog,
          output_text: output_text || null,
        })
        .eq('id', job.id)
      await writeAppLog({
        level: 'info',
        kind: 'webhook',
        source: 'manus',
        message: 'chat_research: interim Manus text, still waiting',
        meta: { job_id: job.id, task_id: taskId, text_len: (output_text || '').length },
        response: { text_preview: (output_text || '').slice(0, 300) },
      })
      return { ok: true, detail: 'chat_research waiting for substantial research' }
    }

    await db
      .from('jobs')
      .update({
        status: 'completed',
        output_text,
        output,
        manus_event_log: eventLog,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return { ok: true, detail: 'job completed' }
  }

  if (terminalFail) {
    await db
      .from('jobs')
      .update({
        status: 'failed',
        error: `Manus agent_status=${agentStatus || 'error'}`,
        manus_event_log: eventLog,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    return { ok: true, detail: 'job failed' }
  }

  await db
    .from('jobs')
    .update({
      status: 'waiting_manus',
      manus_event_log: eventLog,
    })
    .eq('id', job.id)

  return { ok: true, detail: 'progress recorded' }
}
