ALTER TABLE "article_companion" DROP CONSTRAINT "article_companion_approved_in_submission_id_article_submission_id_fk";
--> statement-breakpoint
ALTER TABLE "article_translation" DROP COLUMN "published_revision_id";--> statement-breakpoint
ALTER TABLE "article_submission" DROP COLUMN "revision_ids";--> statement-breakpoint
ALTER TABLE "article_companion" DROP COLUMN "approved_in_submission_id";--> statement-breakpoint
ALTER TABLE "article_companion" DROP COLUMN "approved_at";