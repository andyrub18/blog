/**
 * The response to a HEAD request, without the body nobody will read.
 *
 * TanStack Start answers a HEAD as it answers a GET: with the page as a stream
 * that frees itself once it has been read to the end — or, failing that, when a
 * two-minute "lifetime" timer runs out. A HEAD response's body is never sent,
 * so it was never read. Each HEAD held its rendered page and router in memory
 * for two minutes — 2,000 of them added 150 MB, so a cheap request sent in a
 * loop could fill a 2 GB server — and the pending timer kept a stopping server
 * alive until systemd killed it, which is how this was found.
 *
 * Cancelling the stream runs the same cleanup at once.
 */
export async function withoutHeadBody(
  request: Request,
  response: Response,
): Promise<Response> {
  if (request.method !== 'HEAD' || !response.body) return response
  await response.body.cancel()
  return new Response(null, response)
}
