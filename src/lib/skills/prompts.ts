import type { SkillDef } from './catalog'
import { doctrineFor, ETHICS_FLOOR } from './doctrine'

export function buildSystemPrompt(skill: SkillDef): string {
  const doctrine = doctrineFor(skill.slug)
  return `${doctrine}

Skill slug: \`/${skill.slug}\`
Category: ${skill.category}
Purpose: ${skill.description}
When to use: ${skill.whenToUse}

Output rules:
- Lead with the useful artifact — no sales preamble.
- Use clear markdown structure.
- If inputs are insufficient, say what is missing and stop rather than inventing.
- For local-only skills without Full Mode wiring, explain the gap and give a planning checklist.
`
}

export function buildUserPrompt(
  skill: SkillDef,
  values: Record<string, string>,
  profile?: string,
  extraContext?: string,
): string {
  const parts: string[] = []
  if (profile?.trim()) {
    parts.push(`## Saved client profile\n${profile.trim()}`)
  }
  if (extraContext?.trim()) {
    parts.push(`## Live tool evidence\n${extraContext.trim()}`)
  }
  for (const input of skill.inputs) {
    const v = values[input.id]?.trim()
    if (v) parts.push(`## ${input.label}\n${v}`)
  }
  if (parts.length === 0) {
    return 'No inputs provided.'
  }
  parts.push(
    `\nRun the \`${skill.slug}\` skill on the material above. Follow the skill doctrine and ethics floor.`,
  )
  return parts.join('\n\n')
}

export function offlineDemoResult(
  skill: SkillDef,
  values: Record<string, string>,
): string {
  if (skill.localOnly) {
    const lines = skill.inputs.map((i) => {
      const v = values[i.id]?.trim()
      return `- **${i.label}:** ${v ? 'provided ✓' : 'still needed'}`
    })
    return [
      '## Local / Full Mode note',
      '',
      `\`${skill.slug}\` needs durable state or a local agent for full fidelity.`,
      '',
      'Web Full Mode: configure SQLite + (for browser skills) Manus, or run:',
      '',
      '```bash',
      'curl -fsSL newsjack.sh | bash',
      '```',
      '',
      '### Checklist',
      lines.join('\n'),
    ].join('\n')
  }

  const summary = skill.inputs.map((i) => {
    const v = values[i.id]?.trim()
    const body = v ? v.slice(0, 500) + (v.length > 500 ? '…' : '') : '_empty_'
    return `**${i.label}**\n${body}`
  })

  return [
    `## ${skill.name} — offline scaffold`,
    '',
    'No LLM configured. Open **Settings** and add Anthropic, OpenAI, or an OpenAI-compatible endpoint (base URL + model), or set env vars.',
    '',
    `Doctrine for this skill is loaded from newsjack SKILL.md condensations (${skill.slug}).`,
    '',
    '### Input summary',
    summary.join('\n\n'),
    '',
    ETHICS_FLOOR,
  ].join('\n')
}
