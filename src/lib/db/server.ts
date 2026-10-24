/**
 * SQLite database client for opendesk-web.
 * Exports: getDb(), hasDb()
 * Uses Node.js built-in node:sqlite (DatabaseSync).
 * Node builtins load via process.getBuiltinModule (no require, no static node: imports)
 * so createServerFn modules can be referenced from the client without breaking the browser bundle.
 */
import { newUuid } from '~/lib/id'

type DatabaseSync = import('node:sqlite').DatabaseSync
type FsType = typeof import('node:fs')
type PathType = typeof import('node:path')
type UrlType = typeof import('node:url')
type SqliteType = typeof import('node:sqlite')

function nodeBuiltin<T>(id: string): T {
  const proc = globalThis.process as
    | { getBuiltinModule?: (id: string) => unknown }
    | undefined
  if (!proc || typeof proc.getBuiltinModule !== 'function') {
    throw new Error(
      `Node builtin "${id}" unavailable (server-only SQLite). Use Node ≥ 22.5.`,
    )
  }
  return proc.getBuiltinModule(id) as T
}

const JSON_COLUMNS = new Set([
  'topics',
  'feeds',
  'input',
  'output',
  'manus_event_log',
  'meta',
  'payload',
  'settings',
  'request',
  'response',
  'values',
])

function dbPath(): string {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH
  const sep = process.cwd().includes('\\') ? '\\' : '/'
  return process.cwd() + sep + 'data' + sep + 'opendesk.sqlite'
}

function storageRoot(): string {
  if (process.env.STORAGE_PATH) return process.env.STORAGE_PATH
  const sep = process.cwd().includes('\\') ? '\\' : '/'
  return process.cwd() + sep + 'data' + sep + 'storage'
}

let _db: DatabaseSync | null = null
let _client: SqliteClient | null = null

function assertServer() {
  if (typeof window !== 'undefined') {
    throw new Error('SQLite getDb() is server-only')
  }
}

function getRawDb(): DatabaseSync {
  if (_db) return _db
  assertServer()
  const fs = nodeBuiltin<FsType>('node:fs')
  const path = nodeBuiltin<PathType>('node:path')
  const { DatabaseSync: DB } = nodeBuiltin<SqliteType>('node:sqlite')
  const file = dbPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.mkdirSync(storageRoot(), { recursive: true })
  _db = new DB(file)
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')
  initSchema(_db, fs, path)
  return _db
}

function initSchema(
  db: DatabaseSync,
  fs: FsType,
  path: PathType,
) {
  const { fileURLToPath } = nodeBuiltin<UrlType>('node:url')
  let sql = ''
  try {
    const schemaPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'schema.sql',
    )
    if (fs.existsSync(schemaPath)) {
      sql = fs.readFileSync(schemaPath, 'utf8')
    }
  } catch {
    /* import.meta.url may differ under bundlers */
  }
  if (!sql) {
    const alt = path.join(process.cwd(), 'src/lib/db/schema.sql')
    if (fs.existsSync(alt)) sql = fs.readFileSync(alt, 'utf8')
  }
  if (sql) db.exec(sql)
  const orgId =
    process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001'
  db.prepare(
    `INSERT OR IGNORE INTO orgs (id, name) VALUES (?, ?)`,
  ).run(orgId, 'Default')
}

function encodeValue(col: string, v: unknown): unknown {
  if (v === undefined) return null
  if (v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (JSON_COLUMNS.has(col) || (typeof v === 'object' && v !== null)) {
    return JSON.stringify(v)
  }
  return v
}

function decodeRow(row: Record<string, unknown> | undefined | null): any {
  if (!row) return row
  const out: Record<string, unknown> = { ...row }
  for (const [k, v] of Object.entries(out)) {
    if (
      typeof v === 'string' &&
      (JSON_COLUMNS.has(k) ||
        ((v.startsWith('{') || v.startsWith('[')) &&
          (v.endsWith('}') || v.endsWith(']'))))
    ) {
      try {
        out[k] = JSON.parse(v)
      } catch {
        /* keep string */
      }
    }
    if (k === 'enabled' || k === 'pending') {
      out[k] = Boolean(v)
    }
  }
  return out
}

function decodeRows(rows: any[]): any[] {
  return rows.map((r) => decodeRow(r))
}

class QueryBuilder {
  private table: string
  private filters: Array<{ col: string; op: string; val: unknown }> = []
  private orderBy: { col: string; asc: boolean } | null = null
  private limitN: number | null = null
  private selectCols = '*'
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: Record<string, unknown> | Record<string, unknown>[] | null =
    null
  private onConflict: string | null = null

  constructor(table: string) {
    this.table = table
  }

  select(cols = '*') {
    this.selectCols = cols
    return this
  }

  insert(row: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = 'insert'
    this.payload = row
    return this
  }

  update(row: Record<string, unknown>) {
    this.mode = 'update'
    this.payload = row
    return this
  }

  upsert(
    row: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string },
  ) {
    this.mode = 'upsert'
    this.payload = row
    this.onConflict = opts?.onConflict || null
    return this
  }

  delete() {
    this.mode = 'delete'
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, op: '=', val })
    return this
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false }
    return this
  }

  limit(n: number) {
    this.limitN = n
    return this
  }

  private whereSql(): { sql: string; params: unknown[] } {
    if (!this.filters.length) return { sql: '', params: [] }
    const parts = this.filters.map((f) => `${f.col} ${f.op} ?`)
    return {
      sql: ' WHERE ' + parts.join(' AND '),
      params: this.filters.map((f) =>
        typeof f.val === 'boolean' ? (f.val ? 1 : 0) : f.val,
      ),
    }
  }

  private ensureId(row: Record<string, unknown>) {
    if (!row.id) row.id = newUuid()
    return row
  }

  async single(): Promise<{ data: any; error: any }> {
    this.limitN = 1
    const res = await this.execute()
    if (res.error) return res
    const row = Array.isArray(res.data) ? res.data[0] : res.data
    if (!row) {
      return {
        data: null,
        error: {
          message:
            'JSON object requested, multiple (or no) rows returned',
          code: 'PGRST116',
        },
      }
    }
    return { data: row, error: null }
  }

  async maybeSingle(): Promise<{ data: any; error: any }> {
    this.limitN = 1
    const res = await this.execute()
    if (res.error) return res
    const row = Array.isArray(res.data) ? res.data[0] : res.data
    return { data: row ?? null, error: null }
  }

  then(resolve: any, reject?: any) {
    return this.execute().then(resolve, reject)
  }

  private async execute(): Promise<{ data: any; error: any }> {
    try {
      const db = getRawDb()
      const { sql: where, params } = this.whereSql()

      if (this.mode === 'select') {
        let q = `SELECT ${this.selectCols} FROM ${this.table}${where}`
        if (this.orderBy) {
          q += ` ORDER BY ${this.orderBy.col} ${this.orderBy.asc ? 'ASC' : 'DESC'}`
        }
        if (this.limitN != null) q += ` LIMIT ${this.limitN}`
        const stmt = db.prepare(q)
        const rows = stmt.all(...params) as any[]
        return { data: decodeRows(rows), error: null }
      }

      if (this.mode === 'insert') {
        const rows = Array.isArray(this.payload)
          ? this.payload
          : [this.payload!]
        const inserted: any[] = []
        for (let row of rows) {
          row = this.ensureId({ ...row })
          const cols = Object.keys(row)
          const placeholders = cols.map(() => '?').join(',')
          const vals = cols.map((c) => encodeValue(c, row[c]))
          db.prepare(
            `INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${placeholders})`,
          ).run(...vals)
          inserted.push(decodeRow(row))
        }
        return {
          data: Array.isArray(this.payload) ? inserted : inserted[0],
          error: null,
        }
      }

      if (this.mode === 'upsert') {
        const rows = Array.isArray(this.payload)
          ? this.payload
          : [this.payload!]
        const conflict = this.onConflict || 'id'
        const conflictCols = conflict.split(',').map((s) => s.trim())
        const out: any[] = []
        for (let row of rows) {
          row = this.ensureId({ ...row })
          const cols = Object.keys(row)
          const placeholders = cols.map(() => '?').join(',')
          const vals = cols.map((c) => encodeValue(c, row[c]))
          const updates = cols
            .filter((c) => !conflictCols.includes(c))
            .map((c) => `${c}=excluded.${c}`)
            .join(',')
          const sql = updates
            ? `INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(${conflictCols.join(',')}) DO UPDATE SET ${updates}`
            : `INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(${conflictCols.join(',')}) DO NOTHING`
          db.prepare(sql).run(...vals)
          out.push(decodeRow(row))
        }
        return {
          data: Array.isArray(this.payload) ? out : out[0],
          error: null,
        }
      }

      if (this.mode === 'update') {
        const row = { ...(this.payload as Record<string, unknown>) }
        delete row.id
        const cols = Object.keys(row)
        if (!cols.length) return { data: null, error: null }
        const sets = cols.map((c) => `${c}=?`).join(',')
        const vals = cols.map((c) => encodeValue(c, row[c]))
        db.prepare(`UPDATE ${this.table} SET ${sets}${where}`).run(
          ...vals,
          ...params,
        )
        const updated = decodeRows(
          db.prepare(`SELECT * FROM ${this.table}${where}`).all(...params) as any[],
        )
        return { data: updated, error: null }
      }

      if (this.mode === 'delete') {
        db.prepare(`DELETE FROM ${this.table}${where}`).run(...params)
        return { data: null, error: null }
      }

      return { data: null, error: { message: 'unknown mode' } }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
      }
    }
  }
}

class StorageBucket {
  private bucket: string
  constructor(bucket: string) {
    this.bucket = bucket
  }

  async upload(
    objectPath: string,
    body: Buffer | Uint8Array | string,
    _opts?: { contentType?: string; upsert?: boolean },
  ) {
    try {
      assertServer()
      const fs = nodeBuiltin<FsType>('node:fs')
      const path = nodeBuiltin<PathType>('node:path')
      const root = path.join(storageRoot(), this.bucket)
      const full = path.join(root, objectPath)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, body)
      return { data: { path: objectPath }, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
      }
    }
  }

  async download(objectPath: string) {
    try {
      assertServer()
      const fs = nodeBuiltin<FsType>('node:fs')
      const path = nodeBuiltin<PathType>('node:path')
      const full = path.join(storageRoot(), this.bucket, objectPath)
      const buf = fs.readFileSync(full)
      return { data: buf, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
      }
    }
  }
}

class SqliteClient {
  from(table: string) {
    return new QueryBuilder(table)
  }

  storage = {
    from: (bucket: string) => new StorageBucket(bucket),
  }
}

/** SQLite is always available as a local file. */
export function hasDb(): boolean {
  return true
}

/** SQLite service client (query builder + local file storage). */
export function getDb(): SqliteClient {
  if (_client) return _client
  getRawDb()
  _client = new SqliteClient()
  return _client
}

export type { SqliteClient }
