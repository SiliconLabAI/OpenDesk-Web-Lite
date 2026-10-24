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
  const [skillSlug, setSkillSlug] = useState<string | undefined>()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
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
      skillSlug,
      messages: [],
      updatedAt: new Date().toISOString(),
    }
    void persist(t)
  }

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault()
    if (!profileReady()) {
      setReady(false)
      return
    }
    const text = input.trim()
    if (!text || busy) return

    let thread = active
    if (!thread) {
      thread = {
        id: newUuid(),
        title: text.slice(0, 48),
        skillSlug,
        messages: [],
        updatedAt: new Date().toISOString(),
      }
    }

    const userMsg: ChatMessage = {
      id: newUuid(),
      role: 'user',
      content: text,
      skillSlug,
      createdAt: new Date().toISOString(),
    }

    const withUser: ChatThread = {
      ...thread,
      title:
        thread.messages.length === 0 ? text.slice(0, 48) : thread.title,
      skillSlug: skillSlug || thread.skillSlug,
      messages: [...thread.messages, userMsg],
      updatedAt: new Date().toISOString(),
    }
    await persist(withUser)
    setInput('')
    setBusy(true)

    try {
      let skillValues: Record<string, string> | undefined
      const slug = skillSlug || withUser.skillSlug
      if (slug) {
        try {
          const draft = await loadSkillDraft({ data: { skillSlug: slug } })
          if (draft.ok && draft.values) skillValues = draft.values
        } catch {
          /* no draft */
        }
      }

      const res = await runChat({
        data: {
          messages: withUser.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          skillSlug: slug,
          skillValues,
          profile: profileToPromptBlock(loadProfile()),
          settings: loadSettings(),
        },
      })

      if (!res) {
        throw new Error('Chat failed (empty server response)')
      }

      // Manus async research: show pending, then poll until callback/poll completes
      if (res.ok && res.pending && res.jobId) {
        const pendingMsg: ChatMessage = {
          id: newUuid(),
          role: 'assistant',
          content: res.content || '## Researching with Manus…',
          skillSlug: skillSlug || withUser.skillSlug,
          createdAt: new Date().toISOString(),
          jobId: res.jobId,
          pending: true,
          manusTaskId: res.manusTaskId,
          manusTaskUrl: res.manusTaskUrl,
        }
        let thread = {
          ...withUser,
          messages: [...withUser.messages, pendingMsg],
          updatedAt: new Date().toISOString(),
        }
        await persist(thread)

        const result = await waitForResearchJob(res.jobId)
        if (result.status === 'completed') {
          const finalMsg: ChatMessage = {
            id: newUuid(),
            role: 'assistant',
            content: result.content || 'Research completed (empty output).',
            skillSlug: skillSlug || withUser.skillSlug,
            createdAt: new Date().toISOString(),
            pending: false,
            jobId: res.jobId,
            manusTaskUrl: result.manusTaskUrl || res.manusTaskUrl,
          }
          thread = {
            ...thread,
            messages: [
              ...thread.messages.filter((m) => m.id !== pendingMsg.id),
              finalMsg,
            ],
            updatedAt: new Date().toISOString(),
          }
          await persist(thread)
        } else if (result.status === 'failed') {
          const errMsg: ChatMessage = {
            id: newUuid(),
            role: 'assistant',
            content: `**Research failed:** ${result.error || 'unknown'}`,
            createdAt: new Date().toISOString(),
            pending: false,
            jobId: res.jobId,
          }
          thread = {
            ...thread,
            messages: [
              ...thread.messages.filter((m) => m.id !== pendingMsg.id),
              errMsg,
            ],
            updatedAt: new Date().toISOString(),
          }
          await persist(thread)
        } else {
          // Keep pending message with jobId so refresh can resume
          const stillMsg: ChatMessage = {
            ...pendingMsg,
            content: [
              '## Researching with Manus…',
              '',
              'Task: `' +
                (res.manusTaskId || '') +
                '`' +
                (res.manusTaskUrl
                  ? ' — [open in Manus](' + res.manusTaskUrl + ')'
                  : ''),
              '',
              'Still waiting. Keep this tab open, or refresh later — the job will resume automatically.',
            ].join('\n'),
            pending: true,
            jobId: res.jobId,
          }
          thread = {
            ...thread,
            messages: [
              ...thread.messages.filter((m) => m.id !== pendingMsg.id),
              stillMsg,
            ],
            updatedAt: new Date().toISOString(),
          }
          await persist(thread)
        }
      } else {

        const assistant: ChatMessage = {
          id: newUuid(),
          role: 'assistant',
          content:
            res.ok
              ? res.content || ''
              : `**Error:** ${res.error || 'Chat failed'}`,
          skillSlug: skillSlug || withUser.skillSlug,
          createdAt: new Date().toISOString(),
        }
        await persist({
          ...withUser,
          messages: [...withUser.messages, assistant],
          updatedAt: new Date().toISOString(),
        })
      }
    } catch (err) {
      const assistant: ChatMessage = {
        id: newUuid(),
        role: 'assistant',
        content: `**Error:** ${err instanceof Error ? err.message : String(err)}`,
        createdAt: new Date().toISOString(),
      }
      await persist({
        ...withUser,
        messages: [...withUser.messages, assistant],
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setBusy(false)
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

  const attached = skillSlug ? getSkill(skillSlug) : null

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
                setSkillSlug(t.skillSlug)
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
              <p>Ask anything PR-related, or attach a skill below.</p>
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
                {m.skillSlug && m.role === 'user' && (
                  <div className="text-[10px] text-[var(--muted)] mb-1 font-mono">
                    /{m.skillSlug}
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
                  Waiting for Manus research (up to ~3 min) then writing the reply…
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
            {attached ? (
              <button
                type="button"
                onClick={() => setSkillSlug(undefined)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-dim)] bg-[var(--accent)]/10 px-3 py-1 text-xs"
              >
                <span>{attached.icon}</span>
                <span>/{attached.slug}</span>
                <span className="opacity-60">×</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSkillPickerOpen((o) => !o)}
                className="inline-flex items-center rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                + Attach skill
              </button>
            )}
          </div>

          {skillPickerOpen && !attached && (
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {SKILLS.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => {
                    setSkillSlug(s.slug)
                    setSkillPickerOpen(false)
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]"
                >
                  <span>{s.icon}</span>
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={onSend} className="flex gap-2">
            <textarea
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm min-h-[2.75rem] max-h-32 resize-y"
              placeholder={
                attached
                  ? `Message with /${attached.slug}…`
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
