CREATE TABLE "article_version" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"lang" text NOT NULL,
	"number" integer NOT NULL,
	"submission_id" text,
	"revision_id" text NOT NULL,
	"companion_id" text,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "article_translation" ADD COLUMN "published_version_id" text;--> statement-breakpoint
ALTER TABLE "article_version" ADD CONSTRAINT "article_version_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_version" ADD CONSTRAINT "article_version_submission_id_article_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."article_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_version" ADD CONSTRAINT "article_version_revision_id_article_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."article_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_version" ADD CONSTRAINT "article_version_companion_id_article_companion_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."article_companion"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_version_number_per_lang" ON "article_version" USING btree ("article_id","lang","number");--> statement-breakpoint
CREATE UNIQUE INDEX "one_version_per_round_lang" ON "article_version" USING btree ("submission_id","lang");--> statement-breakpoint
CREATE INDEX "article_version_article_idx" ON "article_version" USING btree ("article_id","lang");--> statement-breakpoint
-- Every language already live becomes version 1, approved: the text readers are
-- shown (the revision D30 pinned) and the PDF they were being given, if any —
-- an approved, current companion made from that text. When a decided round is
-- known to have reviewed exactly that revision, the version records it.
INSERT INTO "article_version" ("id", "article_id", "lang", "number", "submission_id", "revision_id", "companion_id", "outcome", "created_at", "decided_at")
SELECT
  gen_random_uuid()::text,
  t."article_id",
  t."lang",
  1,
  (SELECT s."id" FROM "article_submission" AS s
    WHERE s."article_id" = t."article_id" AND s."status" = 'decided'
      AND s."revision_ids" ->> t."lang" = t."published_revision_id"
    ORDER BY s."submitted_at" DESC LIMIT 1),
  t."published_revision_id",
  (SELECT c."id" FROM "article_companion" AS c
    WHERE c."article_id" = t."article_id" AND c."lang" = t."lang"
      AND c."revision_id" = t."published_revision_id"
      AND c."approved_in_submission_id" IS NOT NULL
      AND c."superseded_at" IS NULL
    ORDER BY c."uploaded_at" DESC LIMIT 1),
  'approved',
  coalesce(t."published_at", now()),
  t."published_at"
FROM "article_translation" AS t
WHERE t."status" = 'published' AND t."published_revision_id" IS NOT NULL;--> statement-breakpoint
UPDATE "article_translation" AS t
SET "published_version_id" = v."id"
FROM "article_version" AS v
WHERE v."article_id" = t."article_id" AND v."lang" = t."lang" AND v."outcome" = 'approved';--> statement-breakpoint
-- Every language of a round still open becomes the next version, pending: the
-- text the round recorded, and the PDF the circle had from the start of it.
INSERT INTO "article_version" ("id", "article_id", "lang", "number", "submission_id", "revision_id", "companion_id", "outcome", "created_at", "decided_at")
SELECT
  gen_random_uuid()::text,
  s."article_id",
  r.lang,
  coalesce((SELECT max(v."number") FROM "article_version" AS v
    WHERE v."article_id" = s."article_id" AND v."lang" = r.lang), 0) + 1,
  s."id",
  r.revision_id,
  (SELECT c."id" FROM "article_companion" AS c
    WHERE c."article_id" = s."article_id" AND c."lang" = r.lang
      AND c."revision_id" = r.revision_id
      AND c."superseded_at" IS NULL
      AND c."uploaded_at" <= s."submitted_at"
    ORDER BY c."uploaded_at" DESC LIMIT 1),
  'pending',
  s."submitted_at",
  NULL
FROM "article_submission" AS s, jsonb_each_text(s."revision_ids") AS r(lang, revision_id)
WHERE s."status" IN ('open', 'in_review') AND s."revision_ids" IS NOT NULL;
