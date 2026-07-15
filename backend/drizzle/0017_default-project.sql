DROP INDEX "projects_user_inbox";--> statement-breakpoint
UPDATE "projects" SET "kind" = 'default', "name" = 'Default Project' WHERE "kind" = 'inbox';--> statement-breakpoint
CREATE UNIQUE INDEX "projects_user_default" ON "projects" USING btree ("user_id") WHERE "projects"."kind" = 'default';