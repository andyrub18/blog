# Phase 6 — English and Spanish

The last row of the roadmap, and the one whose title is misleading. "Two locale
files and the fallback experience" sounds like 1,030 translations and a banner.
The translations were the easy half.

The hard half is that this codebase had one list called `LOCALES` doing two
unrelated jobs, and it worked only because the two answers happened to be the
same. Adding a language that answers one and not the other is what separated
them.

## The two lists

`LOCALES` is what the **interface** speaks: the chrome, the forms, the emails,
the URL prefix. It is now `fr`, `ht`, `en`, `es`.

`CONTENT_LANGS` is what the **movement** writes and deliberates in. It is `fr`
and `ht`, and it is not a subset by accident.

Before this phase, `LOCALES` drove both. It filled the author's language
checklist on `/write`, the "which language is this file" picker in the DOCX
importer, and — through `localeOf` in `article-actions.ts` — the language every
article write was filed under. Adding `en` and `es` to that one list would have:

- put two permanent "not written yet" boxes on every author's checklist;
- offered Spanish in the importer;
- and, worst, let an English-reading author's save create an **English
  translation** whenever they did not name a language, because the fallback was
  the request's own locale.

That last one is not cosmetic. `deliberation.ts` publishes a language only once
a contradictor has argued *in that language*. A Spanish translation is a draft
the review circle has no one to staff and `decide()` can never publish — a piece
of writing with no way out. The rule is in the manifesto, not in the code, so
the code has to stop offering what the process cannot finish.

So `contentLangOf` replaced `localeOf`, `resolveRequestContentLang()` sits
beside `resolveRequestLocale()` for every write path that must name a language
without being told one, and `isContentLang` guards the editor's `?lang=` search
param and the importer's form field.

**Promoting a language from interface to content is a decision for KLE**, not a
change somebody makes because the two lists looked asymmetrical. The test in
`src/i18n/messages.test.ts` asserts the asymmetry on purpose, so merging them
again fails loudly.

## The fallback experience

The banner already existed: a Creole reader landing on a French-only article got
`articles_fallbackTitle` — "Not yet available in Creole" — and the article.

For a Spanish reader that sentence is a lie of implication. It says a
translation is pending. None is. KLE deliberates and publishes in Creole and
French; English and Spanish exist so the diaspora can use the site, and no
article is waiting to be translated into them. Shown on every article forever,
"not yet available in Spanish" promises something nobody has decided to do.

So the page tells the two situations apart:

- **A gap** — the reader asked for a content language this article lacks. "Not
  yet available in {language}. You are reading it in {shown}." An author may
  close it tomorrow, and the wording is an invitation.
- **A standing fact** — the reader's interface language is not one the movement
  publishes in. "KLE publishes in Creole and French. This article is in
  {shown}." One sentence, no heading, because it is not news.

`FallbackNote` in `articles/$slug.tsx` branches on `isContentLang(requested)`.
The index carries the same fact once at the top rather than implying it with a
chip on every card — and the per-card language chip stays, because which of the
two languages a given piece is in is worth **more** to a diaspora reader than to
anyone else: it is how they choose what they can read.

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
| four locales with real translations | 99.4 KB |
| plus the fallback note | **99.6 KB** |

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

**The reading view is at 99.6 KB against a 100 KB budget: 0.4 KB of headroom.**
The next thing added to that page has to find bytes before it spends them.

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
was rendered in. A link KLE sends carries the language it was sent in; that is
what `url`-first strategy is for.

The rule this leaves behind: **an unprefixed URL is a decision, not a default.**
It hands the choice of language to the reader's browser. That is right for the
site root and wrong for a link inside a message we wrote.

## What was not done

**The verification email's callback.** Better Auth builds that URL, and its
landing page is reached unprefixed. The same reasoning applies, but overriding
Better Auth's callback is a change to the auth flow, not to the locale registry,
and it belongs with the P0 that retires the mock Google path.

**Content in English or Spanish.** Nothing here makes it possible, on purpose.
If KLE decides to publish in a third language, the change is one entry in
`CONTENT_LANGS` — and a circle that can staff a contradictor in it.

**A fifth locale.** The registry now costs about 0.2 KB of URL-pattern table
plus roughly 0.2 KB of message text on the reading view. There is 0.4 KB of
headroom. Another locale does not fit until something comes off that page.

## Tests

- `src/i18n/messages.test.ts` — parity across four bundles, and the three-place
  registration check: the registry, the Paraglide `urlPatterns`, and
  `project.inlang/settings.json` must agree. Adding a language to two of the
  three is the quiet failure.
- `src/lib/articles.db.test.ts` — a reader whose interface language the movement
  does not publish in is served the article, in the base locale, with
  `requestedLang` preserved so the page can tell which note to show.
- `e2e/locales.spec.ts` — both prefixes serve their interface; a Spanish reader
  is told what KLE publishes in and *not* that a translation is pending; a
  Creole reader on a French-only article still gets the gap wording; the
  switcher offers all four; and a Spanish article page still loads no editor and
  no forum script.
