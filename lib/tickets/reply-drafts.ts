import { and, eq, inArray } from "drizzle-orm";
import { ticketReplyDrafts } from "@/db/schema/reply-drafts";
import { db } from "@/lib/db";

export interface ReplyDraft {
  content: string;
  isInternal: boolean;
  updatedAt: Date;
}

export async function getReplyDraft(
  ticketId: string,
  userId: string
): Promise<ReplyDraft | null> {
  const [row] = await db
    .select({
      content: ticketReplyDrafts.content,
      isInternal: ticketReplyDrafts.isInternal,
      updatedAt: ticketReplyDrafts.updatedAt,
    })
    .from(ticketReplyDrafts)
    .where(
      and(
        eq(ticketReplyDrafts.ticketId, ticketId),
        eq(ticketReplyDrafts.userId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Ticket IDs (out of `ticketIds`) on which `userId` has an unsent draft —
 * drives the "Draft" marker on the /tickets list. */
export async function getDraftTicketIds(
  ticketIds: string[],
  userId: string
): Promise<Set<string>> {
  if (ticketIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ ticketId: ticketReplyDrafts.ticketId })
    .from(ticketReplyDrafts)
    .where(
      and(
        eq(ticketReplyDrafts.userId, userId),
        inArray(ticketReplyDrafts.ticketId, ticketIds)
      )
    );
  return new Set(rows.map((r) => r.ticketId));
}

export async function deleteReplyDraft(ticketId: string, userId: string) {
  await db
    .delete(ticketReplyDrafts)
    .where(
      and(
        eq(ticketReplyDrafts.ticketId, ticketId),
        eq(ticketReplyDrafts.userId, userId)
      )
    );
}
