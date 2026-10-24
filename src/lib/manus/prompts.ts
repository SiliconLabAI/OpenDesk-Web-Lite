/** Task prompts for Manus browser worker (press-clip & coverage-reel). */

export function pressClipPrompt(input: {
  url: string
  mention: string
  brandNotes?: string
}): string {
  return `You are executing the newsjack **press-clip** skill via browser automation (Playwright).

Goal: Open the live article URL, strip ads/chrome, keep the outlet's own logo and layout, highlight the client's mention, and produce a clean press-clip PDF (or high-res screenshot PDF).

Article URL: ${input.url}
Client mention to highlight: ${input.mention}
${input.brandNotes ? `Brand notes: ${input.brandNotes}` : ''}

Steps:
1. Navigate to the URL and wait for the main article body (prefer the h1 matching the headline).
2. Dismiss cookie dialogs; hide fixed/sticky chrome where possible.
3. Scroll the full article so lazy images load; freeze animated mastheads if needed.
4. Visually highlight every occurrence of the client mention (or the closest real mention).
5. Export a PDF of the cleaned article page (or multi-page if long).
6. In your final message, include:
   - Direct download link(s) to the PDF
   - Outlet name, headline, and canonical URL
   - The exact sentence(s) where the client is mentioned
   - Any warnings (paywall, mention not found, capture truncated)

Do not invent mentions. If the name is not on the page, say so and still capture the article top.`
}

export function coverageReelPrompt(input: {
  notes: string
  brandNotes?: string
  formats?: string
}): string {
  return `You are executing the newsjack **coverage-reel** skill via browser automation.

Goal: From the coverage list below, open each real article, scroll to the sentence that names the client, highlight it, and compose a silent motion highlight reel + a simple source-linked summary.

Coverage list (outlet, date, URL, mention line):
${input.notes}

${input.brandNotes ? `Brand / client: ${input.brandNotes}` : ''}
Preferred formats: ${input.formats || 'landscape 1920×1080 (also note if portrait/square possible)'}

Steps:
1. For each URL: open, locate mention, capture a short scroll+zoom sequence or frame sequence.
2. Compose a silent MP4 reel if the environment allows encoding; otherwise deliver ordered stills + a storyboard JSON.
3. Write a short markdown dashboard: outlet, date, link, quoted mention line for each clip.
4. Final message must include download URLs for all artifacts and any failures per URL.

Never invent coverage rows that were not in the input list.`
}

export const PRESS_CLIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'outlet',
    'headline',
    'canonical_url',
    'mention_found',
    'mention_quotes',
    'artifact_urls',
    'warnings',
  ],
  properties: {
    outlet: { type: 'string' },
    headline: { type: 'string' },
    canonical_url: { type: 'string' },
    mention_found: { type: 'boolean' },
    mention_quotes: { type: 'array', items: { type: 'string' } },
    artifact_urls: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const
