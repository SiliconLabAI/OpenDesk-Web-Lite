import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import { getSkill, type SkillDef } from '~/lib/skills/catalog'
import { doctrineFor, ETHICS_FLOOR } from '~/lib/skills/doctrine'
import { enrichSkillInputs } from '~/lib/auto/research'
import { loadSkillDraft } from '~/lib/skills/drafts'
import {
  extractManusResults,
  hasManusConfig,
  isSubstantialManusResearch,
  manusCreateTask,
  manusGetTask,
  manusListMessages,
  expandManusMarkdownAttachments,
  formatManusAttachmentsSection,
  rewriteManusSandboxLinks,
} from '~/lib/manus/client'
import { getDb, hasDb } from '~/lib/db/server'
import { ensureDefaultOrg } from '~/lib/db/org'
import { writeAppLog } from '~/lib/logs/write'
import type { ProviderSettings } from '~/lib/settings/types'

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

export async function completeChatResearchJob(
  jobId: string,
  researchText: string,
  taskUrl?: string,
  attachmentsMarkdown?: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  if (!hasDb()) {
    return { ok: false, error: 'No database' }
  }
  const db = getDb()
  const { data: job, error } = await db
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()
  if (error || !job) {
    return { ok: false, error: error?.message || 'Job not found' }
  }
  if (job.status === 'completed' && job.output_text) {
    return { ok: true, content: job.output_text }
  }

  const input = (job.input || {}) as {
    messages?: Array<{ role: string; content: string }>
    skillSlug?: string
    skillValues?: Record<string, string>
    profile?: string
    settings?: Partial<ProviderSettings>
  }

  const taskId = (job.manus_task_id as string) || ''
  const research = rewriteManusSandboxLinks(researchText, {
    taskId,
    taskUrl: taskUrl || (job.manus_task_url as string) || undefined,
  })

  const settings = resolveSettings(input.settings)
  const skill = input.skillSlug ? getSkill(input.skillSlug) : undefined
  const profile = input.profile || ''
  const messages = input.messages || []

  const system = `You are Newsjack Web, a PR agent chat.
Ethics: no invented facts, journalists, or headlines.
The LIVE RESEARCH block below is the completed Manus agent result. Treat it as ground truth.
Do NOT say research is still running. Do NOT invent extra articles beyond that block.

## Client profile
${profile}

${
  skill
    ? `## Attached skill: /${skill.slug}\n${doctrineFor(skill.slug)}\n`
    : ''
}

## Live research (Manus completed)
${research}
${taskUrl ? `\nManus task: ${taskUrl}` : ''}

When citing downloads, keep full https://manus.im/app/... preview URLs (with previewSandboxPath). Never emit bare /home/ubuntu/... paths.
If an ## Attachments section is present in the research, include those links (or an equivalent Attachments section) in your reply.

Respond in clear markdown to the user's latest message using this research.`

  const history = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')
  const user = `Conversation:\n\n${history}\n\nRespond using the Manus research above.`

  try {
    const { text, provider } = await callLlm(settings, system, user)
    // Ensure any leftover sandbox paths become Manus preview URLs
    let finalText = rewriteManusSandboxLinks(text, {
      taskId,
      taskUrl: taskUrl || (job.manus_task_url as string) || undefined,
    })
    const att =
      attachmentsMarkdown ||
      ((job.output as { attachments_markdown?: string } | null)?.attachments_markdown)
    if (att && !finalText.includes('## Attachments')) {
      finalText = finalText.trimEnd() + '\n\n' + att
    }
    await db
      .from('jobs')
      .update({
        status: 'completed',
        output_text: finalText,
        output: {
          provider,
          research_preview: research.slice(0, 2000),
          source: 'manus_callback_or_poll',
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    await writeAppLog({
      level: 'info',
      kind: 'chat',
      source: 'completeChatResearchJob',
      message: `completed via ${provider}`,
      meta: { job_id: jobId },
      response: { text_preview: finalText.slice(0, 500) },
    })

    return { ok: true, content: finalText }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await db
      .from('jobs')
      .update({
        status: 'failed',
        error: err,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    return { ok: false, error: err }
  }
}


/**
 * Build a Manus task prompt from skill doctrine + filled inputs (not a raw profile dump).
 */
export function buildManusSkillPrompt(opts: {
  skill: SkillDef
  values: Record<string, string>
  profile: string
  userMessage: string
}): string {
  const { skill, values, profile, userMessage } = opts
  const filledBlocks = skill.inputs
    .map((i) => {
      const v = values[i.id]?.trim()
      if (!v) return null
      return `### ${i.label} (${i.id})\n${v}`
    })
    .filter(Boolean)
    .join('\n\n')

  // Short profile excerpt for standing only — full dump is not the task
  const profileExcerpt = profile.trim().slice(0, 1200)

  return `You are executing the newsjack skill **/${skill.slug}** (${skill.name}).

## Skill purpose
${skill.description}

## When to use
${skill.whenToUse}

## Skill doctrine / instructions
${doctrineFor(skill.slug)}

${ETHICS_FLOOR}

## Filled skill inputs
${filledBlocks || '(none filled — use profile excerpt + user request only)'}

## Client profile excerpt (context only — do not treat as the task)
${profileExcerpt || '(none)'}

## User request (chat)
${userMessage}

## Your job (Manus agent)
1. Search the live web for current, real sources relevant to this skill and the filled inputs.
2. Return a structured markdown research report the skill can use as ground truth.
3. Include for each item when possible: title, outlet, date, URL, 1-line relevance to the skill inputs.
4. Never invent headlines, URLs, journalists, or quotes.
5. If evidence is thin, say so explicitly — do not pad with guesses.
6. If you write files, use clear filenames; paths will be opened via Manus preview links.

Focus on what **/${skill.slug}** needs — not a generic company brief.`
}

/** Start Manus research job for chat — returns immediately; poll or webhook finishes it. */
export const startChatResearch = createServerFn({ method: 'POST' })
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
    const settings = resolveSettings(data.settings)
    if (!hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
      return {
        ok: false as const,
        error: 'Manus API key not configured',
      }
    }
    if (!hasDb()) {
      return {
        ok: false as const,
        error: 'Database required for Manus callback jobs',
      }
    }

    const lastUser =
      [...data.messages].reverse().find((m) => m.role === 'user')?.content || ''
    const skill = data.skillSlug ? getSkill(data.skillSlug) : undefined

    // --- Auto-fill empty skill inputs via LLM from profile + user message ---
    let skillValues: Record<string, string> = { ...(data.skillValues || {}) }
    if (skill) {
      // Merge saved skill draft from SQLite
      try {
        const draft = await loadSkillDraft({ data: { skillSlug: skill.slug } })
        if (draft.ok && draft.values) {
          skillValues = { ...draft.values, ...skillValues }
        }
      } catch {
        /* no draft */
      }

      const base = Object.fromEntries(
        skill.inputs.map((i) => [i.id, skillValues[i.id] || '']),
      )
      // Seed first empty required field with user message if helpful
      if (lastUser) {
        for (const inp of skill.inputs) {
          if (inp.required && !base[inp.id]?.trim()) {
            base[inp.id] = lastUser
            break
          }
        }
      }
      try {
        const enriched = await enrichSkillInputs({
          data: {
            slug: skill.slug,
            values: base,
            profile: `${data.profile}

## Latest user message
${lastUser}`,
            settings: data.settings,
          },
        })
        if (enriched.ok) {
          skillValues = { ...base, ...enriched.values }
        } else {
          skillValues = base
        }
      } catch {
        skillValues = base
      }

      // If still empty, fall back to skill examples as soft context (labeled)
      for (const inp of skill.inputs) {
        if (!skillValues[inp.id]?.trim() && skill.examples?.[inp.id]) {
          skillValues[inp.id] = `(example seed — adapt to client)
${skill.examples[inp.id]}`
        }
      }
    }

    if (data.skillSlug && !skill) {
      await writeAppLog({
        level: 'warn',
        kind: 'chat',
        source: 'startChatResearch',
        message: `unknown skill slug: ${data.skillSlug}`,
      })
    }

    const prompt = skill
      ? buildManusSkillPrompt({
          skill,
          values: skillValues,
          profile: data.profile,
          userMessage: lastUser,
        })
      : `You are researching live news for newsjack (PR).

## User request
${lastUser}

## Profile excerpt
${data.profile.slice(0, 1200)}

Search the live web for recent real articles relevant to this request.
Return markdown with title, outlet, date, URL, relevance line each.
Do not invent URLs or headlines.`

    try {
      const task = await manusCreateTask(
        {
          title: skill
            ? `/${skill.slug}: ${lastUser.slice(0, 32)}`
            : `chat research: ${lastUser.slice(0, 40)}`,
          prompt,
          agentProfile: 'standard',
          clearConnectors: true,
          hideInTaskList: false,
        },
        { apiKey: settings.manusApiKey || undefined },
      )

      const db = getDb()
      const orgId = await ensureDefaultOrg(db)
      const { data: job, error } = await db
        .from('jobs')
        .insert({
          org_id: orgId,
          kind: 'chat_research',
          skill_slug: data.skillSlug || null,
          status: 'waiting_manus',
          input: {
            messages: data.messages,
            skillSlug: data.skillSlug,
            skillValues,
            profile: data.profile,
            settings: data.settings,
            manusPromptPreview: prompt.slice(0, 4000),
          },
          manus_task_id: task.task_id,
          manus_task_url: task.task_url || null,
        })
        .select('id')
        .single()

      if (error) {
        return { ok: false as const, error: error.message }
      }

      await writeAppLog({
        level: 'info',
        kind: 'chat',
        source: 'startChatResearch',
        message: `job ${job.id} task ${task.task_id}`,
        meta: {
          job_id: job.id,
          task_id: task.task_id,
          task_url: task.task_url,
          skill: skill?.slug,
          skill_value_keys: Object.keys(skillValues).filter((k) => skillValues[k]?.trim()),
          prompt_preview: prompt.slice(0, 500),
        },
      })

      return {
        ok: true as const,
        pending: true as const,
        jobId: job.id as string,
        manusTaskId: task.task_id,
        manusTaskUrl: task.task_url,
        content: [
          `## Researching with Manus…`,
          '',
          `Task: \`${task.task_id}\`${task.task_url ? ` — [open in Manus](${task.task_url})` : ''}`,
          '',
          'Waiting for the Manus **callback** (or poll) with real results. I will not invent headlines while this runs.',
        ].join('\n'),
      }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

/**
 * Poll job: if still waiting, pull Manus messages (works without webhook).
 * When research text exists, run LLM once and mark completed.
 */
export const pollChatResearch = createServerFn({ method: 'POST' })
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, status: 'failed', error: 'No database' }
    }
    const db = getDb()
    const { data: job, error } = await db
      .from('jobs')
      .select('*')
      .eq('id', data.jobId)
      .single()
    if (error || !job) {
      return {
        ok: false as const,
        status: 'failed',
        error: error?.message || 'not found',
      }
    }

    if (job.status === 'completed') {
      return {
        ok: true as const,
        status: 'completed' as const,
        content: job.output_text || '',
        manusTaskUrl: job.manus_task_url as string | undefined,
      }
    }
    if (job.status === 'failed') {
      return {
        ok: false as const,
        status: 'failed' as const,
        error: job.error || 'failed',
        manusTaskUrl: job.manus_task_url as string | undefined,
      }
    }

    // Still waiting — try to pull Manus messages (callback may have already fired)
    const taskId = job.manus_task_id as string
    const settings = resolveSettings(
      ((job.input || {}) as { settings?: Partial<ProviderSettings> }).settings,
    )
    const ctx = { apiKey: settings.manusApiKey || undefined }

    try {
      const messages = await manusListMessages(taskId, 50, ctx, {
        markdownFormat: 'markdown',
      })
      let extracted = extractManusResults(messages)
      let expandedFiles: Array<{
        filename: string
        path?: string
        content: string
        url?: string
      }> = []
      try {
        const expanded = await expandManusMarkdownAttachments(messages, extracted)
        expandedFiles = expanded.files || []
        if (expanded.text) {
          extracted = {
            ...extracted,
            text: expanded.text,
            allTexts: [
              ...(extracted.allTexts || []),
              ...expanded.files.map((f) => f.content).filter(Boolean),
            ],
          }
        }
      } catch {
        /* keep extracted */
      }

      // Task status — only treat as done when agent stopped AND we have substance
      let agentStatus = ''
      try {
        const detail = await manusGetTask(taskId, ctx)
        agentStatus = String(
          (detail as { status?: string }).status ||
            (detail as { task?: { status?: string } }).task?.status ||
            (detail as { data?: { status?: string } }).data?.status ||
            '',
        )
      } catch {
        /* optional */
      }

      // Use longest substantial chunk among all assistant messages
      const candidates = [
        extracted.text,
        ...((extracted as { allTexts?: string[] }).allTexts || []),
      ].filter(Boolean)
      const best =
        candidates
          .filter((c) => isSubstantialManusResearch(c))
          .sort((a, b) => b.length - a.length)[0] || ''
      const researchText = best || extracted.text
      const substantial = isSubstantialManusResearch(researchText)
      const terminal =
        agentStatus === 'stopped' ||
        agentStatus === 'completed' ||
        agentStatus === 'error'

      await writeAppLog({
        level: 'debug',
        kind: 'manus',
        source: 'pollChatResearch',
        message: `status=${agentStatus || '?'} substantial=${substantial} len=${extracted.text.length}`,
        meta: {
          job_id: data.jobId,
          task_id: taskId,
          text_len: extracted.text.length,
          agent_status: agentStatus,
          substantial,
        },
        response: {
          text_preview: extracted.text.slice(0, 500),
          types: extracted.rawTypes.slice(0, 30),
        },
      })

      // Prefer waiting until substantial research text exists
      if (substantial) {
        const rewritten = rewriteManusSandboxLinks(researchText, {
          taskId,
          taskUrl: job.manus_task_url || undefined,
          eventId: ((extracted as { eventIds?: string[] }).eventIds || [])[0],
        })
        const attSection = formatManusAttachmentsSection({
          files: (expandedFiles as { filename: string; path?: string; url?: string; content?: string }[]) || [],
          fileUrls: extracted.fileUrls,
          sandboxPaths: extracted.sandboxPaths,
          taskId,
          taskUrl: job.manus_task_url || undefined,
          eventId: ((extracted as { eventIds?: string[] }).eventIds || [])[0],
        })
        let researchBlock = rewritten
        if (attSection && !researchBlock.includes('## Attachments')) {
          researchBlock = researchBlock.trimEnd() + '\n\n' + attSection
        }
        // Persist attachment section on job for webhook/complete path
        await db
          .from('jobs')
          .update({
            output: {
              ...((typeof job.output === 'object' && job.output) || {}),
              attachments_markdown: attSection || null,
            },
          })
          .eq('id', data.jobId)
        const done = await completeChatResearchJob(
          data.jobId,
          researchBlock,
          job.manus_task_url || undefined,
          attSection || undefined,
        )
        if (done.ok) {
          return {
            ok: true as const,
            status: 'completed' as const,
            content: done.content || '',
            manusTaskUrl: job.manus_task_url as string | undefined,
          }
        }
        return {
          ok: false as const,
          status: 'failed' as const,
          error: done.error,
        }
      }

      // Terminal: if we have meaningful text (even partial), complete with it
      if (terminal && researchText && researchText.length > 120 && !substantial) {
        // Prefer completing with what we have rather than infinite wait
        const done = await completeChatResearchJob(
          data.jobId,
          researchText,
          job.manus_task_url || undefined,
        )
        if (done.ok) {
          return {
            ok: true as const,
            status: 'completed' as const,
            content: done.content || '',
            manusTaskUrl: job.manus_task_url as string | undefined,
          }
        }
      }

      // Terminal with only ack text → keep waiting a bit more is useless; report incomplete
      if (terminal && extracted.text && !substantial) {
        // One more listMessages in case final message lag
        await new Promise((r) => setTimeout(r, 2000))
        const messages2 = await manusListMessages(taskId, 50, ctx, {
          markdownFormat: 'markdown',
        })
        let ex2 = extractManusResults(messages2)
        try {
          const exp2 = await expandManusMarkdownAttachments(messages2, ex2)
          if (exp2.text) ex2 = { ...ex2, text: exp2.text }
        } catch { /* */ }
        if (isSubstantialManusResearch(ex2.text)) {
          const done = await completeChatResearchJob(
            data.jobId,
            ex2.text,
            job.manus_task_url || undefined,
          )
          if (done.ok) {
            return {
              ok: true as const,
              status: 'completed' as const,
              content: done.content || '',
              manusTaskUrl: job.manus_task_url as string | undefined,
            }
          }
        }
        // Still no substance after stop — do not invent; surface Manus text + link
        const fallback = [
          '## Manus finished without usable article list',
          '',
          `Task status: **${agentStatus}**`,
          job.manus_task_url ? `Open: ${job.manus_task_url}` : '',
          '',
          '### Raw Manus text',
          rewriteManusSandboxLinks(extracted.text || '(empty)', {
            taskId,
            taskUrl: job.manus_task_url || undefined,
          }),
          '',
          'I will not invent headlines. Retry research or open the Manus task for the full agent transcript.',
        ]
          .filter(Boolean)
          .join('\n')
        await db
          .from('jobs')
          .update({
            status: 'completed',
            output_text: fallback,
            output: { incomplete_research: true, agent_status: agentStatus },
            completed_at: new Date().toISOString(),
          })
          .eq('id', data.jobId)
        return {
          ok: true as const,
          status: 'completed' as const,
          content: fallback,
          manusTaskUrl: job.manus_task_url as string | undefined,
        }
      }
    } catch (e) {
      await writeAppLog({
        level: 'warn',
        kind: 'manus',
        source: 'pollChatResearch',
        message: 'listMessages failed',
        error: e instanceof Error ? e.message : String(e),
        meta: { job_id: data.jobId, task_id: taskId },
      })
    }

    return {
      ok: true as const,
      status: 'waiting_manus' as const,
      content: [
        `## Researching with Manus…`,
        '',
        `Task: \`${taskId}\`${job.manus_task_url ? ` — [open](${job.manus_task_url})` : ''}`,
        '',
        'Waiting for a **final** Manus research report (not the intermediate “searching…” message).',
      ].join('\n'),
      manusTaskUrl: job.manus_task_url as string | undefined,
    }
  })
