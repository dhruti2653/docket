-- IF NOT EXISTS / guarded FK: dev databases that ran an earlier draft of 0011
-- already have these columns, so this must apply cleanly on top of them too.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "merged_into_ticket_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "merged_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_merged_into_ticket_id_tickets_id_fk') THEN
    ALTER TABLE "tickets" ADD CONSTRAINT "tickets_merged_into_ticket_id_tickets_id_fk" FOREIGN KEY ("merged_into_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_merged_into_ticket_id_idx" ON "tickets" USING btree ("merged_into_ticket_id");
