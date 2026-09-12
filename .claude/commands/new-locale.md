---
description: Add a UI language (argument: the locale code, e.g. en or es)
---

Add the locale `$ARGUMENTS` to the platform.

1. Add the code to `LOCALES` and a native-language label to `LOCALE_LABELS` in
   `src/i18n/index.ts`.
2. Add the code to `locales` in `project.inlang/settings.json`.
3. Create `messages/$ARGUMENTS.json` with every key from `messages/fr.json`
   (French is the base locale). Translate the values; keep `{placeholders}`
   identical to the French.
4. Add an `hreflang` link for it in `src/routes/__root.tsx`.
5. Run `npm test` — `src/i18n/messages.test.ts` fails on any key that is
   missing, orphaned, blank, or has mismatched placeholders.
6. Run `/budget` and confirm the bundle did not grow meaningfully. It should
   not: Paraglide tree-shakes per message, so an unused locale costs nothing.

Do not machine-translate and present it as finished. Flag clearly that the
translations need a native speaker's review before release, and say which
strings you were least confident about.
