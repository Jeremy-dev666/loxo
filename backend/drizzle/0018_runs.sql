CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid,
	"agent_name" text NOT NULL,
	"issue_id" uuid,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"error" text,
	"session_ref" text,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" double precision,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "active_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_issue_status" ON "runs" USING btree ("issue_id","status");--> statement-breakpoint
CREATE INDEX "runs_agent_status" ON "runs" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "runs_user_created" ON "runs" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_active_run_id_runs_id_fk" FOREIGN KEY ("active_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;