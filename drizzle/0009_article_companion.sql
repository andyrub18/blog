CREATE TABLE "article_companion" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"lang" text NOT NULL,
	"revision_id" text NOT NULL,
	"storage_path" text,
	"byte_size" integer NOT NULL,
	"page_count" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by" text
);
--> statement-breakpoint
ALTER TABLE "article_companion" ADD CONSTRAINT "article_companion_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_companion" ADD CONSTRAINT "article_companion_revision_id_article_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."article_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_companion" ADD CONSTRAINT "article_companion_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_companion" ADD CONSTRAINT "article_companion_superseded_by_user_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_companion_article_idx" ON "article_companion" USING btree ("article_id","lang","uploaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_current_companion_per_lang" ON "article_companion" USING btree ("article_id","lang") WHERE "article_companion"."superseded_at" is null;