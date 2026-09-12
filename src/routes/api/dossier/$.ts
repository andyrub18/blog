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
        const [{ getSession }, { readDossierFile }, { clientIp }, { hasAtLeastRole }] =
          await Promise.all([
            import('../../../lib/session.server'),
            import('../../../lib/dossier'),
            import('../../../lib/rate-limit'),
            import('../../../lib/db/schema'),
          ])

        // Checked here, not only in a route guard: this is a public URL.
        //
        // Deliberately NOT `requireRole`, which throws a redirect. A redirect is
        // right for a page a person navigated to, but this endpoint is fetched;
        // answering an unauthorised fetch with 307 to the home page means the
        // caller receives HTML with a 200 after following it, which hides the
        // refusal. Status codes are the contract here.
        const session = await getSession()
        if (!session?.user) {
          return new Response('Unauthorized', { status: 401 })
        }
        if (!hasAtLeastRole(session.user.role, 'senior_member')) {
          return new Response('Forbidden', { status: 403 })
        }
        const reviewer = session.user

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
