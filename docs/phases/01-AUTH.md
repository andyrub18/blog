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

## Functionnalities

- **Login page**: The login page will accept 2 ways of login: email and password or connect with Google
- **Register page**: There will be 2 types of registration, the reader and the member. The reader will just give his name, the email, the password, his date of birth and a short essay about his tought for the country and his account will be validated immediately after email validation and the member will have to put all of this plus his request files (3 pdf documents: a curriculum vitae so that we know his competences, an essay that gives his vision for country, and an other essay that says says how he plans to contribute to the country). The member will have a reader status after email validation until he's validated as member by a core member or the Super admin. If the user registers with google, we'll bypass email and password question but we'll still ask question about birth date, and the essay (in this case, he'll bypass email validation), same for the member
- **Logout functionnality**: A connected can log out

## Steps

- Create the Super admin
- Create the register page (for member and reader)
- Add a log out button that will allow a user to log out

For now, we'll continue to mock the Google login
