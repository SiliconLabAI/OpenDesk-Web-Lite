import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  clearSettings,
  loadSettings,
  loadSettingsAsync,
  saveSettings,
} from '~/lib/settings/client'
import type { ProviderSettings } from '~/lib/settings/types'
import { DEFAULT_SETTINGS } from '~/lib/settings/types'
import { registerManusWebhook, getServerEnvHints } from '~/lib/settings/actions'
import { testLlmConnection } from '~/lib/skills/run'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  loader: () => getServerEnvHints(),
})

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? (
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  )
}

function inputClass() {
  return 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-dim)] font-mono'
}

function SettingsPage() {
  const envHints = Route.useLoaderData()
  const [s, setS] = useState<ProviderSettings>(DEFAULT_SETTINGS)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      setS(await loadSettingsAsync())
    })()
  }, [])

  function patch(p: Partial<ProviderSettings>) {
    setS((prev) => ({ ...prev, ...p }))
  }

  async function onSave() {
    setBusy(true)
    const res = await saveSettings(s)
    setBusy(false)
    setMsg(
      res.ok
        ? 'Saved to SQLite (and local cache). Skill runs use these keys.'
        : `Local cache updated. SQLite: ${res.error || 'failed'}`,
    )
  }

  async function onClear() {
    await clearSettings()
    setS({ ...DEFAULT_SETTINGS })
    setMsg('Cleared settings (SQLite + cache).')
  }

  async function onTestLlm() {
    setBusy(true)
    setMsg('')
    try {
      const res = await testLlmConnection({ data: { settings: s } })
      setMsg(
        res.ok
          ? `LLM OK via ${res.provider}: ${res.sample}`
          : `LLM failed: ${res.error}`,
      )
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onRegisterWebhook() {
    if (!s.manusApiKey.trim()) {
      setMsg('Enter a Manus API key first.')
      return
    }
    const appUrl =
      s.appUrl.trim() ||
      (typeof window !== 'undefined' ? window.location.origin : '')
    if (!appUrl.startsWith('http')) {
      setMsg('Set App URL to a public HTTPS origin (required for Manus webhooks).')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const res = await registerManusWebhook({
        data: { manusApiKey: s.manusApiKey, appUrl },
      })
      if (res.ok) {
        patch({ appUrl })
        await saveSettings({ ...s, appUrl })
        setMsg(`Manus webhook registered → ${res.callback}`)
      } else {
        setMsg(`Webhook failed: ${res.error}`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          API keys and OpenAI-compatible endpoints for Full Mode. Values are stored in
          <strong>SQLite</strong> (with a local cache). Server{' '}
          <code className="text-[var(--accent-dim)]">.env</code> still works as
          fallback.
        </p>
      </div>

      {(envHints.hasAnthropicEnv ||
        envHints.hasOpenaiEnv ||
        envHints.hasManusEnv ||
        envHints.hasMedialystEnv) && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
          Server env detected:{' '}
          {[
            envHints.hasAnthropicEnv && 'Anthropic',
            envHints.hasOpenaiEnv && 'OpenAI',
            envHints.hasCompatibleEnv && 'OpenAI-compatible',
            envHints.hasMedialystEnv && 'Medialyst',
            envHints.hasManusEnv && 'Manus',
          ]
            .filter(Boolean)
            .join(' · ')}
          {envHints.appUrlEnv ? ` · APP_URL=${envHints.appUrlEnv}` : ''}
        </div>
      )}

      {/* LLM preference */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">LLM provider</h2>
        <Field label="Preferred provider">
          <select
            className={inputClass()}
            value={s.preferredLlm}
            onChange={(e) =>
              patch({
                preferredLlm: e.target.value as ProviderSettings['preferredLlm'],
              })
            }
          >
            <option value="auto">Auto (compatible → Anthropic → OpenAI)</option>
            <option value="openai_compatible">OpenAI-compatible only</option>
            <option value="anthropic">Anthropic only</option>
            <option value="openai">OpenAI only</option>
          </select>
        </Field>
      </section>

      {/* OpenAI-compatible */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">OpenAI-compatible endpoint</h2>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={s.openaiCompatibleEnabled}
              onChange={(e) =>
                patch({ openaiCompatibleEnabled: e.target.checked })
              }
            />
            Enabled
          </label>
        </div>
        <p className="text-xs text-[var(--muted)]">
          Ollama, Groq, Together, Fireworks, Azure OpenAI (chat URL), LiteLLM,
          vLLM, OpenRouter, etc. Uses{' '}
          <code>/chat/completions</code>.
        </p>
        <Field
          label="Base URL"
          hint="e.g. http://127.0.0.1:11434/v1 or https://api.groq.com/openai/v1"
        >
          <input
            className={inputClass()}
            value={s.openaiCompatibleBaseUrl}
            onChange={(e) => patch({ openaiCompatibleBaseUrl: e.target.value })}
            placeholder="https://…/v1"
          />
        </Field>
        <Field label="API key" hint="Leave empty for local Ollama if it needs no key">
          <input
            className={inputClass()}
            type="password"
            autoComplete="off"
            value={s.openaiCompatibleApiKey}
            onChange={(e) => patch({ openaiCompatibleApiKey: e.target.value })}
            placeholder="sk-…"
          />
        </Field>
        <Field label="Model">
          <input
            className={inputClass()}
            value={s.openaiCompatibleModel}
            onChange={(e) => patch({ openaiCompatibleModel: e.target.value })}
            placeholder="llama3.1 · gpt-4o-mini · …"
          />
        </Field>
      </section>

      {/* Anthropic */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">Anthropic</h2>
        <Field label="API key">
          <input
            className={inputClass()}
            type="password"
            autoComplete="off"
            value={s.anthropicApiKey}
            onChange={(e) => patch({ anthropicApiKey: e.target.value })}
            placeholder="sk-ant-…"
          />
        </Field>
        <Field label="Model">
          <input
            className={inputClass()}
            value={s.anthropicModel}
            onChange={(e) => patch({ anthropicModel: e.target.value })}
          />
        </Field>
      </section>

      {/* OpenAI official */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">OpenAI (official)</h2>
        <Field label="API key">
          <input
            className={inputClass()}
            type="password"
            autoComplete="off"
            value={s.openaiApiKey}
            onChange={(e) => patch({ openaiApiKey: e.target.value })}
            placeholder="sk-…"
          />
        </Field>
        <Field label="Base URL">
          <input
            className={inputClass()}
            value={s.openaiBaseUrl}
            onChange={(e) => patch({ openaiBaseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
        <Field label="Model">
          <input
            className={inputClass()}
            value={s.openaiModel}
            onChange={(e) => patch({ openaiModel: e.target.value })}
          />
        </Field>
      </section>

      {/* Medialyst */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">Medialyst</h2>
        <p className="text-xs text-[var(--muted)]">
          Live news search, PR calendar, journalist lookup.
        </p>
        <Field label="API key">
          <input
            className={inputClass()}
            type="password"
            autoComplete="off"
            value={s.medialystApiKey}
            onChange={(e) => patch({ medialystApiKey: e.target.value })}
          />
        </Field>
        <Field label="API base">
          <input
            className={inputClass()}
            value={s.medialystApiBase}
            onChange={(e) => patch({ medialystApiBase: e.target.value })}
          />
        </Field>
      </section>

      {/* Manus */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">Manus (browser worker)</h2>
        <p className="text-xs text-[var(--muted)]">
          Powers press-clip and coverage-reel. Webhook must be a public HTTPS URL.
        </p>
        <Field label="Manus API key">
          <input
            className={inputClass()}
            type="password"
            autoComplete="off"
            value={s.manusApiKey}
            onChange={(e) => patch({ manusApiKey: e.target.value })}
          />
        </Field>
        <Field
          label="App URL (public origin)"
          hint="e.g. https://newsjack.example.com — used as webhook callback base"
        >
          <input
            className={inputClass()}
            value={s.appUrl}
            onChange={(e) => patch({ appUrl: e.target.value })}
            placeholder={
              typeof window !== 'undefined' ? window.location.origin : 'https://…'
            }
          />
        </Field>
        <button
          type="button"
          disabled={busy}
          onClick={onRegisterWebhook}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)] disabled:opacity-40"
        >
          Register Manus webhook
        </button>
      </section>

      {/* Slack */}
      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">Slack (optional)</h2>
        <Field label="Incoming webhook URL" hint="Detector alerts">
          <input
            className={inputClass()}
            type="password"
            autoComplete="off"
            value={s.slackWebhookUrl}
            onChange={(e) => patch({ slackWebhookUrl: e.target.value })}
            placeholder="https://hooks.slack.com/…"
          />
        </Field>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSave}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#0a0a0b' }}
        >
          Save to database
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onTestLlm}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm disabled:opacity-40"
        >
          Test LLM
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)]"
        >
          Clear
        </button>
      </div>

      {msg && (
        <p className="text-sm text-[var(--muted)] whitespace-pre-wrap border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
          {msg}
        </p>
      )}
    </div>
  )
}
