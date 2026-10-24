import type { SqliteClient } from './server'

export function defaultOrgId(): string {
  return process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001'
}

export async function ensureDefaultOrg(db: SqliteClient): Promise<string> {
  const id = defaultOrgId()
  await db.from('orgs').upsert({ id, name: 'Default' }, { onConflict: 'id' })
  return id
}
