import { createFileRoute } from '@tanstack/solid-router'

/**
 * Authorised dossier download: `/api/dossier/<applicationId>/<field>`.
 *
 * Served as an attachment and never inline. A PDF rendered in the browser can
 * carry active content, and these files come from the public internet — a
 * reviewer opening one should not be running it.
 *
 * `auth` and the reader are imported lazily: this module is referenced by the
 * generated route tree, which is client code, so a top-level import would pull
 * the auth server into the browser bundle.
 */
export const Route = createFileRoute('/api/dossier/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const [{ requireRole }, { readDossierFile }, { clientIp }] = await Promise.all([
          import('../../../lib/session.server'),
          import('../../../lib/dossier'),
          import('../../../lib/rate-limit'),
        ])

        // Re-checked here, not only in a route guard: this is a public URL.
        const reviewer = await requireRole(['senior_member', 'super_admin'])

        const segments = String(params._splat ?? '')
          .split('/')
          .filter(Boolean)
        const [applicationId, field] = segments
        if (!applicationId || !['cv', 'vision', 'contribution'].includes(field ?? '')) {
          return new Response('Not found', { status: 404 })
        }

        const result = await readDossierFile({
          applicationId,
          field: field as 'cv' | 'vision' | 'contribution',
          actorId: reviewer.id,
          ip: clientIp(request.headers),
        })

        if (!result.ok) return new Response('Not found', { status: 404 })

        return new Response(new Uint8Array(result.bytes), {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename="${result.filename}"`,
            'x-content-type-options': 'nosniff',
            // Never cached by a proxy or the browser's shared cache: this is
            // somebody's CV behind an authorisation check.
            'cache-control': 'private, no-store',
          },
        })
      },
    },
  },
})
