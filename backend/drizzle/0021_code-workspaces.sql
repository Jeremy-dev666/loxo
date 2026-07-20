CREATE TABLE "execution_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"repository_id" uuid,
	"location" text NOT NULL,
	"machine_id" uuid,
	"worktree_path" text NOT NULL,
	"branch_name" text NOT NULL,
	"base_ref" text NOT NULL,
	"base_commit" text NOT NULL,
	"head_commit" text,
	"status" text DEFAULT 'preparing' NOT NULL,
	"last_run_id" uuid,
	"last_error" text,
	"prepared_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"retained_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"location" text NOT NULL,
	"machine_id" uuid,
	"root_path" text,
	"default_base_ref" text DEFAULT 'main' NOT NULL,
	"branch_prefix" text DEFAULT 'swarmdev' NOT NULL,
	"cleanup_policy" text DEFAULT 'manual' NOT NULL,
	"repository_fingerprint" text,
	"active_merge_workspace_id" uuid,
	"active_merge_operation_id" text,
	"active_merge_pre_head" text,
	"active_merge_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_repositories_machine_binding" CHECK (NOT ("project_repositories"."location" = 'machine' AND ("project_repositories"."machine_id" IS NULL OR "project_repositories"."root_path" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "run_change_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"execution_workspace_id" uuid,
	"before_head" text NOT NULL,
	"after_head" text NOT NULL,
	"changed_files" integer DEFAULT 0 NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"before_summary_json" jsonb DEFAULT '{"files":[],"untracked":[]}'::jsonb NOT NULL,
	"after_summary_json" jsonb DEFAULT '{"files":[],"untracked":[]}'::jsonb NOT NULL,
	"change_fingerprint" text NOT NULL,
	"patch_storage_key" text,
	"patch_truncated" boolean DEFAULT false NOT NULL,
	"policy_violation" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "permission_level" text DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_reviews" ADD COLUMN "change_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_repository_id_project_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."project_repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_last_run_id_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_active_merge_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("active_merge_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_change_snapshots" ADD CONSTRAINT "run_change_snapshots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_change_snapshots" ADD CONSTRAINT "run_change_snapshots_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_workspaces_issue_active" ON "execution_workspaces" USING btree ("issue_id") WHERE "execution_workspaces"."status" NOT IN ('merged', 'retained', 'abandoned');--> statement-breakpoint
CREATE INDEX "execution_workspaces_repository_status" ON "execution_workspaces" USING btree ("repository_id","status");--> statement-breakpoint
CREATE INDEX "execution_workspaces_user_status" ON "execution_workspaces" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_project" ON "project_repositories" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_change_snapshots_run" ON "run_change_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_change_snapshots_workspace" ON "run_change_snapshots" USING btree ("execution_workspace_id");--> statement-breakpoint
ALTER TABLE "issue_reviews" ADD CONSTRAINT "issue_reviews_change_snapshot_id_run_change_snapshots_id_fk" FOREIGN KEY ("change_snapshot_id") REFERENCES "public"."run_change_snapshots"("id") ON DELETE set null ON UPDATE no action;