import { Link, createFileRoute } from '@tanstack/react-router'
import { CATEGORIES, SKILLS } from '~/lib/skills/catalog'
import { SkillCard } from '~/components/SkillCard'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const featured = [
    'angle-generator',
    'newsworthiness-check',
    'fact-check',
    'meanest-editor',
    'pr-strategist',
    'journalist-fit-check',
  ]
    .map((s) => SKILLS.find((x) => x.slug === s)!)
    .filter(Boolean)

  return (
    <div className="space-y-12">
      <section className="space-y-5 max-w-2xl">
        <p className="text-sm font-medium text-[var(--accent-dim)]">Limited Mode · web</p>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
          Your agent’s PR team,{' '}
          <span className="text-[var(--muted)]">in the browser.</span>
        </h1>
        <p className="text-lg text-[var(--muted)] leading-relaxed">
          Newsjack turns coding agents into a full PR operator. This app is the same
          skill set as a web workspace: paste facts, run a skill, get structured
          output — no local install required for the portable tools.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            to="/tools"
            className="inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#0a0a0b' }}
          >
            Browse skills
          </Link>
          <Link
            to="/profile"
            className="inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-medium border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"
          >
            Set client profile
          </Link>
        </div>
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>).map((key) => {
          const c = CATEGORIES[key]
          const count = SKILLS.filter((s) => s.category === key).length
          return (
            <Link
              key={key}
              to="/tools"
              search={{ cat: key }}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--surface-2)] transition-colors"
            >
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: c.color }}>
                {c.label}
              </div>
              <div className="mt-1 text-sm text-[var(--muted)]">{c.blurb}</div>
              <div className="mt-3 text-xs text-[var(--muted)]">{count} skills</div>
            </Link>
          )
        })}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl font-semibold">Start here</h2>
          <Link to="/tools" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            All skills →
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {featured.map((s) => (
            <SkillCard key={s.slug} skill={s} />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-3">
        <h2 className="font-semibold">Full Mode (local agents)</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Scheduled monitoring, press-clip PDFs, coverage reels, and durable profiles
          need a local harness. Install once:
        </p>
        <pre className="rounded-lg bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-sm overflow-x-auto text-[var(--accent-dim)]">
          curl -fsSL newsjack.sh | bash
        </pre>
        <p className="text-xs text-[var(--muted)]">
          Works with Claude Code, Codex, Hermes, and OpenClaw. See{' '}
          <a
            className="underline"
            href="https://github.com/elvisun/newsjack"
            target="_blank"
            rel="noreferrer"
          >
            elvisun/newsjack
          </a>
          .
        </p>
      </section>
    </div>
  )
}
