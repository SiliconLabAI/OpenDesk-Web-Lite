import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  CATEGORIES,
  SKILLS,
  type SkillCategory,
} from '~/lib/skills/catalog'
import { SkillCard } from '~/components/SkillCard'

const searchSchema = z.object({
  cat: z
    .enum(['detect', 'act', 'strategize', 'ai-visibility'])
    .optional(),
})

export const Route = createFileRoute('/tools/')({
  validateSearch: searchSchema,
  component: ToolsIndex,
})

function ToolsIndex() {
  const { cat } = Route.useSearch()
  const categories = Object.keys(CATEGORIES) as SkillCategory[]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Skills</h1>
        <p className="mt-2 text-[var(--muted)] max-w-xl">
          Same lanes as the agent install. Portable skills run here; local-only
          tools show a Full Mode path.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/tools"
          search={{}}
          className={`rounded-full px-3 py-1 text-sm border ${
            !cat
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          All
        </Link>
        {categories.map((key) => (
          <Link
            key={key}
            to="/tools"
            search={{ cat: key }}
            className={`rounded-full px-3 py-1 text-sm border ${
              cat === key
                ? 'border-current'
                : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'
            }`}
            style={cat === key ? { color: CATEGORIES[key].color } : undefined}
          >
            {CATEGORIES[key].label}
          </Link>
        ))}
      </div>

      {categories
        .filter((key) => !cat || cat === key)
        .map((key) => {
          const list = SKILLS.filter((s) => s.category === key)
          const c = CATEGORIES[key]
          return (
            <section key={key} className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-semibold" style={{ color: c.color }}>
                  {c.label}
                </h2>
                <span className="text-sm text-[var(--muted)]">{c.blurb}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {list.map((s) => (
                  <SkillCard key={s.slug} skill={s} />
                ))}
              </div>
            </section>
          )
        })}
    </div>
  )
}
