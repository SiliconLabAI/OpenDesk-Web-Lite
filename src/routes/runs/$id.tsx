import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb, hasDb } from '~/lib/db/server'
import { Markdown } from '~/components/Markdown'

const loadJob = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (!hasDb()) {
      return { ok: false as const, job: null, artifacts: [], error: 'No database' }
    }
    const db = getDb()
    const { data: job, error } = await db.from('jobs').select('*').eq('id', data.id).single()
    if (error) return { ok: false as const, job: null, artifacts: [], error: error.message }
    const { data: artifacts } = await db
      .from('artifacts')
      .select('*')
      .eq('job_id', data.id)
      .order('created_at', { ascending: false })
    return { ok: true as const, job, artifacts: artifacts || [] }
  })

export const Route = createFileRoute('/runs/$id')({
  loader: ({ params }) => loadJob({ data: { id: params.id } }),
  component: RunDetailPage,
})

function RunDetailPage() {
  const { job, artifacts, error, ok } = Route.useLoaderData()

  if (!ok || !job) {
    return (
      <div className="space-y-4">
        <Link to="/runs" className="text-sm text-[var(--muted)]">
          ← Runs
        </Link>
        <p className="text-[var(--danger)]">{error || 'Not found'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Link to="/runs" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
        ← Runs
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          {job.skill_slug || job.kind}{' '}
          <span className="text-base font-normal text-[var(--muted)]">({job.status})</span>
        </h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Created {new Date(job.created_at).toLocaleString()}
          {job.completed_at
            ? ` · Completed ${new Date(job.completed_at).toLocaleString()}`
            : ''}
        </p>
      </div>

      {job.manus_task_url && (
        <a
          href={job.manus_task_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-sm text-[var(--accent-dim)] underline"
        >
          View Manus task
        </a>
      )}

      {job.error && (
        <p className="text-sm text-[var(--danger)]">Error: {job.error}</p>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Input</h2>
        <pre className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs overflow-x-auto">
          {JSON.stringify(job.input, null, 2)}
        </pre>
      </section>

      {job.output_text && (
        <section className="space-y-2">
          <h2 className="font-semibold">Output</h2>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <Markdown content={job.output_text} />
          </div>
        </section>
      )}

      {artifacts.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Artifacts</h2>
          <ul className="space-y-1 text-sm">
            {artifacts.map((a: { id: string; kind: string; external_url: string | null }) => (
              <li key={a.id}>
                <span className="text-[var(--muted)]">{a.kind}: </span>
                {a.external_url ? (
                  <a href={a.external_url} className="text-[var(--accent-dim)] underline" target="_blank" rel="noreferrer">
                    download
                  </a>
                ) : (
                  '—'
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
