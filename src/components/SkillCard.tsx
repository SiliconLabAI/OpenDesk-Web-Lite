import { Link } from '@tanstack/react-router'
import type { SkillDef } from '~/lib/skills/catalog'
import { CATEGORIES } from '~/lib/skills/catalog'

export function SkillCard({ skill }: { skill: SkillDef }) {
  const cat = CATEGORIES[skill.category]
  return (
    <Link
      to="/tools/$slug"
      params={{ slug: skill.slug }}
      className="skill-card block rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors"
      style={{ ['--card-accent' as string]: cat.color }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          {skill.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-[var(--text)]">{skill.name}</h3>
            {skill.localOnly && (
              <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)]">
                local agent
              </span>
            )}
            {skill.needsNewsApi && !skill.localOnly && (
              <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)]">
                news index
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--muted)] line-clamp-2">{skill.description}</p>
        </div>
      </div>
    </Link>
  )
}
