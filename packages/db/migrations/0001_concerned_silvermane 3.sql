CREATE TABLE IF NOT EXISTS "workflow_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_id" text NOT NULL,
	"output" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "copied_from_template_id" uuid;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "copied_from_version" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_outputs" ADD CONSTRAINT "workflow_outputs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_outputs" ADD CONSTRAINT "workflow_outputs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
