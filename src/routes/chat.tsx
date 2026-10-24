import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SKILLS, getSkill } from '~/lib/skills/catalog'
import {
  loadProfile,
  profileToPromptBlock,
} from '~/lib/profile'
import { loadSettings } from '~/lib/settings/client'
import { runChat } from '~/lib/chat/run'
import { pollChatResearch } from '~/lib/chat/researchJob'
import {
  deleteThread,
  loadThreads,
  newId,
  newUuid,
  upsertThread,
  type ChatMessage,
  type ChatThread,
} from '~/lib/chat/history'
import { Markdown } from '~/components/Markdown'
import { loadSkillDraft } from '~/lib/skills/drafts'

export const Route = createFileRoute('/chat')({
  component: ChatPage,
})


/** Poll a Manus research job until complete; returns final assistant content or null if still pending */
async function waitForResearchJob(
  jobId: string,
  opts?: { maxAttempts?: number; intervalMs?: number },
): Promise<{ status: string; content?: string; error?: string; manusTaskUrl?: string }> {
  const maxAttempts = opts?.maxAttempts ?? 90
  const intervalMs = opts?.intervalMs ?? 3000
  let last: { status: string; content?: string; error?: string; manusTaskUrl?: string } = {
    status: 'waiting_manus',
  }
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const poll = await pollChatResearch({ data: { jobId } })
      last = {
        status: poll.status || 'waiting_manus',
        content: poll.content,
        error: (poll as { error?: string }).error,
        manusTaskUrl: poll.manusTaskUrl,
      }
      if (poll.status === 'completed') return last
      if (poll.status === 'failed') return last
    } catch (e) {
      last = {
        status: 'waiting_manus',
        error: e instanceof Error ? e.message : String(e),
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return last
}

function profileReady(): boolean {
  const p = loadProfile()
  return Boolean(p.name?.trim() && (p.standing?.trim() || p.beats?.trim()))
}

function ChatPage() {
  const [ready, setReady] = useState(true)
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [skillSlugs, setSkillSlugs] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setReady(profileReady())
    ;(async () => {
      const list = await loadThreads()
      setThreads(list)
      if (list[0]) setActiveId(list[0].id)
    })()
  }, [])

  // Resume any pending Manus research jobs after load/refresh
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await loadThreads()
      for (const th of list) {
        const pending = th.messages.filter((m) => m.pending && m.jobId)
        for (const msg of pending) {
          if (cancelled || !msg.jobId) continue
          setBusy(true)
          try {
            const result = await waitForResearchJob(msg.jobId, {
              maxAttempts: 60,
              intervalMs: 3000,
            })
            if (cancelled) return
            if (result.status === 'completed') {
              const finalMsg: ChatMessage = {
                id: newUuid(),
                role: 'assistant',
                content: result.content || 'Research completed (empty output).',
                skillSlug: msg.skillSlug || th.skillSlug,
                createdAt: new Date().toISOString(),
                pending: false,
                jobId: msg.jobId,
                manusTaskUrl: result.manusTaskUrl || msg.manusTaskUrl,
              }
              const next: ChatThread = {
                ...th,
                messages: [
                  ...th.messages.filter((m) => m.id !== msg.id),
                  finalMsg,
                ],
                updatedAt: new Date().toISOString(),
              }
              await upsertThread(next)
              const refreshed = await loadThreads()
              if (!cancelled) {
                setThreads(refreshed)
              }
            } else if (result.status === 'failed') {
              const errMsg: ChatMessage = {
                id: newUuid(),
                role: 'assistant',
                content: `**Research failed:** ${result.error || 'unknown'}`,
                createdAt: new Date().toISOString(),
                pending: false,
                jobId: msg.jobId,
              }
              const next: ChatThread = {
                ...th,
                messages: [
                  ...th.messages.filter((m) => m.id !== msg.id),
                  errMsg,
                ],
                updatedAt: new Date().toISOString(),
              }
              await upsertThread(next)
              const refreshed = await loadThreads()
              if (!cancelled) setThreads(refreshed)
            }
          } finally {
            if (!cancelled) setBusy(false)
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const active = useMemo(
    () => threads.find((t) => t.id === activeId) || null,
    [threads, activeId],
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.messages, busy])

  async function persist(next: ChatThread) {
    await upsertThread(next)
    const list = await loadThreads()
    setThreads(list)
    setActiveId(next.id)
  }

  function startNew() {
    const t: ChatThread = {
      id: newUuid(),
      title: 'New chat',
      skillSlug: skillSlugs[0],
      skillSlugs: skillSlugs.length ? [...skillSlugs] : undefined,
      messages: [],
      updatedAt: new Date().toISOString(),
    }
    void persist(t)
  }

  function addSkill(slug: string) {
    setSkillSlugs((prev) => (prev.includes(slug) ? prev : [...prev, slug]))
    setSkillPickerOpen(false)
  }

  function removeSkill(slug: string) {
    setSkillSlugs((prev) => prev.filter((s) => s !== slug))
  }

  function moveSkill(slug: string, dir: -1 | 1) {
    setSkillSlugs((prev) => {
      const i = prev.indexOf(slug)
      if (i < 0) return prev
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault()
    if (!profileReady()) {
      setReady(false)
      return
    }
    const text = input.trim()
    if (!text || busy) return

    const pipeline = skillSlugs.length
      ? [...skillSlugs]
      : active?.skillSlugs?.length
        ? [...active.skillSlugs]
        : []

    let thread = active
    if (!thread) {
      thread = {
        id: newUuid(),
        title: text.slice(0, 48),
        skillSlug: pipeline[0],
        skillSlugs: pipeline.length ? pipeline : undefined,
        messages: [],
        updatedAt: new Date().toISOString(),
      }
    }

    const userMsg: ChatMessage = {
      id: newUuid(),
      role: 'user',
      content: text,
      skillSlug: pipeline[0],
      skillSlugs: pipeline.length ? pipeline : undefined,
      createdAt: new Date().toISOString(),
    }

    let withUser: ChatThread = {
      ...thread,
      title: thread.messages.length === 0 ? text.slice(0, 48) : thread.title,
      skillSlug: pipeline[0] || thread.skillSlug,
      skillSlugs: pipeline.length ? pipeline : thread.skillSlugs,
      messages: [...thread.messages, userMsg],
      updatedAt: new Date().toISOString(),
    }
    setInput('')
    await persist(withUser)
    setBusy(true)

    const profile = profileToPromptBlock(loadProfile())
    const settings = loadSettings()
    const priorOutputs: Array<{ skillSlug: string; content: string }> = []

    try {
      // No skills → single plain chat turn
      const steps = pipeline.length ? pipeline : [undefined]

      for (let step = 0; step < steps.length; step++) {
        const slug = steps[step]
        const stepLabel =
          pipeline.length > 1
            ? `Running /${slug} (${step + 1}/${pipeline.length})…`
            : slug
              ? `Running /${slug}…`
              : 'Thinking…'
        setBusyLabel(stepLabel)

        let skillValues: Record<string, string> | undefined
        if (slug) {
          try {
            const draft = await loadSkillDraft({ data: { skillSlug: slug } })
            if (draft.ok && draft.values) skillValues = draft.values
          } catch {
            /* no draft */
          }
        }

        // Messages for this step: full thread so far + prior skill outputs as system context via priorOutputs
        const res = await runChat({
          data: {
            messages: withUser.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            skillSlug: slug,
            skillValues,
            priorOutputs: priorOutputs.length ? priorOutputs : undefined,
            profile,
            settings,
          },
        })

        if (!res) {
          const errMsg: ChatMessage = {
            id: newUuid(),
            role: 'assistant',
            content: '**Error:** empty server response',
            skillSlug: slug,
            sequenceStep:
              pipeline.length > 1
                ? `${step + 1}/${pipeline.length}`
                : undefined,
            createdAt: new Date().toISOString(),
          }
          withUser = {
            ...withUser,
            messages: [...withUser.messages, errMsg],
            updatedAt: new Date().toISOString(),
          }
          await persist(withUser)
          break
        }

        // Manus pending for this skill step
        if (res.ok && res.pending && res.jobId) {
          const pendingMsg: ChatMessage = {
            id: newUuid(),
            role: 'assistant',
            content: res.content || `## Researching with Manus… (/${slug})`,
            skillSlug: slug,
            skillSlugs: pipeline.length ? pipeline : undefined,
            sequenceStep:
              pipeline.length > 1
                ? `${step + 1}/${pipeline.length}`
                : undefined,
            createdAt: new Date().toISOString(),
            jobId: res.jobId,
            pending: true,
            manusTaskId: res.manusTaskId,
            manusTaskUrl: res.manusTaskUrl,
          }
          withUser = {
            ...withUser,
            messages: [...withUser.messages, pendingMsg],
            updatedAt: new Date().toISOString(),
          }
          await persist(withUser)

          setBusyLabel(
            pipeline.length > 1
              ? `Waiting on Manus for /${slug} (${step + 1}/${pipeline.length})…`
              : `Waiting on Manus for /${slug}…`,
          )
          const result = await waitForResearchJob(res.jobId)
          if (result.status === 'completed') {
            const finalMsg: ChatMessage = {
              id: newUuid(),
              role: 'assistant',
              content: result.content || 'Research completed (empty output).',
              skillSlug: slug,
              skillSlugs: pipeline.length ? pipeline : undefined,
              sequenceStep:
                pipeline.length > 1
                  ? `${step + 1}/${pipeline.length}`
                  : undefined,
              createdAt: new Date().toISOString(),
              pending: false,
              jobId: res.jobId,
              manusTaskUrl: result.manusTaskUrl || res.manusTaskUrl,
            }
            withUser = {
              ...withUser,
              messages: [
                ...withUser.messages.filter((m) => m.id !== pendingMsg.id),
                finalMsg,
              ],
              updatedAt: new Date().toISOString(),
            }
            await persist(withUser)
            if (slug && finalMsg.content) {
              priorOutputs.push({ skillSlug: slug, content: finalMsg.content })
            }
          } else if (result.status === 'failed') {
            const errMsg: ChatMessage = {
              id: newUuid(),
              role: 'assistant',
              content: `**Research failed** (/${slug}): ${result.error || 'unknown'}`,
              skillSlug: slug,
              sequenceStep:
                pipeline.length > 1
                  ? `${step + 1}/${pipeline.length}`
                  : undefined,
              createdAt: new Date().toISOString(),
              pending: false,
              jobId: res.jobId,
            }
            withUser = {
              ...withUser,
              messages: [
                ...withUser.messages.filter((m) => m.id !== pendingMsg.id),
                errMsg,
              ],
              updatedAt: new Date().toISOString(),
            }
            await persist(withUser)
            break
          } else {
            const stillMsg: ChatMessage = {
              ...pendingMsg,
              content: [
                `## Researching with Manus… (/${slug})`,
                '',
                'Task: `' +
                  (res.manusTaskId || '') +
                  '`' +
                  (res.manusTaskUrl
                    ? ' — [open in Manus](' + res.manusTaskUrl + ')'
                    : ''),
                '',
                'Still waiting. Refresh later to resume; remaining skills in the sequence will not run until this completes.',
              ].join('\n'),
              pending: true,
              jobId: res.jobId,
            }
            withUser = {
              ...withUser,
              messages: [
                ...withUser.messages.filter((m) => m.id !== pendingMsg.id),
                stillMsg,
              ],
              updatedAt: new Date().toISOString(),
            }
            await persist(withUser)
            break
          }
          continue
        }

        // Sync reply
        const content = res.ok
          ? res.content || ''
          : `**Error:** ${res.error || 'Chat failed'}`
        const assistant: ChatMessage = {
          id: newUuid(),
          role: 'assistant',
          content,
          skillSlug: slug,
          skillSlugs: pipeline.length ? pipeline : undefined,
          sequenceStep:
            pipeline.length > 1
              ? `${step + 1}/${pipeline.length}`
              : undefined,
          createdAt: new Date().toISOString(),
        }
        withUser = {
          ...withUser,
          messages: [...withUser.messages, assistant],
          updatedAt: new Date().toISOString(),
        }
        await persist(withUser)
        if (slug && res.ok && content) {
          priorOutputs.push({ skillSlug: slug, content })
        }
        if (!res.ok) break
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const errMsg: ChatMessage = {
        id: newUuid(),
        role: 'assistant',
        content: `**Error:** ${msg}`,
        createdAt: new Date().toISOString(),
      }
      await persist({
        ...withUser,
        messages: [...withUser.messages, errMsg],
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }


  if (!ready) {
    return (
      <div className="max-w-lg mx-auto mt-12 space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-xl font-semibold">Profile required</h1>
        <p className="text-sm text-[var(--muted)]">
          Chat needs a client profile so the agent has company context.
        </p>
        <Link
          to="/profile"
          className="inline-flex rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#0a0a0b' }}
        >
          Set up profile
        </Link>
      </div>
    )
  }

  const attachedSkills = skillSlugs
    .map((s) => getSkill(s))
    .filter(Boolean) as ReturnType<typeof getSkill>[]

  return (
    <div className="flex h-[calc(100vh-3.5rem-3rem)] max-w-6xl mx-auto gap-4 -mt-2">
      {/* Sidebar history */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border border-[var(--border)] rounded-xl bg-[var(--surface)] overflow-hidden">
        <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--muted)]">History</span>
          <button
            type="button"
            onClick={startNew}
            className="text-xs text-[var(--accent-dim)]"
          >
            + New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm cursor-pointer ${
                t.id === activeId
                  ? 'bg-[var(--surface-2)]'
                  : 'hover:bg-[var(--surface-2)]/60'
              }`}
              onClick={() => {
                setActiveId(t.id)
                setSkillSlugs(
                  t.skillSlugs?.length
                    ? [...t.skillSlugs]
                    : t.skillSlug
                      ? [t.skillSlug]
                      : [],
                )
              }}
            >
              <span className="flex-1 truncate">{t.title || 'Untitled'}</span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-xs text-[var(--muted)]"
                onClick={async (e) => {
                  e.stopPropagation()
                  await deleteThread(t.id)
                  const next = await loadThreads()
                  setThreads(next)
                  if (activeId === t.id) setActiveId(next[0]?.id || null)
                }}
              >
                ×
              </button>
            </div>
          ))}
          {threads.length === 0 && (
            <p className="text-xs text-[var(--muted)] p-2">No chats yet</p>
          )}
        </div>
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0 border border-[var(--border)] rounded-xl bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">Chat</span>
          <span className="text-xs text-[var(--muted)]">
            {loadProfile().name}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className="md:hidden text-xs text-[var(--accent-dim)]"
            onClick={startNew}
          >
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {(!active || active.messages.length === 0) && !busy && (
            <div className="text-center text-sm text-[var(--muted)] mt-16 space-y-2">
              <p>Ask anything PR-related, or attach one or more skills below (they run in order).</p>
              <p className="text-xs">
                Profile and conversation history stay in context.
              </p>
            </div>
          )}

          {active?.messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]'
                    : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)]'
                }`}
              >
                {(m.skillSlug || (m.skillSlugs && m.skillSlugs.length > 0)) && (
                  <div className="text-[10px] text-[var(--muted)] mb-1 font-mono flex flex-wrap gap-1">
                    {m.role === 'user' && m.skillSlugs && m.skillSlugs.length > 1 ? (
                      m.skillSlugs.map((s, i) => (
                        <span key={s}>
                          {i > 0 ? '→ ' : ''}/{s}
                        </span>
                      ))
                    ) : (
                      <>
                        {m.skillSlug ? `/${m.skillSlug}` : null}
                        {m.sequenceStep ? (
                          <span className="opacity-70"> · step {m.sequenceStep}</span>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
                <div>
                  <Markdown content={m.content} />
                </div>
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 bg-[var(--bg)] border border-[var(--border)] space-y-2">
                <div className="text-xs text-[var(--muted)]">
                  {busyLabel ||
                    'Working… (live research may take up to ~3 min)'}
                </div>
                <div className="shimmer-lines">
                  <div className="shimmer-line w-48" />
                  <div className="shimmer-line w-64" />
                  <div className="shimmer-line w-40" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-[var(--border)] p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {attachedSkills.map((s, idx) => (
              <div
                key={s!.slug}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-dim)] bg-[var(--accent)]/10 px-2 py-1 text-xs"
              >
                <span className="text-[10px] text-[var(--muted)] font-mono">
                  {idx + 1}.
                </span>
                <span>{s!.icon}</span>
                <span>/{s!.slug}</span>
                {attachedSkills.length > 1 && (
                  <>
                    <button
                      type="button"
                      title="Move earlier"
                      className="opacity-60 hover:opacity-100 px-0.5"
                      onClick={() => moveSkill(s!.slug, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Move later"
                      className="opacity-60 hover:opacity-100 px-0.5"
                      onClick={() => moveSkill(s!.slug, 1)}
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  type="button"
                  title="Remove"
                  className="opacity-60 hover:opacity-100 ml-0.5"
                  onClick={() => removeSkill(s!.slug)}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSkillPickerOpen((o) => !o)}
              className="inline-flex items-center rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              + Add skill
            </button>
            {skillSlugs.length > 1 && (
              <span className="text-[10px] text-[var(--muted)]">
                Runs in order left → right
              </span>
            )}
          </div>

          {skillPickerOpen && (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {SKILLS.map((s) => {
                const on = skillSlugs.includes(s.slug)
                return (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => (on ? removeSkill(s.slug) : addSkill(s.slug))}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] ${
                      on
                        ? 'border-[var(--accent-dim)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)]'
                    }`}
                  >
                    <span>{s.icon}</span>
                    {s.name}
                    {on ? ' ✓' : ''}
                  </button>
                )
              })}
            </div>
          )}

          <form onSubmit={onSend} className="flex gap-2">
            <textarea
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm min-h-[2.75rem] max-h-32 resize-y"
              placeholder={
                skillSlugs.length > 1
                  ? `Message with sequence: ${skillSlugs.map((s) => '/' + s).join(' → ')}…`
                  : skillSlugs.length === 1
                    ? `Message with /${skillSlugs[0]}…`
                    : 'Message Newsjack…'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSend()
                }
              }}
              rows={1}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="self-end rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#0a0a0b' }}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
