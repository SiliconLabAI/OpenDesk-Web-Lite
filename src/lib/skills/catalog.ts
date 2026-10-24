export type SkillCategory = 'detect' | 'act' | 'strategize' | 'ai-visibility'

export type SkillDef = {
  slug: string
  name: string
  category: SkillCategory
  icon: string
  description: string
  whenToUse: string
  /** Skills that need local Chrome / filesystem / scheduled state — web shows guidance only */
  localOnly?: boolean
  /** Full Mode browser job via Manus API + webhook */
  browserWorker?: boolean
  /** Needs live news API for full quality */
  needsNewsApi?: boolean
  inputs: Array<{
    id: string
    label: string
    placeholder: string
    type: 'textarea' | 'text'
    required?: boolean
    rows?: number
  }>
  /** Prefill values for "Try example" */
  examples?: Record<string, string>
}

export const CATEGORIES: Record<
  SkillCategory,
  { label: string; blurb: string; color: string }
> = {
  detect: {
    label: 'Detect',
    blurb: 'Surface what matters in your space',
    color: 'var(--detect)',
  },
  act: {
    label: 'Act',
    blurb: 'Turn signal into output',
    color: 'var(--act)',
  },
  strategize: {
    label: 'Strategize',
    blurb: 'Figure out what your story even is',
    color: 'var(--strategize)',
  },
  'ai-visibility': {
    label: 'AI visibility',
    blurb: 'Get your facts into AI answers (AEO/GEO)',
    color: 'var(--ai)',
  },
}

export const SKILLS: SkillDef[] = [
  // Detect
  {
    slug: 'newsjack-detector',
    name: 'Newsjack Detector',
    category: 'detect',
    icon: '📡',
    description:
      'Find newsjacking opportunities: fresh stories you have standing to jump on before the wave breaks.',
    whenToUse:
      'You want to monitor news for pitchable hooks or decide whether a current signal is worth riding.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'company',
        label: 'Company / product context',
        placeholder:
          'Who you are, standing, beat topics, competitors, spokespeople…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
      {
        id: 'signals',
        label: 'News signals to evaluate (paste headlines + links + dates)',
        placeholder: 'Paste recent headlines, URLs, and publication times…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
    examples: {
      company: 'Acme Carbon — B2B carbon accounting for mid-market manufacturers. Standing: first-party emissions data from 40 factories; CEO is ex-Watershed. Competitors: Watershed, Persefoni. Beat: climate software, industrial ops.',
      signals: '1. "EPA tightens Scope 3 reporting rules for manufacturers" — Reuters, 2026-10-18, https://example.com/epa-scope3\n2. "Watershed raises $60M Series C" — TechCrunch, 2026-10-17\n3. "EU CBAM phase-in hits US exporters" — FT, 2026-10-16',
    },

  },
  {
    slug: 'news-search',
    name: 'News Search',
    category: 'detect',
    icon: '🔎',
    description:
      'Dated, attributed articles on a topic, company, or competitor.',
    whenToUse: 'You need recent coverage on a topic, company, or competitor.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'query',
        label: 'Search query',
        placeholder: 'e.g. Series B fintech lending regulation 2026',
        type: 'text',
        required: true,
      },
      {
        id: 'context',
        label: 'Why you care (optional)',
        placeholder: 'Competitor watch, pitch research, etc.',
        type: 'textarea',
        rows: 3,
      },
    ],
    examples: {
      query: 'Series B climate software mid-market manufacturing 2026',
    },

  },
  {
    slug: 'story-origin-check',
    name: 'Story Origin Check',
    category: 'detect',
    icon: '🔍',
    description:
      'Verify the story is still fresh: who broke it, who owns it, what oxygen is left.',
    whenToUse: 'Before newsjacking or pitching off a circulating story.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'story',
        label: 'Story / headline + links',
        placeholder: 'Headline, URLs, and any known first-public timestamps…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
    examples: {
      story: 'Title: EPA tightens Scope 3 rules for manufacturers\nURL: https://example.com/epa-scope3\nClaimed publish time: 2026-10-18',
    },

  },
  {
    slug: 'relevance-coarse-filter',
    name: 'Relevance Coarse Filter',
    category: 'detect',
    icon: '🧹',
    description:
      'Cheap high-recall first pass that throws out obvious junk before expensive work.',
    whenToUse: 'You have a pile of candidate headlines and need a first cut.',
    inputs: [
      {
        id: 'profile',
        label: 'Client standing / topics',
        placeholder: 'What the client can credibly speak to…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
      {
        id: 'candidates',
        label: 'Candidate headlines (one per line)',
        placeholder: 'Paste headlines…',
        type: 'textarea',
        required: true,
        rows: 10,
      },
    ],
    examples: {
      profile: 'Acme Carbon — carbon accounting for mid-market manufacturers.',
      headlines: '- EPA Scope 3 rules for manufacturers\n- Celebrity divorce filing\n- New iPhone camera features\n- CBAM tariffs hit US industrial exporters\n- Local high school football scores',
    },

  },
  {
    slug: 'newsjack-triage',
    name: 'Newsjack Triage',
    category: 'detect',
    icon: '🚦',
    description:
      'Route surviving stories by standing: pitch now, watch, or surface as big news.',
    whenToUse: 'You have filtered signals and need routing decisions.',
    inputs: [
      {
        id: 'profile',
        label: 'Client profile / standing',
        placeholder: 'Company, authority, beat fit…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
      {
        id: 'stories',
        label: 'Stories to triage',
        placeholder: 'Each story with freshness and source notes…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
    examples: {
      standing: 'Direct product relevance: our software helps manufacturers report Scope 3. Named expert: CEO, former Watershed eng.',
      stories: '1. EPA Scope 3 rules — Reuters 18 Oct — high relevance\n2. Watershed Series C — TC 17 Oct — competitor funding\n3. CBAM phase-in — FT 16 Oct — adjacent regulation',
    },

  },
  {
    slug: 'newsjack-monitor-setup',
    name: 'Monitor Setup',
    category: 'detect',
    icon: '⚙️',
    description:
      'Build a monitoring profile: standing, beats, competitors, feeds, delivery.',
    whenToUse: 'First-time setup for ongoing newsjack monitoring.',
    localOnly: false,
    inputs: [
      {
        id: 'company',
        label: 'Company details',
        placeholder: 'Name, product, standing, competitors…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
    examples: {
      company: 'Acme Carbon\nWebsite: https://acmecarbon.example\nBeats: climate software, industrial emissions, Scope 3\nCompetitors: Watershed, Persefoni\nSpokespeople: CEO Jane Doe',
    },

  },
  {
    slug: 'coverage-tracker-setup',
    name: 'Coverage Tracker Setup',
    category: 'detect',
    icon: '🔔',
    description: 'Declare keywords to watch and what each one means.',
    whenToUse: 'You want Google Alerts-style tracking with LLM filtering.',
    localOnly: true,
    inputs: [
      {
        id: 'keywords',
        label: 'Keywords + meaning',
        placeholder: 'keyword — what counts as a real feature for this term…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
    examples: {
      keywords: 'Acme Carbon — any feature or funding mention\nScope 3 software — only product reviews or analyst notes\nJane Doe — CEO quotes only, not social shares',
    },

  },
  {
    slug: 'coverage-tracker',
    name: 'Coverage Tracker',
    category: 'detect',
    icon: '🗞️',
    description:
      'Keyword tracking with LLM filtering for real features — only genuinely new coverage.',
    whenToUse: 'Review recent hits for declared keywords.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'keywords',
        label: 'Keywords + definitions',
        placeholder: 'Your tracking definitions…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
      {
        id: 'hits',
        label: 'Raw hits to filter',
        placeholder: 'Paste alert results or article list…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
    examples: {
      keywords: 'Track: "Acme Carbon", "acmecarbon.com" — only product features and funding, not social shares.',
      hits: 'Google Alert: "Acme Carbon named in Manufacturing Dive roundup" — 2026-10-19\nhttps://example.com/mfg-dive',
    },
  },

  // Act
  {
    slug: 'angle-generator',
    name: 'Angle Generator',
    category: 'act',
    icon: '🎯',
    description:
      'Turn one update into 3–7 structurally distinct, journalist-shaped story angles.',
    whenToUse:
      'You have company news but no story yet: funding, launch, hire, partnership, milestone.',
    inputs: [
      {
        id: 'update',
        label: 'Company update (facts only)',
        placeholder:
          'Paste the raw facts — no marketing fluff. Links and numbers welcome.',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'context',
        label: 'Company / beat context (optional)',
        placeholder: 'Industry, prior coverage, audience…',
        type: 'textarea',
        rows: 3,
      },
    ],
    examples: {
      config: 'Track: "Acme Carbon", "acmecarbon.com"',
      hits: 'Google Alert: "Acme Carbon named in Manufacturing Dive roundup" — 2026-10-19\nhttps://example.com/mfg-dive',
    },

  },
  {
    slug: 'headline-generator',
    name: 'Headline Generator',
    category: 'act',
    icon: '📝',
    description:
      'Headlines and pitch subject lines built from the story’s raw facts.',
    whenToUse: 'You have an angle and need subject lines / headlines.',
    inputs: [
      {
        id: 'facts',
        label: 'Story facts / angle',
        placeholder: 'The angle and supporting facts…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
    examples: {
      angle: 'Mid-market factories finally get Scope 3 tooling built for their size — not enterprise carbon platforms.',
    },

  },
  {
    slug: 'meanest-editor',
    name: 'Meanest Editor',
    category: 'act',
    icon: '🥊',
    description: 'Roast your pitch against the rubric editors actually use.',
    whenToUse: 'Before you send a pitch or press release.',
    inputs: [
      {
        id: 'pitch',
        label: 'Pitch or draft',
        placeholder: 'Paste the full pitch / release…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
      {
        id: 'target',
        label: 'Intended outlet / beat (optional)',
        placeholder: 'e.g. TechCrunch enterprise, Bloomberg markets…',
        type: 'text',
      },
    ],
    examples: {
      draft: 'We are thrilled to announce our revolutionary Series A that will transform how the world fights climate change. Our industry-leading platform is excited to partner with manufacturers everywhere.',
      target: 'TechCrunch climate / enterprise desk',
    },

  },
  {
    slug: 'crisis-holding',
    name: 'Crisis Holding',
    category: 'act',
    icon: '🚨',
    description:
      'Holding statements, journalist Q&A posture, and what not to say — with a hard legal-counsel gate.',
    whenToUse: 'Active or looming crisis; need a holding line fast.',
    inputs: [
      {
        id: 'situation',
        label: 'Situation (known facts only)',
        placeholder: 'What happened, what is confirmed, what is alleged…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'constraints',
        label: 'Legal / counsel constraints (optional)',
        placeholder: 'Anything counsel has already ruled out…',
        type: 'textarea',
        rows: 3,
      },
    ],
    examples: {
      facts: 'A former contractor alleged on LinkedIn that Acme misreported a customer case study metric. We have not verified the claim. Customer has not complained. No media inquiry yet.',
      constraints: 'Do not admit liability. Counsel has not reviewed yet.',
    },

  },
  {
    slug: 'reactive-comment',
    name: 'Reactive Comment',
    category: 'act',
    icon: '🎙️',
    description:
      'Triage inbound HARO-style source requests; draft only the real fits.',
    whenToUse: 'HARO / Connectively / journalist source request landed.',
    inputs: [
      {
        id: 'request',
        label: 'Source request',
        placeholder: 'Paste the full query…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'profile',
        label: 'Your expertise / standing',
        placeholder: 'Why you might be a fit…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
    ],
    examples: {
      request: 'HARO: Looking for experts on Scope 3 reporting challenges for mid-size manufacturers. Deadline tomorrow 3pm ET.',
      fit: 'CEO ran Scope 3 programs at Watershed; we sell into this exact segment.',
    },

  },
  {
    slug: 'fact-check',
    name: 'Fact Check',
    category: 'act',
    icon: '✅',
    description:
      'Extract claims, verify each, flag the shaky ones before you send.',
    whenToUse: 'Before a pitch, release, reactive comment, or journalist-facing draft.',
    inputs: [
      {
        id: 'copy',
        label: 'Copy to fact-check',
        placeholder: 'Paste the draft…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
      {
        id: 'evidence',
        label: 'Evidence / sources you have (optional)',
        placeholder: 'Links, reports, internal numbers…',
        type: 'textarea',
        rows: 4,
      },
    ],
    examples: {
      draft: 'Acme is the most-funded climate-tech startup in the Nordics after our Series A, redefining how the world fights climate change. We serve 500+ factories.',
      evidence: 'Series A was $12M led by Climate Capital (our press release). No independent ranking supports "most-funded in the Nordics." Customer count is ~40, not 500.',
    },

  },
  {
    slug: 'journalist-fit-check',
    name: 'Journalist Fit Check',
    category: 'act',
    icon: '🤝',
    description:
      'Will this reporter actually care, or are you spamming?',
    whenToUse: 'You have a named journalist and a pitch angle.',
    inputs: [
      {
        id: 'journalist',
        label: 'Journalist + recent work',
        placeholder:
          'Name, outlet, beat, and 2–5 recent headlines or links…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'pitch',
        label: 'Your pitch / angle',
        placeholder: 'What you want to pitch them…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
    ],
    examples: {
      journalist: 'Alex Rivera — covers climate software at Manufacturing Dive. Recent: "Why factories still struggle with Scope 3 spreadsheets" (Sep 2026); "CBAM and US suppliers" (Aug 2026).',
      pitch: 'New data: mid-market plants spend 3 weeks/quarter on Scope 3 spreadsheets; Acme cut that 40% in early customers.',
    },

  },
  {
    slug: 'same-outlet-ranker',
    name: 'Same-Outlet Ranker',
    category: 'act',
    icon: '🥇',
    description:
      'Rank colleagues at the same publication — send to one, don’t spray the masthead.',
    whenToUse: 'Multiple reporters at one outlet could cover this.',
    inputs: [
      {
        id: 'reporters',
        label: 'Reporters + recent coverage',
        placeholder: 'List names, beats, and sample recent stories…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'story',
        label: 'Your story / angle',
        placeholder: 'What you are pitching…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
    ],
    examples: {
      candidates: '1. Alex Rivera — climate/manufacturing, 12 recent Scope 3 pieces\n2. Sam Lee — general tech, last climate piece 2024\n3. Jordan Kim — energy markets, occasional industrial software',
      pitch: 'Product + data story on mid-market Scope 3 tooling.',
    },

  },
  {
    slug: 'voice-extractor',
    name: 'Voice Extractor',
    category: 'act',
    icon: '🗣️',
    description: 'Fingerprint your real writing; kill the AI tells.',
    whenToUse: 'You have sample writing and want a reusable voice brief.',
    inputs: [
      {
        id: 'samples',
        label: 'Writing samples',
        placeholder: 'Paste 2–5 authentic samples…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
    examples: {
      samples: 'Paste 3–5 emails or posts you actually wrote…\n"Look — Scope 3 is not a vibes problem. It is a spreadsheet problem. Factories do not need another dashboard. They need the hours back."',
    },

  },
  {
    slug: 'find-journalists',
    name: 'Find Journalists',
    category: 'act',
    icon: '📋',
    description:
      'Build a fit-checked media list from a brief (best-effort without Medialyst).',
    whenToUse: 'You need a small, fit-checked list for a specific pitch.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'brief',
        label: 'Pitch brief',
        placeholder: 'Story, beat, geography, outlet tier…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'candidates',
        label: 'Candidate journalists (optional research paste)',
        placeholder: 'Names and links from your research…',
        type: 'textarea',
        rows: 6,
      },
    ],
    examples: {
      brief: 'Need trade reporters covering industrial software / climate compliance for US mid-market manufacturers.',
      candidates: 'Optional seed names or outlets: Manufacturing Dive, GreenBiz, Canary Media',
    },

  },
  {
    slug: 'press-clip',
    name: 'Press Clip',
    category: 'act',
    icon: '📰',
    description:
      'Turn a live article URL into a branded press-clip PDF via Manus browser worker (webhook on complete).',
    whenToUse: 'You have a live coverage URL to package.',
    browserWorker: true,
    inputs: [
      {
        id: 'url',
        label: 'Article URL',
        placeholder: 'https://…',
        type: 'text',
        required: true,
      },
      {
        id: 'mention',
        label: 'Client mention to highlight',
        placeholder: 'Company or product name…',
        type: 'text',
        required: true,
      },
    ],
    examples: {
      url: 'https://example.com/article-that-mentions-your-brand',
      mention: 'Acme Carbon',
    },

  },
  {
    slug: 'coverage-reel',
    name: 'Coverage Reel',
    category: 'act',
    icon: '🎞️',
    description:
      'Coverage list → dashboard + motion reel via Manus browser worker (webhook on complete).',
    whenToUse: 'You have a set of press clips to turn into a reel.',
    browserWorker: true,
    inputs: [
      {
        id: 'notes',
        label: 'Coverage notes / CSV paste',
        placeholder: 'Outlet, date, URL, mention line…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
    examples: {
      notes: 'Clip 1: https://example.com/a1 — "Acme Carbon cut Scope 3 reporting time 40%."\nClip 2: https://example.com/a2 — "Mid-market plants are adopting Acme Carbon."\nFormats: 16:9 and 9:16',
    },
  },

  // Strategize
  {
    slug: 'pr-strategist',
    name: 'PR Strategist',
    category: 'strategize',
    icon: '🗺️',
    description:
      'Opinionated walkthrough: audience first, positioning second, news pegs third.',
    whenToUse: 'You are not PR-fluent yet or need a reset on strategy.',
    inputs: [
      {
        id: 'company',
        label: 'Company / product',
        placeholder: 'What you sell, to whom, why now…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'goals',
        label: 'Goals / constraints',
        placeholder: 'Hire, fundraise, launch, category creation…',
        type: 'textarea',
        rows: 3,
      },
    ],
    examples: {
      notes: 'CSV of 3 reviewed clips with URLs and the sentence that names Acme Carbon. Prefer 16:9 + 9:16.',
    },

  },
  {
    slug: 'pr-calendar',
    name: 'PR Calendar',
    category: 'strategize',
    icon: '📅',
    description:
      'Plan six months of source-backed upcoming hooks (web: planning scaffold).',
    whenToUse: 'You need a forward calendar of pegs and campaigns.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'company',
        label: 'Company + themes',
        placeholder: 'Product, beats, seasonal moments…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
      {
        id: 'horizon',
        label: 'Planning horizon',
        placeholder: 'e.g. next 6 months, Q1–Q2…',
        type: 'text',
      },
    ],
    examples: {
      company: 'Acme Carbon — climate software / industrial emissions',
      horizon: 'Next 6 months',
    },

  },
  {
    slug: 'newsworthiness-check',
    name: 'Newsworthiness Check',
    category: 'strategize',
    icon: '📊',
    description:
      'Cold read on whether it clears the bar before you act.',
    whenToUse:
      'Is this event or pitch idea actually newsworthy to journalists?',
    inputs: [
      {
        id: 'item',
        label: 'Event or pitch idea',
        placeholder: 'Describe the news event or your announcement…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'standing',
        label: 'Your standing (optional)',
        placeholder: 'Why you could speak to this…',
        type: 'textarea',
        rows: 3,
      },
    ],
    examples: {
      item: 'Event: EPA proposes tighter Scope 3 disclosure for manufacturers (Reuters, today).\nOur angle: first-party data from 40 plants showing spreadsheet burden.',
      standing: 'Direct product relevance — carbon accounting for mid-market manufacturers.',
    },
  },

  // AI visibility
  {
    slug: 'ai-visibility-writing',
    name: 'AI Visibility Writing',
    category: 'ai-visibility',
    icon: '✍️',
    description:
      'Audit or fact-preservingly revise copy so AI answers can reuse it — no invented evidence.',
    whenToUse: 'You have web copy that should be citable by AI systems.',
    inputs: [
      {
        id: 'copy',
        label: 'Copy to audit / revise',
        placeholder: 'Paste page or section…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
    examples: {
      item: 'Event: EPA proposes tighter Scope 3 disclosure for manufacturers (Reuters, today).\nOur angle: we have first-party data from 40 plants showing current spreadsheet burden.',
    },

  },
  {
    slug: 'build-ai-visibility-panel',
    name: 'Build AI Visibility Panel',
    category: 'ai-visibility',
    icon: '🧭',
    description:
      'Turn a public URL + description into an evidence-bound prompt list across intent and journey.',
    whenToUse: 'First step to measure AI visibility for a product URL.',
    inputs: [
      {
        id: 'url',
        label: 'Public URL',
        placeholder: 'https://…',
        type: 'text',
        required: true,
      },
      {
        id: 'description',
        label: 'Product / market description',
        placeholder: 'What it is, for whom, category…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
    ],
    examples: {
      url: 'https://acmecarbon.example',
      description: 'Carbon accounting SaaS for manufacturers with 50–500 employees.',
    },

  },
  {
    slug: 'icp-evidence-analysis',
    name: 'ICP Evidence Analysis',
    category: 'ai-visibility',
    icon: '👥',
    description:
      'Turn a company dossier into testable ICP hypotheses, roles, triggers, and research gaps.',
    whenToUse: 'You need buyer definition grounded in evidence.',
    inputs: [
      {
        id: 'dossier',
        label: 'Company / market dossier',
        placeholder: 'Paste notes, reviews, interviews, site copy…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
    examples: {
      dossier: 'Win notes: plant ops managers, sustainability leads at discrete manufacturers. Pain: Excel Scope 3. Trigger: customer RFPs requiring supplier emissions data.',
    },

  },
  {
    slug: 'buyer-job-intent-analysis',
    name: 'Buyer Job Intent Analysis',
    category: 'ai-visibility',
    icon: '🧩',
    description:
      'Recover jobs, struggling moments, workarounds, and authentic buyer language from evidence.',
    whenToUse: 'You have customer/review/forum evidence to mine.',
    inputs: [
      {
        id: 'evidence',
        label: 'Customer / review / forum evidence',
        placeholder: 'Paste real quotes and sources…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
    examples: {
      evidence: 'G2 review: "We needed numbers for a Walmart supplier questionnaire in 10 days." Forum: "anyone else drowning in Scope 3 spreadsheets before CBAM?"',
    },

  },
  {
    slug: 'prompt-proximity-architecture',
    name: 'Prompt Proximity Architecture',
    category: 'ai-visibility',
    icon: '🏗️',
    description:
      'Blueprint which prompt cells are required, optional, and prohibited before anyone writes prompt wording.',
    whenToUse: 'Before writing AI-visibility prompts; after ICP / job analysis.',
    inputs: [
      {
        id: 'brief',
        label: 'Product + ICP brief (evidence-bound)',
        placeholder: 'URL, category, buyer roles, proximity goals…',
        type: 'textarea',
        required: true,
        rows: 10,
      },
    ],
    examples: {
      brief: 'Product: Acme Carbon. ICP: sustainability lead at mid-market manufacturer. Goal: unaided + aided prompts for "Scope 3 tools for factories".',
    },

  },
  {
    slug: 'realistic-prompt-generation',
    name: 'Realistic Prompt Generation',
    category: 'ai-visibility',
    icon: '💬',
    description:
      'Write natural prompt variants from a target-blind brief so the panel is not quietly written to flatter you.',
    whenToUse: 'You have an architecture blueprint and need natural prompt wording.',
    inputs: [
      {
        id: 'architecture',
        label: 'Proximity architecture / cells to fill',
        placeholder: 'Paste required cells and constraints…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'blind_brief',
        label: 'Target-blind brief (no brand flattery)',
        placeholder: 'Category language buyers actually use…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
    examples: {
      architecture: 'Required cells: job-to-be-done (supplier questionnaire), struggling moment (Excel), category tools comparison.',
      blind_brief: 'Buyers say "Scope 3 spreadsheet hell" and "customer asked for emissions data".',
    },

  },
  {
    slug: 'prompt-set-qa',
    name: 'Prompt Set QA',
    category: 'ai-visibility',
    icon: '🧪',
    description:
      'Gate the prompt set on provenance, contamination, answer leakage, naturalness, and semantic duplicates.',
    whenToUse: 'Before locking a tracking panel; quarantine unsupported prompts.',
    inputs: [
      {
        id: 'prompts',
        label: 'Prompt set to QA',
        placeholder: 'Paste candidate prompts…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
      {
        id: 'evidence',
        label: 'Evidence / provenance notes',
        placeholder: 'What supports each prompt family…',
        type: 'textarea',
        rows: 6,
      },
    ],
    examples: {
      prompts: '1. Best Scope 3 software for mid-size manufacturers?\n2. Why is Acme Carbon the #1 climate platform in the world?\n3. How do factories prepare supplier emissions data for retailers?',
      evidence: 'Prompt 2 invents ranking — no source. Prompt 1 and 3 supported by G2/forum language.',
    },

  },
  {
    slug: 'ai-visibility-panel-design',
    name: 'AI Visibility Panel Design',
    category: 'ai-visibility',
    icon: '📐',
    description:
      'Select QA-approved prompts into a versioned tracking panel with partitions, surfaces, locales, weights, and refresh rules.',
    whenToUse: 'Final step after prompt QA; human gate — no invented visibility score.',
    inputs: [
      {
        id: 'approved_prompts',
        label: 'QA-approved prompts',
        placeholder: 'Paste approved set…',
        type: 'textarea',
        required: true,
        rows: 10,
      },
      {
        id: 'design_constraints',
        label: 'Partitions / surfaces / locales / weights',
        placeholder: 'Tracking design requirements…',
        type: 'textarea',
        rows: 6,
      },
    ],
    examples: {
      approved_prompts: '1. Best Scope 3 software for mid-size manufacturers?\n3. How do factories prepare supplier emissions data for retailers?',
      design_constraints: 'Surfaces: ChatGPT, Perplexity. Locales: en-US. Aided vs unaided separate. Monthly refresh.',
    },

  },
]

export function getSkill(slug: string): SkillDef | undefined {
  return SKILLS.find((s) => s.slug === slug)
}

export function skillsByCategory(cat: SkillCategory): SkillDef[] {
  return SKILLS.filter((s) => s.category === cat)
}
