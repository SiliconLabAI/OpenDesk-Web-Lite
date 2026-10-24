import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getDb, hasDb } from '~/lib/db/server'
import type { JobRow } from '~/lib/db/types'

const listJobs = createServerFn({ method: 'GET' }).handler(async () => {
  if (!hasDb()) {
    return { ok: false as const, jobs: [] as JobRow[], error: 'Database not configured' }
  }
  const db = getDb()
  const { data, error } = await db
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return { ok: false as const, jobs: [] as JobRow[], error: error.message }
  return { ok: true as const, jobs: (data || []) as JobRow[] }
})

export const Route = createFileRoute('/runs/')({
  loader: () => listJobs(),
  component: RunsPage,
})

function statusColor(s: string) {
  if (s === 'completed') return 'var(--ai)'
  if (s === 'failed') return 'var(--danger)'
  if (s === 'waiting_manus' || s === 'running') return 'var(--detect)'
  return 'var(--muted)'
}

function RunsPage() {
  const data = Route.useLoaderData()
  const jobs = data.jobs || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Runs</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Skill runs and Manus browser jobs (press-clip, coverage-reel). Status updates via
          webhook when Manus completes.
        </p>
      </div>

      {!data.ok && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          {data.error}. Add SQLite env vars to persist Full Mode jobs.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm text-left">
          <thead className="bg-[var(--surface)] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Manus</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[var(--muted)]">
                  No jobs yet. Run a skill or press-clip to create one.
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <span className="font-medium">{j.skill_slug || j.kind}</span>
                </td>
                <td className="px-3 py-2">
                  <span style={{ color: statusColor(j.status) }}>{j.status}</span>
                </td>
                <td className="px-3 py-2">
                  {j.manus_task_url ? (
                    <a
                      href={j.manus_task_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent-dim)] underline"
                    >
                      open
                    </a>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[var(--muted)]">
                  {new Date(j.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to="/runs/$id"
                    params={{ id: j.id }}
                    className="text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    detail →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
