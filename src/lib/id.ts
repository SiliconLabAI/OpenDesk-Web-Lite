/** UUID helper safe in browser and Node (no node:crypto import). */
export function newUuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // RFC4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0
    const v = ch === 'x' ? n : (n & 0x3) | 0x8
    return v.toString(16)
  })
}
