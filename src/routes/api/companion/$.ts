import { createFileRoute } from '@tanstack/solid-router'

/**
 * A reader's download of a companion PDF: `/api/companion/<slug>/<lang>`.
 *
 * Also the circle's: `/api/companion/review/<submissionId>/<lang>` serves the
 * PDF a round is reviewing, to members only, and never cached (D29). One route
 * rather than two because every route costs every page a few hundred bytes of
 * route tree; the two shapes cannot collide, one having three segments and the
 * other two.
 *
 * Served as an attachment and never inline, with `nosniff` and a sandboxing
 * CSP besides: `pdf.ts` refuses active content, but a file we did not write is
 * handled as though that check could one day miss something.
 *
 * Not logged, on purpose — see `lib/companion.ts`. A list of who downloaded a
 * political proposal is a list nobody should be able to subpoena or steal.
 *
 * Modules are imported lazily, for the reason `api/dossier/$.ts` gives: this
 * file is referenced by the generated route tree, which is client code.
 */
export const Route = createFileRoute('/api/companion/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const segments = String(params._splat ?? '')
          .split('/')
          .filter(Boolean)
        const [{ isLocale }, { isValidSlug }] = await Promise.all([
          import('../../../i18n'),
          import('../../../lib/validation'),
        ])

        const [{ getSession }, companion] = await Promise.all([
          import('../../../lib/session.server'),
          import('../../../lib/companion'),
        ])
        const viewerOf = async () => {
          const session = await getSession()
          return session?.user && session.user.memberStatus !== 'blocked'
            ? {
                id: session.user.id,
                role: session.user.role,
                memberStatus: session.user.memberStatus,
              }
            : null
        }

        if (segments.length === 3 && segments[0] === 'review') {
          const [, submissionId, reviewLang] = segments
          if (!isLocale(reviewLang)) return new Response('Not found', { status: 404 })
          const review = await companion.openCompanionForReview({
            submissionId,
            lang: reviewLang,
            viewer: await viewerOf(),
          })
          if (!review.ok) {
            return new Response(review.status === 403 ? 'Forbidden' : 'Not found', {
              status: review.status,
            })
          }
          return new Response(review.body, {
            headers: {
              'content-type': 'application/pdf',
              'content-length': String(review.byteSize),
              'content-disposition': `attachment; filename="${review.filename}"`,
              'x-content-type-options': 'nosniff',
              'content-security-policy': "sandbox; default-src 'none'",
              // Unpublished work behind a membership check.
              'cache-control': 'private, no-store',
            },
          })
        }

        const [slug, lang] = segments
        if (
          segments.length !== 2 ||
          !slug ||
          !lang ||
          !isValidSlug(slug) ||
          !isLocale(lang)
        ) {
          return new Response('Not found', { status: 404 })
        }
        const { openCompanionDownload } = companion
        const viewer = await viewerOf()

        const result = await openCompanionDownload({
          slug,
          lang,
          viewer,
          ifNoneMatch: request.headers.get('if-none-match'),
        })
        if (!result.ok) {
          return new Response(result.status === 403 ? 'Forbidden' : 'Not found', {
            status: result.status,
          })
        }

        const headers: Record<string, string> = {
          etag: `"${result.sha256}"`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "sandbox; default-src 'none'",
          // A public article's PDF may sit in a shared cache for a few minutes;
          // the ETag is what makes a replaced file show up after that. A
          // members-only one never leaves the reader's own browser.
          'cache-control':
            result.visibility === 'public' ? 'public, max-age=300' : 'private, no-store',
        }
        if ('notModified' in result) return new Response(null, { status: 304, headers })

        return new Response(result.body, {
          headers: {
            ...headers,
            'content-type': 'application/pdf',
            'content-length': String(result.byteSize),
            'content-disposition': `attachment; filename="${result.filename}"`,
          },
        })
      },
    },
  },
})
