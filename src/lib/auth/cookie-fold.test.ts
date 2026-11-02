import { describe, expect, it } from 'vitest'
import { foldSetCookies } from './cookie-fold'

describe('foldSetCookies', () => {
  /** What turning codes on does: a new session replaces the one the request came with. */
  it('replaces a cookie the request carried', () => {
    expect(
      foldSetCookies('lang=fr; better-auth.session_token=old.sig', [
        'better-auth.session_token=new.sig; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800',
      ]),
    ).toBe('lang=fr; better-auth.session_token=new.sig')
  })

  it('drops a cookie expired by Max-Age or by a date in the past', () => {
    expect(
      foldSetCookies('a=1; b=2; c=3', [
        'a=; Max-Age=0',
        'b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ]),
    ).toBe('c=3')
  })

  it('applies the headers in order, so the last word wins', () => {
    expect(foldSetCookies(null, ['s=one', 's=; Max-Age=0', 's=two'])).toBe('s=two')
  })

  it('keeps an equals sign inside a value', () => {
    expect(foldSetCookies('x=a=b', ['y=c=d; Path=/'])).toBe('x=a=b; y=c=d')
  })
})
