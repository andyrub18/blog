CREATE TABLE "member_application" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cv_path" text NOT NULL,
	"vision_essay_path" text NOT NULL,
	"contribution_essay_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_application_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'reader' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "member_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "date_of_birth" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "essay" text;--> statement-breakpoint
ALTER TABLE "member_application" ADD CONSTRAINT "member_application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_application" ADD CONSTRAINT "member_application_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;