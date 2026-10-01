import { boolean, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "@/db/schema/auth";
import { tickets } from "@/db/schema/tickets";

// An agent's unsent reply on a ticket — one row per (ticket, agent), so two
// agents drafting on the same ticket never see each other's text. Auto-saved
// by the reply composer (PUT /api/tickets/[id]/draft), restored on the next
// visit from any device, and deleted once the reply is actually sent (by the
// comments route) or the agent discards it. `content` is Tiptap JSON, same as
// ticket_comments.content. Attachments are never drafted — unsent files only
// live in the browser.
export const ticketReplyDrafts = pgTable(
  "ticket_reply_drafts",
  {
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] })]
);
