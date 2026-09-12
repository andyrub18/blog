-- Phase 3, the review workflow.
--
-- The tables themselves landed with phase 2, unused. This adds the three rules
-- that make them safe to write to:
--
-- `article_submission.langs` — the languages a submission puts to the circle.
-- Reviewers validate the languages they can read and the decision is taken per
-- language, so a submission has to say which ones it covers.
--
-- One live submission per article, and one decision per submission. Two
-- concurrent submissions would split the assigned reviewers and could produce
-- two different answers about the same text; a second decision would be a
-- contradiction with no record of which one the circle meant. Closed rounds are
-- left alone, which is what makes a revision a new round rather than an
-- overwrite.
--
-- One verdict per reviewer per language — per language, because a reviewer who
-- reads both may honestly judge them differently, but may not vote twice on the
-- same text.

DROP INDEX "article_decision_submission_idx";--> statement-breakpoint
ALTER TABLE "article_submission" ADD COLUMN "langs" jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "one_decision_per_submission" ON "article_decision" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_verdict_per_reviewer_per_lang" ON "article_review" USING btree ("submission_id","reviewer_id","lang");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_submission_per_article" ON "article_submission" USING btree ("article_id") WHERE "article_submission"."status" in ('open', 'in_review');