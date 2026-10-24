import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type ProviderSettings,
} from './types'
import { loadSettingsRemote, saveSettingsRemote } from './store'

/** Sync cache for server-fn calls in the same session */
export function loadSettings(): ProviderSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function cacheLocal(s: ProviderSettings) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s))
}

/** Load from SQLite (falls back to cache / defaults) */
export async function loadSettingsAsync(): Promise<ProviderSettings> {
  try {
    const res = await loadSettingsRemote()
    if (res.ok) {
      cacheLocal(res.settings)
      return res.settings
    }
  } catch {
    /* use cache */
  }
  return loadSettings()
}

/** Save to database + local cache */
export async function saveSettings(
  partial: Partial<ProviderSettings>,
): Promise<{ ok: boolean; settings: ProviderSettings; error?: string }> {
  const next = { ...loadSettings(), ...partial }
  cacheLocal(next)
  try {
    const res = await saveSettingsRemote({ data: { settings: next } })
    if (!res.ok) return { ok: false, settings: next, error: res.error }
    return { ok: true, settings: next }
  } catch (e) {
    return {
      ok: false,
      settings: next,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function clearSettings(): Promise<void> {
  cacheLocal({ ...DEFAULT_SETTINGS })
  await saveSettingsRemote({ data: { settings: { ...DEFAULT_SETTINGS } } })
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
