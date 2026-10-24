import {
  deleteChatThread,
  listChatThreads,
  upsertChatThread,
} from './store'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  skillSlug?: string
  createdAt: string
  /** Manus research job — resume poll after refresh */
  jobId?: string
  pending?: boolean
  manusTaskId?: string
  manusTaskUrl?: string
}

export type ChatThread = {
  id: string
  title: string
  skillSlug?: string
  messages: ChatMessage[]
  updatedAt: string
}

const KEY = 'newsjack.chat.threads.v1'

function cacheLocal(threads: ChatThread[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(threads.slice(0, 50)))
  } catch {
    /* quota */
  }
}

export function loadThreadsSync(): ChatThread[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as ChatThread[]
  } catch {
    return []
  }
}

export async function loadThreads(): Promise<ChatThread[]> {
  try {
    const res = await listChatThreads()
    if (res.ok) {
      cacheLocal(res.threads)
      return res.threads
    }
  } catch {
    /* fall through */
  }
  return loadThreadsSync()
}

export async function upsertThread(thread: ChatThread): Promise<void> {
  const all = loadThreadsSync().filter((t) => t.id !== thread.id)
  all.unshift(thread)
  cacheLocal(all)
  try {
    await upsertChatThread({
      data: {
        id: thread.id,
        title: thread.title,
        skillSlug: thread.skillSlug,
        messages: thread.messages,
      },
    })
  } catch {
    /* kept in local cache */
  }
}

export async function deleteThread(id: string): Promise<void> {
  cacheLocal(loadThreadsSync().filter((t) => t.id !== id))
  try {
    await deleteChatThread({ data: { id } })
  } catch {
    /* ignore */
  }
}

export function newId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// UUID for SQLite primary keys when inserting new threads
export function newUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
