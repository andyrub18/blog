-- Phase 5, the forum.
--
-- One discussion per article, not one per language: `lang` records which
-- language the poster was reading, so a post can be labelled without splitting
-- the conversation in two (see docs/phases/04-FORUM.md).
--
-- Nothing here deletes a post. `status` moves to 'withdrawn' when its author
-- takes it back and to 'hidden' when a moderator does, and `forum_moderation`
-- is the append-only account of the second kind — a `hidden_reason` column
-- would be overwritten by the next decision and lose the first.
--
-- `changed_at` is what the poller asks against, and it is deliberately not
-- `created_at`: the changes that matter most are the ones that create no row.
-- A post a moderator has just hidden has to reach the tabs that already had it.
--
-- Replies are one level deep. That is enforced in `lib/forum.ts`, which
-- re-parents a reply-to-a-reply onto the root, rather than by a constraint:
-- expressing "my parent has no parent" in SQL needs a trigger, and a trigger is
-- a second place for the rule to live.

CREATE TABLE "forum_moderation" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_post" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"lang" text NOT NULL,
	"author_id" text NOT NULL,
	"parent_id" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forum_moderation" ADD CONSTRAINT "forum_moderation_post_id_forum_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_moderation" ADD CONSTRAINT "forum_moderation_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "forum_post_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "forum_post_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "forum_post_parent_id_forum_post_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."forum_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forum_moderation_post_idx" ON "forum_moderation" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "forum_post_article_idx" ON "forum_post" USING btree ("article_id","created_at");--> statement-breakpoint
CREATE INDEX "forum_post_changed_idx" ON "forum_post" USING btree ("article_id","changed_at");--> statement-breakpoint
CREATE INDEX "forum_post_parent_idx" ON "forum_post" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "forum_post_author_idx" ON "forum_post" USING btree ("author_id","created_at");