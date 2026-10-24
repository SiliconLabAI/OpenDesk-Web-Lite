import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { getSkill } from '~/lib/skills/catalog'
import { runSkill } from '~/lib/skills/run'
import {
  startCoverageReelJob,
  startPressClipJob,
} from '~/lib/jobs/browser'
import {
  loadProfile,
  loadProfileRemote,
  profileToPromptBlock,
} from '~/lib/profile'
import { loadSettings } from '~/lib/settings/client'
import { enrichSkillInputs } from '~/lib/auto/research'
import { Markdown } from '~/components/Markdown'
import { loadSkillDraft, saveSkillDraft } from '~/lib/skills/drafts'

export const Route = createFileRoute('/tools/$slug')({
  component: ToolPage,
})

function profileReady(): boolean {
  const p = loadProfile()
  return Boolean(p.name?.trim() && (p.standing?.trim() || p.beats?.trim()))
}

function ToolPage() {
  const { slug } = Route.useParams()
  const skill = getSkill(slug)

  const initial = useMemo(() => {
    if (!skill) return {} as Record<string, string>
    const o: Record<string, string> = {}
    for (const i of skill.inputs) o[i.id] = ''
    return o
  }, [skill])

  const [values, setValues] = useState<Record<string, string>>(initial)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState('')
  const [hasProfile, setHasProfile] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const pr = await loadProfileRemote()
        if (pr.ok && pr.profile) {
          localStorage.setItem('newsjack-web-profile', JSON.stringify(pr.profile))
        }
      } catch { /* cache */ }
      setHasProfile(profileReady())
      if (!skill) return
      try {
        const draft = await loadSkillDraft({ data: { skillSlug: skill.slug } })
        if (draft.ok && draft.values) {
          setValues((prev) => ({ ...prev, ...draft.values }))
          setStatus(
            draft.updatedAt
              ? `Loaded saved draft (${new Date(draft.updatedAt).toLocaleString()})`
              : 'Loaded saved draft',
          )
        }
      } catch {
        /* ignore */
      }
    })()
  }, [skill])

  if (!skill) {
    return (
      <div>
        <p>Unknown skill.</p>
        <Link to="/tools" className="text-[var(--accent-dim)] underline">
          Back
        </Link>
      </div>
    )
  }

  function setField(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  function loadExample() {
    if (!skill?.examples) return
    setValues((prev) => ({ ...prev, ...skill.examples }))
    setStatus('Example loaded — edit anything, then Run.')
  }

  async function onAutoFill() {
    if (!profileReady()) {
      setError('Save a client profile first (name + standing or beats).')
      return
    }
    setBusy(true)
    setStatus('Inferring missing fields from profile…')
    setError('')
    try {
      const settings = loadSettings()
      const profile = profileToPromptBlock(loadProfile())
      const res = await enrichSkillInputs({
        data: {
          slug: skill.slug,
          values,
          profile: profile || undefined,
          settings,
        },
      })
      if (res.ok) {
        setValues(res.values)
        setStatus(
          res.filled.length
            ? `Filled: ${res.filled.join(', ')}`
            : 'Nothing empty to fill (or LLM unavailable).',
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSaveDraft() {
    if (!skill) return
    setBusy(true)
    setError('')
    try {
      const res = await saveSkillDraft({
        data: {
          skillSlug: skill.slug,
          values,
          title: skill.name,
          profileName: loadProfile().name || undefined,
        },
      })
      setStatus(
        res.ok
          ? 'Draft saved to SQLite for this skill.'
          : `Save failed: ${res.error || 'unknown'} — check SQLITE_PATH / data directory`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profileReady()) {
      setError('A client profile is required. Configure it on the Profile page first.')
      setHasProfile(false)
      return
    }
    setBusy(true)
    setError('')
    setOutput('')
    setProvider('')
    setStatus('')
    try {
      const profile = profileToPromptBlock(loadProfile())
      const settings = loadSettings()

      if (skill.browserWorker) {
        if (skill.slug === 'press-clip') {
          const res = await startPressClipJob({
            data: {
              url: values.url,
              mention: values.mention,
              brandNotes: profile || undefined,
              manusApiKey: settings.manusApiKey || undefined,
            },
          })
          if (!res || !res.ok) setError((res && res.error) || 'Job failed')
          else {
            setOutput(
              [
                '## Manus press-clip job queued',
                '',
                `- **Job ID:** \`${res.jobId}\``,
                `- **Manus task:** \`${res.manusTaskId}\``,
                res.taskUrl ? `- **Task URL:** ${res.taskUrl}` : '',
                '',
                'Results arrive via webhook → **Runs**.',
              ]
                .filter(Boolean)
                .join('\n'),
            )
            setProvider('manus')
          }
        } else if (skill.slug === 'coverage-reel') {
          const res = await startCoverageReelJob({
            data: {
              notes: values.notes,
              brandNotes: profile || undefined,
              manusApiKey: settings.manusApiKey || undefined,
            },
          })
          if (!res || !res.ok) setError((res && res.error) || 'Job failed')
          else {
            setOutput(
              [
                '## Manus coverage-reel job queued',
                '',
                `- **Job ID:** \`${res.jobId}\``,
                `- **Manus task:** \`${res.manusTaskId}\``,
                res.taskUrl ? `- **Task URL:** ${res.taskUrl}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            )
            setProvider('manus')
          }
        }
      } else {
        const res = await runSkill({
          data: {
            slug: skill.slug,
            values,
            profile: profile || undefined,
            settings,
          },
        })
        if (!res || !res.ok) setError((res && res.error) || 'Run failed')
        setOutput((res && res.output) || '')
        setProvider((res && res.provider) || '')
        // Persist form values to SQLite after every run
        const draftRes = await saveSkillDraft({
          data: {
            skillSlug: skill.slug,
            values,
            title: skill.name,
            profileName: loadProfile().name || undefined,
          },
        })
        if (draftRes.ok) {
          setStatus('Auto-saved draft to SQLite')
        } else if (draftRes.error) {
          setStatus(`Draft not saved: ${draftRes.error}`)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!hasProfile && !profileReady()) {
    return (
      <div className="max-w-lg space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-xl font-semibold">Profile required</h1>
        <p className="text-sm text-[var(--muted)]">
          Skills need a client profile (company name + standing or beats) so the
          agent has context — same as local newsjack.
        </p>
        <Link
          to="/profile"
          className="inline-flex rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#0a0a0b' }}
        >
          Set up profile
        </Link>
        <div>
          <Link to="/tools" className="text-sm text-[var(--muted)] underline">
            ← Back to skills
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          to="/tools"
          className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          ← Skills
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight flex items-center gap-2">
          <span>{skill.icon}</span> {skill.name}
        </h1>
        <p className="mt-2 text-[var(--muted)] text-sm">{skill.description}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Using profile: <strong>{loadProfile().name || '—'}</strong>
          {' · '}
          <Link to="/profile" className="underline text-[var(--accent-dim)]">
            edit
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAutoFill}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40"
        >
          Fill empty fields from profile
        </button>
        {skill.examples && (
          <button
            type="button"
            onClick={loadExample}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--accent-dim)]"
          >
            Try example
          </button>
        )}
      </div>
      {status && <p className="text-xs text-[var(--muted)]">{status}</p>}

      <form onSubmit={onSubmit} className="space-y-4">
        {skill.inputs.map((input) => (
          <label key={input.id} className="block space-y-1.5">
            <span className="text-sm font-medium">
              {input.label}
              {input.required ? (
                <span className="text-[var(--accent)]"> *</span>
              ) : null}
            </span>
            {input.type === 'textarea' ? (
              <textarea
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm min-h-[6rem]"
                rows={input.rows || 5}
                placeholder={input.placeholder}
                value={values[input.id] || ''}
                onChange={(e) => setField(input.id, e.target.value)}
                required={input.required}
              />
            ) : (
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                placeholder={input.placeholder}
                value={values[input.id] || ''}
                onChange={(e) => setField(input.id, e.target.value)}
                required={input.required}
              />
            )}
          </label>
        ))}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0a0a0b' }}
          >
            {busy
              ? 'Running…'
              : skill.browserWorker
                ? 'Start Manus job'
                : 'Run skill'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSaveDraft}
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm disabled:opacity-40"
          >
            Save draft to SQLite
          </button>
        </div>
      </form>

      {error && (
        <p className="text-sm text-red-400 border border-red-900/40 rounded-lg p-3">
          {error}
        </p>
      )}

      {output && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)] mb-3">
            Result {provider ? `· ${provider}` : ''}
          </div>
          <Markdown content={output} />
        </div>
      )}
    </div>
  )
}
