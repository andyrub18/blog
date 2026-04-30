# Project overview

This projeect is a blog that lets a user with the necessary permissions to write an article that'll be saved in a postgreSQL database and other users can read this article and if they have the permissions, they can discuss in a realtime forum.

## Objectives

The main objectives of this project if promote exchanges between users in a certain subject. The users should be able to:

- write an article in the website text editor
- receive validation from a validator
- publish the article so that other people can see it
- comment and discuss about an article in a forum

## Scope

For now the articles with be only text and images. In the future, embeded media should be possible (video, audio etc...)
For now, this project is available via the web. In the future, maybe we'll offer mobile but it's unlikely because we'll make the site mobile friendly enough.

## Internationalization (i18n)

This site is destined to Haitian, so it will support 2 languages to begin. The Haitian Creole (Kreyòl) and French (Français). The site per se will provide those 2 languages in the UI strings via Translation files and the Locale-aware formatting with the Intl API. The routing strategy will be done via path-prefix: /fr/articles/... and /ht/articles/...
When a member is submitting an article he'll have the possibility to submit it in one language or in both and the validator will have to validate either of the languages the article is disponible with. In the database, the system will recognize that it's the same article in differents languages.

## What we'll use

This project is a web project so we'll use TypeScript (obviously) with Solid JS and Tanstack Start.
For the text editor, we'll use TipTap and for the authentication layer, we'll use better auth with social media login
For the database we'll use drizzle orm with PostgreSQL
For the Intl API, we'll use @solid-primitives/i18n
