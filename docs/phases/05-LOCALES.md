# Phase 6 — English and Spanish

The last row of the roadmap, and the one whose title is misleading. "Two locale
files and the fallback experience" sounds like 1,030 translations and a banner.
The translations were the easy half.

The hard half is that this codebase had one list called `LOCALES` doing two
unrelated jobs, and it worked only because the two answers happened to be the
same. Adding a language that answers one and not the other is what separated
them.

## One list, after a detour

`LOCALES` is `fr`, `ht`, `en`, `es`, and an article may be written, reviewed and
published in any of them.

This phase first shipped two lists — interface locales, and a narrower
`CONTENT_LANGS` of `fr` and `ht` — gating every article write behind the second.
The reasoning ran: `deliberation.ts` publishes a language only once an assigned
contradictor has argued *in that language*, a circle deliberating in Creole and
French has nobody to staff a Spanish adversarial review, therefore a Spanish
draft is writing with no way out and the platform should not offer it.

That was wrong, and it was reverted. **Nothing in the manifesto bans an article
in English or Spanish.** The constraint already enforces itself — a translation
no contradictor reads simply never publishes — so the second gate bought nothing
and took a decision away from KLEA. `CLAUDE.md` warns against *simplifying* a
manifesto rule without a decision from the movement; adding one nobody asked for
is the same error, and easier to miss, because the code reads as more careful
afterwards.

What survives from the detour is the question it was asking, answered the other
way and recorded in D22, plus a db test that an article written in English
publishes like any other.

## The fallback banner says the same thing in four languages

A reader who asks for a language this article does not have is looking at a gap
an author may close — whichever language it is. "Not yet available in English.
You are reading it in French" is exactly as true as the Creole version, because
English is not a tier the site has decided never to fill.

The interim design had two banners: a gap message for Creole and French, and a
standing "KLEA publishes in Creole and French" for English and Spanish. That
second message stated as policy something that was only ever a prediction about
who writes. It is gone, along with the `isContentLang` branch on the reading view
and the note on the index — which is also 0.45 KB of message text the budgeted
page no longer carries.

The per-card language chip on the index stays. It is worth more to a diaspora
reader than to anyone else: which of the languages a given piece is in is how
they choose what they can read.

## Locales are not free, and the docs said they were

Both `CLAUDE.md` and `ROADMAP.md` claimed that Paraglide "tree-shakes per
message, so bundle size does not grow with the number of locales". Half of that
is true and the important half is false.

Paraglide compiles each message into its own function, so a message **nobody
uses** costs nothing — bundle size does not grow with the *number of messages*.
But a message a page **does** use compiles to one function containing every
locale's text. The reading view uses eleven messages; doubling the locales
doubled those eleven strings.

Measured, on the reading view:

| | gzipped |
|---|---|
| before phase 6 | 98.8 KB |
| four locales, no other change | 99.0 KB |
| four locales with real translations | **99.4 KB** |

The 0.2 KB step is the URL-pattern table. The step after it is the one that
matters, and the first measurement hid it: the probe used copies of `fr.json`
for `en` and `es`, so gzip collapsed four identical strings into almost nothing.
Real translations do not compress against each other. **When measuring the cost
of a locale, measure real text.**

`experimentalMiddlewareLocaleSplitting` would fix this properly — the client
tree-shakes every message and the server injects the ones the page used. It is
documented as working only "in SSR/SSG environment without client-side routing"
and as not to be relied on in production. This app has client-side routing. Not
taken.

**The reading view is at 99.4 KB against a 100 KB budget: 0.6 KB of headroom.**
The interim two-banner design took it to 99.6 KB; dropping that message gave
0.2 KB back. The next thing added to that page has to find bytes before it
spends them.

## Adding `en` broke two things that had nothing to do with `en`

Both were the same bug, and both were invisible while the site spoke only French
and Creole.

Paraglide's strategy is `url`, then `cookie`, then `preferredLanguage`, then
`baseLocale`. `preferredLanguage` reads the browser's `Accept-Language`. Chromium
— and jsdom — say `en-US`. That resolved to nothing while `en` was not
registered, and the base locale won by default. Registering `en` made
`preferredLanguage` answer first.

**Component tests.** `@solidjs/testing-library` renders with no URL and no
cookie, so every test asserting a French string started failing at once, in
files that had nothing to do with this phase. `src/test/setup.ts` now pins the
locale, which is what makes those tests about the component again.

**The invitation link.** `governance-actions.ts` built it unprefixed, so a
French invitation email opened an English registration form for anyone whose
browser preferred English. It is now localized with the same locale the email
was rendered in. A link KLEA sends carries the language it was sent in; that is
what `url`-first strategy is for.

The rule this leaves behind: **an unprefixed URL is a decision, not a default.**
It hands the choice of language to the reader's browser. That is right for the
site root and wrong for a link inside a message we wrote.

## What was not done

**The verification email's callback.** Better Auth builds that URL, and its
landing page is reached unprefixed. The same reasoning applies, but overriding
Better Auth's callback is a change to the auth flow, not to the locale registry,
and it belongs with the P0 that retires the mock Google path.

**Seeded or written content in English or Spanish.** Possible from the first
day — the editor, the importer and the review flow all offer all four languages —
but none exists yet, and the demo seed does not create any. Whether the movement
writes in them is KLEA's call, not the platform's.

**A fifth locale.** The registry costs about 0.2 KB of URL-pattern table plus
roughly 0.2 KB of message text on the reading view. There is 0.6 KB of headroom.
One more locale fits; two do not, until something comes off that page.

## Tests

- `src/i18n/messages.test.ts` — parity across four bundles, and the three-place
  registration check: the registry, the Paraglide `urlPatterns`, and
  `project.inlang/settings.json` must agree. Adding a language to two of the
  three is the quiet failure.
- `src/lib/articles.db.test.ts` — a reader whose interface language the movement
  does not publish in is served the article, in the base locale, with
  `requestedLang` preserved so the page can tell which note to show.
- `e2e/locales.spec.ts` — both prefixes serve their interface; a Spanish reader
  is told what KLEA publishes in and *not* that a translation is pending; a
  Creole reader on a French-only article still gets the gap wording; the
  switcher offers all four; and a Spanish article page still loads no editor and
  no forum script.
