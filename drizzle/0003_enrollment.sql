-- Phase 1, enrollment.
--
-- Renames the validator role to match the manifesto's vocabulary (DECISIONS.md,
-- D2), replaces the UNIQUE constraint that permanently barred a rejected
-- applicant from ever re-applying, adds probation tracking, and introduces the
-- append-only audit tables.

-- Role rename. Drizzle cannot generate this: `role` is a text column typed only
-- in TypeScript, so a rename is invisible to schema diffing. Without it every
-- existing validator silently keeps a role string that maps to nothing and
-- loses their permissions.
UPDATE "user" SET "role" = 'senior_member' WHERE "role" = 'core_member';--> statement-breakpoint

CREATE TABLE "access_event" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_event" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"rationale" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_change" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_user_id" text NOT NULL,
	"from_role" text NOT NULL,
	"to_role" text NOT NULL,
	"reason" text NOT NULL,
	"rationale" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_application" DROP CONSTRAINT "member_application_user_id_unique";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "member_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "probation_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "sponsored_by" text;--> statement-breakpoint
ALTER TABLE "member_application" ADD COLUMN "contribution_plan" text;--> statement-breakpoint
ALTER TABLE "member_application" ADD COLUMN "decision_rationale" text;--> statement-breakpoint
ALTER TABLE "access_event" ADD CONSTRAINT "access_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_change" ADD CONSTRAINT "role_change_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_change" ADD CONSTRAINT "role_change_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_event_actor_idx" ON "access_event" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "access_event_resource_idx" ON "access_event" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "application_event_application_idx" ON "application_event" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "role_change_subject_idx" ON "role_change" USING btree ("subject_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_application_per_user" ON "member_application" USING btree ("user_id") WHERE "member_application"."status" in ('pending', 'under_review', 'needs_more_info');