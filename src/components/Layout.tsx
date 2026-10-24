import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#0a0a0b' }}
            >
              nj
            </span>
            <span>
              newsjack <span className="text-[var(--muted)] font-normal">web</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/chat"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              activeProps={{
                className:
                  'px-3 py-1.5 rounded-md bg-[var(--surface-2)] text-[var(--text)]',
              }}
            >
              Chat
            </Link>
            <Link
              to="/tools"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              activeProps={{
                className:
                  'px-3 py-1.5 rounded-md bg-[var(--surface-2)] text-[var(--text)]',
              }}
            >
              Skills
            </Link>
            <Link
              to="/monitors"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              activeProps={{
                className:
                  'px-3 py-1.5 rounded-md bg-[var(--surface-2)] text-[var(--text)]',
              }}
            >
              Monitors
            </Link>
            <Link
              to="/runs"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              activeProps={{
                className:
                  'px-3 py-1.5 rounded-md bg-[var(--surface-2)] text-[var(--text)]',
              }}
            >
              Runs
            </Link>
            <Link
              to="/profile"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              activeProps={{
                className:
                  'px-3 py-1.5 rounded-md bg-[var(--surface-2)] text-[var(--text)]',
              }}
            >
              Profile
            </Link>
            <Link
              to="/logs"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              activeProps={{
                className:
                  'px-3 py-1.5 rounded-md bg-[var(--surface-2)] text-[var(--text)]',
              }}
            >
              Logs
            </Link>
            <Link
              to="/settings"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              activeProps={{
                className:
                  'px-3 py-1.5 rounded-md bg-[var(--surface-2)] text-[var(--text)]',
              }}
            >
              Settings
            </Link>
            <a
              href="https://github.com/elvisun/newsjack"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)]"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted)]">
        Full Mode web · TanStack + SQLite + Manus · skills from{' '}
        <a href="https://newsjack.sh" className="underline hover:text-[var(--text)]">
          newsjack.sh
        </a>
      </footer>
    </div>
  )
}
