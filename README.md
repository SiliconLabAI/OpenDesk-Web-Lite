# opendesk-web

TanStack Start web app for newsjack-style skills, with **SQLite3** persistence (Node built-in `node:sqlite`).

## Database

- Driver: Node.js `node:sqlite` (requires Node ≥ 22.5)
- Default file: `./data/opendesk.sqlite` (override with `SQLITE_PATH`)
- File storage: `./data/storage` (override with `STORAGE_PATH`)
- Schema: `src/lib/db/schema.sql` (applied on first open)
- Client: `getDb()` / `hasDb()` from `~/lib/db/server`

## Setup

```bash
cd opendesk-web
npm install
cp .env.example .env
npm run dev
```

## Env

See `.env.example` for `SQLITE_PATH`, `STORAGE_PATH`, LLM keys, and Manus/Medialyst settings.
