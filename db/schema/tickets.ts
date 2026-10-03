import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { apiKeys } from "@/db/schema/api-keys";
import { user } from "@/db/schema/auth";
import { customers } from "@/db/schema/customers";

export const tickets = pgTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    ticketNumber: serial("ticket_number").notNull().unique(),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    customerToken: text("customer_token").notNull().unique(),
    assignedAgentId: text("assigned_agent_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // "Awaiting reply": true when the newest public message is the customer's,
    // cleared when an agent replies publicly. `pendingReplies` counts customer
    // messages since that reply — the unread badge on the ticket list.
    awaitingReply: boolean("awaiting_reply").notNull().default(false),
    pendingReplies: integer("pending_replies").notNull().default(0),
    // How the ticket entered the system — "portal" (customer form) or "api"
    // (POST /api/v1/tickets). apiKeyId is set only for the latter.
    source: text("source").notNull().default("portal"),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Set when this ticket was merged into another (lib/tickets/merge.ts). The
    // row is kept, closed, so its old portal link / API id can forward to the
    // surviving ticket instead of 404ing. Always points at a ticket that is
    // itself not merged — merging the target later re-points these rows.
    mergedIntoTicketId: text("merged_into_ticket_id").references(
      (): AnyPgColumn => tickets.id,
      { onDelete: "set null" }
    ),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    // SLA tracking (lib/sla.ts), written by the same call sites as awaitingReply
    // via computeSlaTransition(). When the current wait state began; null once
    // closed. Only moves on a real awaitingReply flip, never on every message,
    // so a customer's second follow-up can't reset the response clock.
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
    // Frozen once set — the first non-internal agent/admin reply. Keeps the
    // First Response outcome displayable after the ticket moves on to
    // tracking Next Response.
    firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
    // Accumulated "waiting for agent" seconds from completed pause/resume
    // cycles — the Resolution SLA clock. Stored in seconds (not ms) to avoid
    // the ~24.8-day overflow a 32-bit int would hit with milliseconds.
    slaActiveSeconds: integer("sla_active_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tickets_ticket_number_idx").on(t.ticketNumber),
    index("tickets_customer_id_idx").on(t.customerId),
    index("tickets_status_idx").on(t.status),
    index("tickets_assigned_agent_id_idx").on(t.assignedAgentId),
    index("tickets_created_at_idx").on(t.createdAt),
    index("tickets_awaiting_reply_idx").on(t.awaitingReply),
    index("tickets_priority_idx").on(t.priority),
    index("tickets_merged_into_ticket_id_idx").on(t.mergedIntoTicketId),
  ]
);

export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    authorRole: text("author_role").notNull(),
    content: text("content").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ticket_comments_ticket_id_idx").on(t.ticketId),
    index("ticket_comments_author_id_idx").on(t.authorId),
    index("ticket_comments_is_internal_idx").on(t.isInternal),
  ]
);

export const ticketAttachments = pgTable(
  "ticket_attachments",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => ticketComments.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedById: text("uploaded_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    uploadedByName: text("uploaded_by_name").notNull(),
    uploadedByRole: text("uploaded_by_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ticket_attachments_ticket_id_idx").on(t.ticketId),
    index("ticket_attachments_comment_id_idx").on(t.commentId),
  ]
);

export const ticketActivity = pgTable(
  "ticket_activity",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ticket_activity_ticket_id_idx").on(t.ticketId),
    index("ticket_activity_created_at_idx").on(t.createdAt),
  ]
);
