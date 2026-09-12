# Project overview

This project is a blog that lets a user with the necessary permissions to write an article that'll be saved in a postgreSQL database and other users can read this article and if they have the permissions, they can discuss in a realtime forum.

## Objectives

The main objectives of this project if promote exchanges between users in a certain subject. The users should be able to:

- write an article in the website text editor
- receive validation from a validator
- publish the article so that other people can see it
- comment and discuss about an article in a forum

## Scope

For now the articles with be only text, tables and images. In the future, embeded media should be possible (video, audio etc...)
For now, this project is available via the web. In the future, maybe we'll offer mobile but it's unlikely because we'll make the site mobile friendly enough.

## Internationalization (i18n)

The site ships **Kreyol (ht) and French (fr)** today, with **English (en) and Spanish (es)** planned for the diaspora - English for the United States and Canada, Spanish for the Dominican Republic and Chile. Routing is by path prefix: `/fr/articles/...`, `/ht/articles/...`.

UI strings are compiled by **Paraglide**, which turns each message into its own tree-shakable function, so bundle size does not grow with the number of locales. Locale-aware number and date formatting uses the Intl API. An article is never required in all four languages: an author writes what they can, and a reader landing on an unavailable language gets a fallback with an honest banner and an invitation to help translate.
When a member is submitting an article he'll have the possibility to submit it in one language or in both and the validator will have to validate either of the languages the article is disponible with. In the database, the system will recognize that it's the same article in differents languages.

## What we use

TypeScript with **Solid 2** and **TanStack Start**, both on pinned release candidates (see `DECISIONS.md`, D6/D7). **TipTap** for the editor, **Better Auth** for authentication, **Drizzle ORM** with **PostgreSQL** for data, and **Paraglide** for i18n.

**Vitest** covers unit, integration and component tests; **Playwright** covers end-to-end across desktop and mobile viewports.

Every dependency is pinned to an exact version. See `DECISIONS.md` for why, and `phases/00-HARDENING.md` for what that cost and bought.
