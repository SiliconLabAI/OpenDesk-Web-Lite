import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  emptyProfile,
  loadProfile,
  loadProfileRemote,
  saveProfile,
  type ClientProfile,
} from '~/lib/profile'
import { researchFromWebsite } from '~/lib/auto/research'
import { loadSettings } from '~/lib/settings/client'
import { Markdown } from '~/components/Markdown'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function hasMinimumProfile(p: ClientProfile): boolean {
  return Boolean(p.name?.trim() && (p.standing?.trim() || p.beats?.trim()))
}

function ProfilePage() {
  const [profile, setProfile] = useState<ClientProfile>(emptyProfile)
  const [website, setWebsite] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState<
    'standing' | 'beats' | 'competitors' | 'notes' | null
  >(null)

  useEffect(() => {
    ;(async () => {
      const res = await loadProfileRemote()
      if (res.ok && (res.profile.name || res.profile.standing)) {
        setProfile(res.profile)
        // keep cache in sync
        if (typeof window !== 'undefined') {
          localStorage.setItem(
            'newsjack-web-profile',
            JSON.stringify(res.profile),
          )
        }
      } else {
        setProfile(loadProfile())
      }
      if (!res.ok && res.error) {
        setMsg(`SQLite: ${res.error} — using local cache if any`)
      }
    })()
  }, [])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setEditing(null)
    try {
      const res = await saveProfile(profile, website || undefined)
      setSaved(true)
      if (res.ok) {
        setMsg(
          hasMinimumProfile(profile)
            ? 'Saved to SQLite. Skills and Chat can use it.'
            : 'Saved to SQLite — add name + standing or beats so skills unlock.',
        )
      } else {
        setMsg(
          `Local cache updated. SQLite error: ${res.error || 'unknown'}`,
        )
      }
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setBusy(false)
    }
  }

  async function onResearch() {
    if (!website.trim()) {
      setMsg('Enter a website URL.')
      return
    }
    setBusy(true)
    setMsg('Researching website…')
    setEditing(null)
    try {
      const res = await researchFromWebsite({
        data: {
          website: website.trim(),
          companyName: profile.name || undefined,
          settings: loadSettings(),
        },
      })
      if (res.ok && res.profile) {
        const next = {
          name: res.profile.name || profile.name,
          standing: res.profile.standing || '',
          beats: res.profile.beats || '',
          competitors: res.profile.competitors || '',
          notes: res.profile.notes || '',
        }
        setProfile(next)
        setMsg(
          `Filled via ${res.provider}. Review markdown, then Save to database.`,
        )
      } else {
        setMsg(
          ('error' in res && res.error) ||
            'Research failed — check Settings LLM keys.',
        )
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Client profile</h1>
        <p className="mt-2 text-[var(--muted)] text-sm leading-relaxed">
          Stored in <strong>SQLite</strong>. Required before skills or chat.
          Markdown fields render below; click to edit source.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
        <div className="text-xs font-medium text-[var(--muted)]">
          Auto-build from website
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="https://yourcompany.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={onResearch}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40"
          >
            {busy ? 'Researching…' : 'Research'}
          </button>
        </div>
        {msg && <p className="text-xs text-[var(--muted)]">{msg}</p>}
      </div>

      <form onSubmit={onSave} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Company name</span>
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            value={profile.name}
            onChange={(e) =>
              setProfile((p) => ({ ...p, name: e.target.value }))
            }
            required
          />
        </label>

        {(
          [
            ['standing', 'Standing / authority'],
            ['beats', 'Beats / topics'],
            ['competitors', 'Competitors'],
            ['notes', 'Notes'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{label}</span>
              <button
                type="button"
                className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                onClick={() =>
                  setEditing((cur) => (cur === key ? null : key))
                }
              >
                {editing === key ? 'Done editing' : 'Edit'}
              </button>
            </div>
            {editing === key ? (
              <textarea
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm min-h-[6rem] font-mono"
                value={profile[key]}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, [key]: e.target.value }))
                }
                placeholder="Markdown source…"
                autoFocus
              />
            ) : (
              <div
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 min-h-[4rem] cursor-text"
                onClick={() => setEditing(key)}
                title="Click to edit"
              >
                {profile[key]?.trim() ? (
                  <Markdown content={profile[key]} />
                ) : (
                  <span className="text-sm text-[var(--muted)]">
                    Empty — click to edit
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0a0a0b' }}
        >
          {saved ? 'Saved' : 'Save to database'}
        </button>
      </form>

      <p className="text-xs text-[var(--muted)]">
        Next:{' '}
        <Link to="/tools" className="underline text-[var(--accent-dim)]">
          Skills
        </Link>{' '}
        or{' '}
        <Link to="/chat" className="underline text-[var(--accent-dim)]">
          Chat
        </Link>
      </p>
    </div>
  )
}
