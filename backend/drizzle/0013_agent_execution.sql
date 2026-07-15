ALTER TABLE "agents" ADD COLUMN "execution" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "machine_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "machine_workdir" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "agents" SET "execution" = 'api' WHERE "runtime" = 'api';
