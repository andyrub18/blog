-- Phase 2, articles.
--
-- `article` is the work; `article_translation` is that work in one language,
-- keyed by (article_id, lang). Publication is per language and the translation
-- carries its own status, because publishing the French while the Creole is
-- still being written is the normal case for this movement, not an edge case.
--
-- `content_json` is ProseMirror JSON rather than HTML (DECISIONS.md, D10). It
-- diffs cleanly between review rounds and it cannot carry script: anything
-- outside the allowlist in `src/lib/prosemirror.ts` is dropped on the server
-- before the row is written.
--
-- `article_revision` is append-only. A contradictor assigned to argue against a
-- proposal has to be able to see exactly what changed between rounds, and it is
-- also the only thing stopping an author quietly rewriting a published position.
--
-- The four `article_submission` / `article_reviewer` / `article_review` /
-- `article_decision` tables are created here although nothing writes to them
-- until phase 3. That is the instruction in docs/phases/02-ARTICLES-REVIEW.md:
-- retrofitting the review process onto articles that were already published
-- means inventing a history for them, and a review trail that starts halfway
-- through is not a review trail.

CREATE TABLE "article" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"author_id" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "article_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"lang" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_translation" (
	"article_id" text NOT NULL,
	"lang" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_translation_article_id_lang_pk" PRIMARY KEY("article_id","lang")
);
--> statement-breakpoint
CREATE TABLE "article_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"outcome" text NOT NULL,
	"method" text NOT NULL,
	"tally_json" jsonb NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_review" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"lang" text NOT NULL,
	"verdict" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_reviewer" (
	"submission_id" text NOT NULL,
	"user_id" text NOT NULL,
	"stance" text NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_reviewer_submission_id_user_id_pk" PRIMARY KEY("submission_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "article_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"diagnosis" text NOT NULL,
	"solutions" text NOT NULL,
	"resources" text NOT NULL,
	"risks" text NOT NULL,
	"indicators" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article" ADD CONSTRAINT "article_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revision" ADD CONSTRAINT "article_revision_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revision" ADD CONSTRAINT "article_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_translation" ADD CONSTRAINT "article_translation_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_decision" ADD CONSTRAINT "article_decision_submission_id_article_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."article_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_decision" ADD CONSTRAINT "article_decision_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_review" ADD CONSTRAINT "article_review_submission_id_article_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."article_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_review" ADD CONSTRAINT "article_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviewer" ADD CONSTRAINT "article_reviewer_submission_id_article_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."article_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviewer" ADD CONSTRAINT "article_reviewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviewer" ADD CONSTRAINT "article_reviewer_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_submission" ADD CONSTRAINT "article_submission_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_submission" ADD CONSTRAINT "article_submission_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_author_idx" ON "article" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "article_status_idx" ON "article" USING btree ("status");--> statement-breakpoint
CREATE INDEX "article_revision_article_idx" ON "article_revision" USING btree ("article_id","lang","created_at");--> statement-breakpoint
CREATE INDEX "article_translation_lang_idx" ON "article_translation" USING btree ("lang","status");--> statement-breakpoint
CREATE INDEX "article_decision_submission_idx" ON "article_decision" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "article_review_submission_idx" ON "article_review" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "article_submission_article_idx" ON "article_submission" USING btree ("article_id");