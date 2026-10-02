CREATE TABLE "ticket_links" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"linked_ticket_id" text NOT NULL,
	"type" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_linked_ticket_id_tickets_id_fk" FOREIGN KEY ("linked_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_links_pair_type_idx" ON "ticket_links" USING btree ("ticket_id","linked_ticket_id","type");--> statement-breakpoint
CREATE INDEX "ticket_links_linked_ticket_id_idx" ON "ticket_links" USING btree ("linked_ticket_id");