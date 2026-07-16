CREATE TABLE "issue_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"reviewer_type" text NOT NULL,
	"reviewer_user_id" uuid,
	"reviewer_agent_id" uuid,
	"run_id" uuid,
	"decision" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_reviews_single_principal" CHECK (NOT ("issue_reviews"."reviewer_agent_id" IS NOT NULL AND "issue_reviews"."reviewer_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "issue_reviews" ADD CONSTRAINT "issue_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reviews" ADD CONSTRAINT "issue_reviews_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reviews" ADD CONSTRAINT "issue_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reviews" ADD CONSTRAINT "issue_reviews_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reviews" ADD CONSTRAINT "issue_reviews_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_reviews_issue_created" ON "issue_reviews" USING btree ("issue_id","created_at");