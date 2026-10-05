import { describe, expect, it } from 'vitest'
import { withoutHeadBody } from './head-request'

/** A page body that records whether it was cancelled, as TanStack's stream cleans up on cancel. */
function page() {
  const stream = { cancelled: false }
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('<html>'))
    },
    cancel() {
      stream.cancelled = true
    },
  })
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html', 'set-cookie': 'a=b' },
  })
  return { stream, response }
}

describe('withoutHeadBody', () => {
  it('cancels the body of a HEAD response, so the page it holds is freed at once', async () => {
    const { stream, response } = page()
    await withoutHeadBody(
      new Request('https://klea.test/fr/', { method: 'HEAD' }),
      response,
    )
    expect(stream.cancelled).toBe(true)
  })

  it('keeps the status and every header', async () => {
    const { response } = page()
    const head = await withoutHeadBody(
      new Request('https://klea.test/fr/', { method: 'HEAD' }),
      response,
    )
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('text/html')
    expect(head.headers.get('set-cookie')).toBe('a=b')
    expect(head.body).toBeNull()
  })

  it('leaves a GET response untouched', async () => {
    const { stream, response } = page()
    const get = await withoutHeadBody(new Request('https://klea.test/fr/'), response)
    expect(get).toBe(response)
    expect(stream.cancelled).toBe(false)
  })
})
