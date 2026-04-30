# Architecture

This project will use a simple layered architecture

- Data (PostgreSQL + drizzle orm)
- Business Logic: The interaction with the database, the business logic, error handling etc...
- Auth
- The components: UI components (Solid JS)
- The routes

## Multilingue structure

This project will support multiple langagues so the pages will have multiples copies and the article can have multiple copies (or a single one, depends on the author, in this case the article will be identified by a composite key (article_id, lang)).
Each user will have a preferred language, but it can change it in his visit of the website.
