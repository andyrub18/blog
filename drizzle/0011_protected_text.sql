ALTER TABLE "article_translation" ADD COLUMN "published_revision_id" text;--> statement-breakpoint
ALTER TABLE "article_submission" ADD COLUMN "revision_ids" jsonb;--> statement-breakpoint
-- Every language already live pins the text readers see today: its newest
-- revision. Before this migration a published language always showed its
-- working copy, which is the newest revision by construction.
UPDATE "article_translation" AS t
SET "published_revision_id" = (
  SELECT r."id" FROM "article_revision" AS r
  WHERE r."article_id" = t."article_id" AND r."lang" = t."lang"
  ORDER BY r."created_at" DESC, r."id" DESC
  LIMIT 1
)
WHERE t."status" = 'published';--> statement-breakpoint
-- Rounds still open record the text as it stands now. That is the best the
-- database can say about what a round submitted before snapshots existed was
-- reading; decided rounds are history and are left as they were.
UPDATE "article_submission" AS s
SET "revision_ids" = (
  SELECT jsonb_object_agg(l.lang, (
    SELECT r."id" FROM "article_revision" AS r
    WHERE r."article_id" = s."article_id" AND r."lang" = l.lang
    ORDER BY r."created_at" DESC, r."id" DESC
    LIMIT 1
  ))
  FROM jsonb_array_elements_text(s."langs") AS l(lang)
)
WHERE s."status" IN ('open', 'in_review');
