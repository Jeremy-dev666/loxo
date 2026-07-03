CREATE TABLE "workflow_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"run_count" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"path" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"node_id" text,
	"message" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"task" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"mode" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"workflow" jsonb NOT NULL,
	"final_output" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_node_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_states" ADD CONSTRAINT "workflow_node_states_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_events_execution_seq" ON "workflow_events" USING btree ("execution_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_node_states_execution_node" ON "workflow_node_states" USING btree ("execution_id","node_id");