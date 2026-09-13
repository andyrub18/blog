import { render } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Discussion } from '../../lib/forum'

const fetchDiscussion = vi.fn()

vi.mock('../../lib/forum-actions', () => ({
  fetchDiscussion: (...args: Array<unknown>) => fetchDiscussion(...args),
  postToDiscussion: vi.fn(),
  editMyPost: vi.fn(),
  withdrawMyPost: vi.fn(),
  moderateDiscussionPost: vi.fn(),
  fetchModerationLog: vi.fn(),
}))

const { default: DiscussionThread } = await import('./DiscussionThread')

const DISCUSSION: Discussion = {
  articleId: 'article-1',
  slug: 'sitiyasyon-ekonomik',
  title: 'La situation économique',
  viewerId: 'reader-1',
  canPost: true,
  canModerate: false,
  posts: [],
}

describe('the poller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchDiscussion.mockReset()
    fetchDiscussion.mockResolvedValue({ ok: true, value: { ...DISCUSSION, posts: [] } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops when the reader leaves the page', async () => {
    const view = render(() => <DiscussionThread initial={DISCUSSION} />)

    // One loop's worth of waiting, to prove it was running at all.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchDiscussion.mock.calls.length).toBeGreaterThan(0)
    const whileOpen = fetchDiscussion.mock.calls.length

    view.unmount()
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    /**
     * Nothing after the page is gone.
     *
     * A reader who navigates away must stop paying for the thread they left:
     * the timer and the `visibilitychange` listener have to go with the page,
     * and on metered mobile data that is the whole reason this loop is written
     * the way it is.
     *
     * Worth a test rather than a reading of the code. Solid 2 honours both a
     * cleanup returned from an effect's apply step and one registered with
     * `onCleanup` — this was checked by reinstating each in turn — so the
     * question "does the loop actually stop" is not answerable by looking at
     * which form the component happens to use.
     */
    expect(fetchDiscussion.mock.calls.length).toBe(whileOpen)
  })
})
