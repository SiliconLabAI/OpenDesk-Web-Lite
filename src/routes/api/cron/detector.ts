import { createAPIFileRoute } from '@tanstack/react-start/api'
import { runDetectorForMonitor } from '~/lib/detector/run'
import { getDb, hasDb } from '~/lib/db/server'

/**
 * Cron entrypoint for Full Mode detector.
 * Secure with CRON_SECRET header: Authorization: Bearer <CRON_SECRET>
 *
 * SQLite Cron example:
 *   POST /api/cron/detector
 *   every day at 9:00 UTC
 */
export const APIRoute = createAPIFileRoute('/api/cron/detector')({
  POST: async ({ request }) => {
    const expected = process.env.CRON_SECRET
    if (expected) {
      const auth = request.headers.get('authorization') || ''
      const token = auth.replace(/^Bearer\s+/i, '')
      if (token !== expected) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (!hasDb()) {
      return new Response(JSON.stringify({ ok: false, error: 'No database' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const db = getDb()
    const { data: monitors } = await db
      .from('monitors')
      .select('id, slug, title')
      .eq('enabled', true)
      .limit(50)

    const results = []
    for (const m of monitors || []) {
      const r = await runDetectorForMonitor(m.id)
      results.push({ monitorId: m.id, slug: m.slug, ...r })
    }

    return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  GET: async ({ request }) => {
    // Allow GET with secret for simple uptime checks
    const expected = process.env.CRON_SECRET
    if (expected) {
      const url = new URL(request.url)
      if (url.searchParams.get('secret') !== expected) {
        return new Response('Unauthorized', { status: 401 })
      }
    }
    return new Response(
      JSON.stringify({
        ok: true,
        service: 'newsjack detector cron',
        method: 'POST to run all enabled monitors',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  },
})
