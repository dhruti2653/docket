import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "@/db/schema/auth";
import { tickets } from "@/db/schema/tickets";

// Agent-only relationships between two tickets (lib/tickets/links.ts). One row
// per link, read from both ends: `blocks` is directional (ticketId blocks
// linkedTicketId, shown as "Blocked by" on the other side), `duplicate_of` is
// directional too, `related_to` is symmetric — the API refuses to add the
// reverse of an existing related_to row, so a pair never appears twice.
export const ticketLinks = pgTable(
  "ticket_links",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    linkedTicketId: text("linked_ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ticket_links_pair_type_idx").on(
      t.ticketId,
      t.linkedTicketId,
      t.type
    ),
    index("ticket_links_linked_ticket_id_idx").on(t.linkedTicketId),
  ]
);
