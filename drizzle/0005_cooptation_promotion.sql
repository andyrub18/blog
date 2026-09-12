-- Phase 1, cooptation and promotion to senior member.
--
-- `invitation` stores a SHA-256 of the token, never the token: the raw value
-- lives only in the emailed link, so a leaked backup is not a set of working
-- membership grants.
--
-- `senior_promotion` and its votes make promotion a qualified-majority decision
-- recorded voter by voter. A senior member can read every applicant's dossier;
-- granting that should not be one person's click.
--
-- The three dossier paths become nullable for cooptation alone: a sponsored
-- member may defer their CV and vision essay, never their contribution plan,
-- which is what the probation review evaluates them against. `origin` records
-- which path an application came from.
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"invited_by" text,
	"note" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "senior_promotion" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_user_id" text NOT NULL,
	"opened_by" text,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senior_promotion_vote" (
	"id" text PRIMARY KEY NOT NULL,
	"promotion_id" text NOT NULL,
	"voter_id" text NOT NULL,
	"vote" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_application" ALTER COLUMN "cv_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member_application" ALTER COLUMN "vision_essay_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member_application" ALTER COLUMN "contribution_essay_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member_application" ADD COLUMN "origin" text DEFAULT 'application' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_used_by_user_id_user_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_promotion" ADD CONSTRAINT "senior_promotion_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_promotion" ADD CONSTRAINT "senior_promotion_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_promotion_vote" ADD CONSTRAINT "senior_promotion_vote_promotion_id_senior_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."senior_promotion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_promotion_vote" ADD CONSTRAINT "senior_promotion_vote_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_inviter_idx" ON "invitation" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_promotion_per_user" ON "senior_promotion" USING btree ("subject_user_id") WHERE "senior_promotion"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "one_vote_per_senior_member" ON "senior_promotion_vote" USING btree ("promotion_id","voter_id");--> statement-breakpoint
CREATE INDEX "senior_promotion_vote_promotion_idx" ON "senior_promotion_vote" USING btree ("promotion_id");