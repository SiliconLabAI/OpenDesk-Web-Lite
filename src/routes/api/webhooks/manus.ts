import { createAPIFileRoute } from '@tanstack/react-start/api'
import { handleManusWebhook } from '~/lib/jobs/webhook'
import type { ManusWebhookEnvelope } from '~/lib/manus/client'

export const APIRoute = createAPIFileRoute('/api/webhooks/manus')({
  POST: async ({ request }) => {
    const raw = await request.text()
    let body: ManusWebhookEnvelope
    try {
      body = JSON.parse(raw) as ManusWebhookEnvelope
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const webhookUrl =
      process.env.APP_URL
        ? `${process.env.APP_URL.replace(/\/$/, '')}/api/webhooks/manus`
        : request.url

    const result = await handleManusWebhook(body, raw, request.headers, webhookUrl)

    if (!result.ok && result.detail?.startsWith('signature')) {
      return new Response(JSON.stringify(result), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  GET: async () =>
    new Response(
      JSON.stringify({
        ok: true,
        service: 'newsjack-web manus webhook',
        hint: 'POST task lifecycle events from Manus here',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
})
