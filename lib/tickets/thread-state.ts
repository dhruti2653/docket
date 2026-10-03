import { and, asc, eq } from "drizzle-orm";
import { ticketComments, tickets } from "@/db/schema";
import type { db } from "@/lib/db";
import { computeSlaTransition } from "@/lib/sla";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown inside a merge/split transaction when the row-locked re-check finds
 * a concurrent merge/split already changed the tickets — rolls back, and the
 * caller turns it into a 409 rather than a 500. */
export class ConcurrentTicketChangeError extends Error {}

export const CONCURRENT_CHANGE_MESSAGE =
  "This ticket was just changed by someone else. Refresh the page and try again.";

/** Customer messages after the last public agent reply. The description is
 * a customer message at `descriptionAt`, slotted in by time — not assumed
 * first, since a merge back-dates older messages ahead of it. `publicThread`
 * must exclude internal notes. */
export function countPendingReplies(
  descriptionAt: Date,
  publicThread: { authorRole: string; createdAt: Date }[]
): number {
  const messages = [
    { authorRole: "customer", createdAt: descriptionAt },
    ...publicThread,
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let pending = 0;
  for (const m of messages) {
    pending = m.authorRole === "customer" ? pending + 1 : 0;
  }
  return pending;
}

/** Recomputes a ticket's "awaiting reply" flag + unread count from its public
 * thread, for operations that rewrite the thread wholesale (merge, split)
 * rather than appending one message. Pending = customer messages after the
 * last public agent reply. The ticket's own description counts as a customer
 * message at its createdAt — not necessarily first: a merge back-dates older
 * messages in ahead of it. SLA pause/resume rides the flip, same as the
 * comments route. */
export async function recomputeAwaitingReply(
  tx: Tx,
  ticket: {
    id: string;
    createdAt: Date;
    awaitingReply: boolean;
    waitingSince: Date | null;
  },
  now: Date
): Promise<void> {
  const publicThread = await tx
    .select({
      authorRole: ticketComments.authorRole,
      createdAt: ticketComments.createdAt,
    })
    .from(ticketComments)
    .where(
      and(
        eq(ticketComments.ticketId, ticket.id),
        eq(ticketComments.isInternal, false)
      )
    )
    .orderBy(asc(ticketComments.createdAt));

  const pendingReplies = countPendingReplies(ticket.createdAt, publicThread);
  const awaitingReply = pendingReplies > 0;

  await tx
    .update(tickets)
    .set({
      awaitingReply,
      pendingReplies,
      ...computeSlaTransition(ticket, awaitingReply, now),
    })
    .where(eq(tickets.id, ticket.id));
}
