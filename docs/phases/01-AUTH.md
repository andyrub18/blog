# First phase: Authentication

For the first phase, we'll lay out our authentication. This is a role based authorization control system.
The roles we have are as follow:

- Super admin: The dev, the conceptor of the system
- Core member: A core member of the organization that can validate documents to publish, can remove other writers document, can comment before publication for correction, can remove comment on forum, can block another member for misconduct, can register a member or another core member
- Member: A member of the organization that can write articles and can comment on the forums
- Reader: A reader can register himself with minimal KYC. They can only read article and comment on the forum

## Library

The library we'll use is better auth with drizzle orm and save everything in a postgreSQL database

## Core

The routes will be secured using the best practices of Tanstack Start and drizzle orm
