import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { clearAppLogs, listAppLogs } from '~/lib/logs/write'

export const Route = createFileRoute('/logs')({
  component: LogsPage,
})

type LogRow = {
  id: string
  level: string
  source: string
  kind: string
  message: string
  request: Record<string, unknown>
  response: Record<string, unknown>
  meta: Record<string, unknown>
  duration_ms: number | null
  error: string | null
  created_at: string
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)] font-medium">
        {title}
      </div>
      <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-2.5 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  )
}

function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [error, setError] = useState('')
  const [kind, setKind] = useState('')
  const [level, setLevel] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const res = await listAppLogs({
        data: {
          limit: 150,
          kind: kind || undefined,
          level: level || undefined,
        },
      })
      if (!res || !res.ok) {
        setError((res && res.error) || 'Failed to load logs')
        setLogs([])
      } else {
        setError('')
        setLogs((res.logs || []) as LogRow[])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [kind, level])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            LLM, Manus, chat, and skill API traces in{' '}
            <code className="text-xs">app_logs</code>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All kinds</option>
            <option value="llm">llm</option>
            <option value="manus">manus</option>
            <option value="chat">chat</option>
            <option value="skill">skill</option>
            <option value="medialyst">medialyst</option>
            <option value="webhook">webhook</option>
          </select>
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">All levels</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="debug">debug</option>
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            {busy ? '…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-red-400"
            onClick={async () => {
              if (!confirm('Clear all logs for this org?')) return
              await clearAppLogs()
              void refresh()
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 border border-red-900/40 rounded-lg p-3">
          {error}
        </p>
      )}

      <ul className="space-y-3">
        {logs.map((log) => {
          const isOpen = openId === log.id
          const levelColor =
            log.level === 'error'
              ? 'bg-red-500/15 text-red-400 border-red-500/30'
              : log.level === 'warn'
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                : log.level === 'debug'
                  ? 'bg-slate-500/15 text-slate-400 border-slate-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'

          return (
            <li
              key={log.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
            >
              <button
                type="button"
                className="w-full text-left px-4 py-3 space-y-2 hover:bg-[var(--surface-2)]/40 transition-colors"
                onClick={() => setOpenId(isOpen ? null : log.id)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${levelColor}`}
                  >
                    {log.level}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--muted)]">
                    {log.kind}
                  </span>
                  <span className="text-xs text-[var(--muted)] font-mono">
                    {log.source}
                  </span>
                  <span className="ml-auto text-xs text-[var(--muted)]">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm text-[var(--text)] leading-snug">
                  {log.message}
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-[var(--muted)]">
                  {log.duration_ms != null && (
                    <span>{log.duration_ms} ms</span>
                  )}
                  {log.error && (
                    <span className="text-red-400 truncate max-w-md">
                      {log.error}
                    </span>
                  )}
                  <span className="text-[var(--muted)]">
                    {isOpen ? '▾ hide details' : '▸ show details'}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-[var(--border)] px-4 py-3 grid gap-3 sm:grid-cols-1">
                  {log.error && (
                    <Section title="Error">
                      <span className="text-red-400">{log.error}</span>
                    </Section>
                  )}
                  <Section title="Request">
                    {JSON.stringify(log.request ?? {}, null, 2)}
                  </Section>
                  <Section title="Response">
                    {JSON.stringify(log.response ?? {}, null, 2)}
                  </Section>
                  {log.meta && Object.keys(log.meta).length > 0 && (
                    <Section title="Meta">
                      {JSON.stringify(log.meta, null, 2)}
                    </Section>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[var(--muted)]">
                    <div>
                      <div className="uppercase tracking-wide text-[10px]">
                        Kind
                      </div>
                      <div className="text-[var(--text)]">{log.kind}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-wide text-[10px]">
                        Source
                      </div>
                      <div className="text-[var(--text)]">{log.source}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-wide text-[10px]">
                        Duration
                      </div>
                      <div className="text-[var(--text)]">
                        {log.duration_ms != null
                          ? `${log.duration_ms} ms`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="uppercase tracking-wide text-[10px]">
                        Id
                      </div>
                      <div className="text-[var(--text)] font-mono truncate">
                        {log.id}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </li>
          )
        })}
        {!logs.length && !error && (
          <p className="text-sm text-[var(--muted)]">No logs yet.</p>
        )}
      </ul>
    </div>
  )
}
