import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  customers,
  ticketActivity,
  ticketAttachments,
  ticketComments,
  ticketCustomFieldValues,
  ticketLinks,
  ticketReplyDrafts,
  tickets,
  ticketTags,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  publishTicketCommentCreated,
  publishTicketCreated,
} from "@/lib/realtime";
import { textToRichTextJson } from "@/lib/rich-text";
import { computeSlaTransition } from "@/lib/sla";
import { getClosedStatus, getTicketStatuses } from "@/lib/ticket-config";
import { ticketLinkKey } from "@/lib/tickets/links";
import {
  CONCURRENT_CHANGE_MESSAGE,
  ConcurrentTicketChangeError,
  recomputeAwaitingReply,
} from "@/lib/tickets/thread-state";
import {
  dispatchWebhookEvent,
  ticketPayloadData,
} from "@/lib/webhooks/dispatch";

/** The ticket a request for `ticketId` should act on: itself, or the ticket it
 * was merged into. Merges never chain (see mergeTickets), so one hop is enough.
 * Unknown ids come back unchanged so the caller's own 404 still fires. */
export async function resolveMergedTicketId(ticketId: string): Promise<string> {
  const [row] = await db
    .select({ mergedIntoTicketId: tickets.mergedIntoTicketId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row?.mergedIntoTicketId ?? ticketId;
}

/** Customer-side forwarding. Validates `token` against the ticket it was issued
 * for, then — if that ticket was merged — swaps in the surviving ticket and ITS
 * token. Safe only because merges are same-customer (enforced below), so the
 * customer is never handed a token for someone else's ticket. Null on a bad
 * id/token pair. */
export async function resolveCustomerTicket(
  ticketId: string,
  token: string
): Promise<{ ticketId: string; token: string; merged: boolean } | null> {
  const [row] = await db
    .select({ mergedIntoTicketId: tickets.mergedIntoTicketId })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.customerToken, token)))
    .limit(1);
  if (!row) {
    return null;
  }
  if (!row.mergedIntoTicketId) {
    return { ticketId, token, merged: false };
  }
  const [target] = await db
    .select({ id: tickets.id, customerToken: tickets.customerToken })
    .from(tickets)
    .where(eq(tickets.id, row.mergedIntoTicketId))
    .limit(1);
  return target
    ? { ticketId: target.id, token: target.customerToken, merged: true }
    : null;
}

/** Inserts a reply and its attachment rows unless `ticketId` has been merged
 * by now. Routes forward merged ids up front, but a merge can land between
 * that check and the insert — which, after a large upload, can be seconds. The
 * row lock (FOR SHARE) waits out an in-flight merge and makes a later merge
 * wait for this insert (so it moves the reply), closing the gap where the
 * reply would land on the hidden, closed shell. False = merged meanwhile; the
 * caller cleans up its uploads and asks the user to resend. */
export async function insertReplyUnlessMerged(
  ticketId: string,
  comment: typeof ticketComments.$inferInsert,
  attachments: (typeof ticketAttachments.$inferInsert)[]
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ mergedIntoTicketId: tickets.mergedIntoTicketId })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for("share");
    if (row?.mergedIntoTicketId) {
      return false;
    }
    await tx.insert(ticketComments).values(comment);
    if (attachments.length > 0) {
      await tx.insert(ticketAttachments).values(attachments);
    }
    return true;
  });
}

export const MERGED_DURING_REPLY_MESSAGE =
  "This ticket was just merged into another ticket, so your message wasn't sent. Refresh the page and send it again.";

/** `ticketIds` plus every ticket merged into one of them. Hard-delete paths
 * use this so deleting a surviving ticket also removes its merged shells —
 * otherwise their pointer is nulled by the FK and they'd resurface in lists as
 * empty closed tickets whose content was just deleted. */
export async function withMergedShells(ticketIds: string[]): Promise<string[]> {
  if (ticketIds.length === 0) {
    return [];
  }
  const shells = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(inArray(tickets.mergedIntoTicketId, ticketIds));
  return [...new Set([...ticketIds, ...shells.map((s) => s.id)])];
}

/** Route-level forwarding: what every ticket route calls first, so a request
 * for a merged ticket (stale portal tab, old API id) acts on the survivor.
 * With a `token`, it's validated against the requested ticket and swapped for
 * the survivor's; an invalid token is passed through untouched for the
 * route's own token check to reject. */
export async function forwardMergedTicket(
  ticketId: string,
  token?: string
): Promise<{ ticketId: string; token?: string }> {
  if (token) {
    const customer = await resolveCustomerTicket(ticketId, token);
    if (customer) {
      return { ticketId: customer.ticketId, token: customer.token };
    }
  }
  return { ticketId: await resolveMergedTicketId(ticketId), token };
}

interface Actor {
  email?: string;
  id: string;
  name: string;
  role: string;
}

export type MergeResult =
  | { ok: true; targetTicketNumber: number }
  | { ok: false; error: string; status: number };

const mergeColumns = {
  id: tickets.id,
  ticketNumber: tickets.ticketNumber,
  subject: tickets.subject,
  description: tickets.description,
  status: tickets.status,
  priority: tickets.priority,
  category: tickets.category,
  customerId: tickets.customerId,
  customerName: customers.name,
  customerEmail: customers.email,
  mergedIntoTicketId: tickets.mergedIntoTicketId,
  awaitingReply: tickets.awaitingReply,
  waitingSince: tickets.waitingSince,
  firstRespondedAt: tickets.firstRespondedAt,
  closedAt: tickets.closedAt,
  createdAt: tickets.createdAt,
};

/** Merges `sourceId` into the ticket numbered `targetTicketNumber`. The source
 * is kept — closed and pointing at the target — so its portal link and API id
 * keep working; everything customer-visible moves to the target. Same-customer
 * only, target must be open, irreversible. No customer email (silent merge). */
export async function mergeTickets(
  sourceId: string,
  targetTicketNumber: number,
  actor: Actor
): Promise<MergeResult> {
  const [[source], [target]] = await Promise.all([
    db
      .select(mergeColumns)
      .from(tickets)
      .innerJoin(customers, eq(tickets.customerId, customers.id))
      .where(eq(tickets.id, sourceId))
      .limit(1),
    db
      .select(mergeColumns)
      .from(tickets)
      .innerJoin(customers, eq(tickets.customerId, customers.id))
      .where(eq(tickets.ticketNumber, targetTicketNumber))
      .limit(1),
  ]);

  if (!source) {
    return { ok: false, error: "This ticket no longer exists.", status: 404 };
  }
  if (!target) {
    return {
      ok: false,
      error: `Ticket #${targetTicketNumber} not found.`,
      status: 404,
    };
  }
  if (source.id === target.id) {
    return {
      ok: false,
      error: "A ticket can't be merged into itself.",
      status: 400,
    };
  }
  if (source.mergedIntoTicketId) {
    return {
      ok: false,
      error: "This ticket has already been merged.",
      status: 400,
    };
  }
  if (target.mergedIntoTicketId) {
    return {
      ok: false,
      error: `Ticket #${target.ticketNumber} has already been merged into another ticket. Merge into that ticket instead.`,
      status: 400,
    };
  }
  // The source's old portal link forwards to the target with the target's
  // token — across customers that would expose one customer's thread to another.
  if (source.customerId !== target.customerId) {
    return {
      ok: false,
      error: "Only tickets from the same customer can be merged.",
      status: 400,
    };
  }

  const [statuses, closedStatus] = await Promise.all([
    getTicketStatuses(),
    getClosedStatus(),
  ]);
  const isClosed = (slug: string) =>
    statuses.find((s) => s.slug === slug)?.isClosedState ?? false;
  // The customer gets forwarded to the target — it must be one they can reply on.
  if (isClosed(target.status)) {
    return {
      ok: false,
      error: `Ticket #${target.ticketNumber} is closed. Reopen it first.`,
      status: 400,
    };
  }
  // Re-derived from the locked row inside the transaction; this pre-lock
  // value only seeds it.
  let sourceStatus = source.status;

  const now = new Date();

  try {
    await runMerge();
  } catch (err) {
    if (err instanceof ConcurrentTicketChangeError) {
      return { ok: false, error: CONCURRENT_CHANGE_MESSAGE, status: 409 };
    }
    throw err;
  }

  // The checks above ran outside the transaction. Lock both rows (in id order,
  // so two opposite merges can't deadlock) and re-check, or two agents merging
  // A→B and B→A at once would leave the pair pointing at each other.
  // NO KEY UPDATE serializes merges without blocking customer replies
  // (their FK check only takes KEY SHARE).
  async function runMerge() {
    await db.transaction(async (tx) => {
      const locked = await tx
        .select({
          id: tickets.id,
          status: tickets.status,
          mergedIntoTicketId: tickets.mergedIntoTicketId,
          awaitingReply: tickets.awaitingReply,
          waitingSince: tickets.waitingSince,
          firstRespondedAt: tickets.firstRespondedAt,
          closedAt: tickets.closedAt,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .where(inArray(tickets.id, [source.id, target.id]))
        .orderBy(asc(tickets.id))
        .for("no key update");
      const lockedSource = locked.find((t) => t.id === source.id);
      const lockedTarget = locked.find((t) => t.id === target.id);
      if (
        !lockedSource ||
        !lockedTarget ||
        locked.some((t) => t.mergedIntoTicketId) ||
        isClosed(lockedTarget.status)
      ) {
        throw new ConcurrentTicketChangeError();
      }
      // Everything stateful below (SLA clocks, status) uses the locked rows,
      // not the pre-lock reads — a reply may have moved them in between.
      const sourceWasClosed = isClosed(lockedSource.status);
      sourceStatus = sourceWasClosed
        ? lockedSource.status
        : (closedStatus?.slug ?? "closed");

      // 1. The source's opening message becomes a customer comment on the target,
      // back-dated so it sorts into the thread where it really happened. Its
      // ticket-level attachments ride along on that comment.
      const descriptionCommentId = createId();
      await tx.insert(ticketComments).values({
        id: descriptionCommentId,
        ticketId: target.id,
        authorName: source.customerName,
        authorRole: "customer",
        content: source.description,
        isInternal: false,
        createdAt: source.createdAt,
        updatedAt: now,
      });
      await tx
        .update(ticketAttachments)
        .set({ ticketId: target.id, commentId: descriptionCommentId })
        .where(
          and(
            eq(ticketAttachments.ticketId, source.id),
            isNull(ticketAttachments.commentId)
          )
        );

      // 2. Move the rest of the thread and its files. Storage keys are opaque
      // strings — the files themselves don't move.
      await tx
        .update(ticketComments)
        .set({ ticketId: target.id })
        .where(eq(ticketComments.ticketId, source.id));
      await tx
        .update(ticketAttachments)
        .set({ ticketId: target.id })
        .where(eq(ticketAttachments.ticketId, source.id));

      // 3. Tags: union. Custom fields: the target's own values win; the source
      // only fills fields the target left empty.
      const sourceTags = await tx
        .select({ tagId: ticketTags.tagId })
        .from(ticketTags)
        .where(eq(ticketTags.ticketId, source.id));
      if (sourceTags.length > 0) {
        await tx
          .insert(ticketTags)
          .values(
            sourceTags.map((t) => ({
              id: createId(),
              ticketId: target.id,
              tagId: t.tagId,
              createdAt: now,
            }))
          )
          .onConflictDoNothing();
      }
      const sourceFields = await tx
        .select({
          fieldId: ticketCustomFieldValues.fieldId,
          value: ticketCustomFieldValues.value,
        })
        .from(ticketCustomFieldValues)
        .where(eq(ticketCustomFieldValues.ticketId, source.id));
      if (sourceFields.length > 0) {
        await tx
          .insert(ticketCustomFieldValues)
          .values(
            sourceFields.map((f) => ({
              id: createId(),
              ticketId: target.id,
              fieldId: f.fieldId,
              value: f.value,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .onConflictDoNothing();
      }

      // 4. Drafts can't move — the same agent may already have one on the target.
      await tx
        .delete(ticketReplyDrafts)
        .where(eq(ticketReplyDrafts.ticketId, source.id));

      // 5. Links: re-point the source's links at the target, dropping any that
      // would become a self-link or duplicate an existing one.
      const sourceLinks = await tx
        .select()
        .from(ticketLinks)
        .where(
          or(
            eq(ticketLinks.ticketId, source.id),
            eq(ticketLinks.linkedTicketId, source.id)
          )
        );
      if (sourceLinks.length > 0) {
        await tx.delete(ticketLinks).where(
          inArray(
            ticketLinks.id,
            sourceLinks.map((l) => l.id)
          )
        );
        const repointed = sourceLinks
          .map((l) => ({
            ...l,
            id: createId(),
            ticketId: l.ticketId === source.id ? target.id : l.ticketId,
            linkedTicketId:
              l.linkedTicketId === source.id ? target.id : l.linkedTicketId,
            updatedAt: now,
          }))
          .filter((l) => l.ticketId !== l.linkedTicketId);
        // Drop any that duplicate a link the target already has (or each
        // other) in either direction — onConflictDoNothing only catches the
        // exact same direction.
        const targetLinks = await tx
          .select({
            ticketId: ticketLinks.ticketId,
            linkedTicketId: ticketLinks.linkedTicketId,
            type: ticketLinks.type,
          })
          .from(ticketLinks)
          .where(
            or(
              eq(ticketLinks.ticketId, target.id),
              eq(ticketLinks.linkedTicketId, target.id)
            )
          );
        const seen = new Set(targetLinks.map(ticketLinkKey));
        const toInsert = repointed.filter((l) => {
          const key = ticketLinkKey(l);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
        if (toInsert.length > 0) {
          await tx.insert(ticketLinks).values(toInsert).onConflictDoNothing();
        }
      }

      // 6. Tickets previously merged into the source now forward straight to the
      // target, so resolution is always a single hop.
      await tx
        .update(tickets)
        .set({ mergedIntoTicketId: target.id, updatedAt: now })
        .where(eq(tickets.mergedIntoTicketId, source.id));

      // 7. Close the source and point it at the target.
      await tx
        .update(tickets)
        .set({
          status: sourceStatus,
          closedAt: lockedSource.closedAt ?? now,
          mergedIntoTicketId: target.id,
          mergedAt: now,
          awaitingReply: false,
          pendingReplies: 0,
          updatedAt: now,
          ...(sourceWasClosed
            ? {}
            : computeSlaTransition(lockedSource, false, now, "closing")),
        })
        .where(eq(tickets.id, source.id));

      // 8. The target's thread was rewritten — recompute "awaiting reply".
      // First response: the target's own; else the source's, but only if it
      // came after the target existed — an earlier one would put the first
      // response before the ticket's creation (negative report averages).
      await recomputeAwaitingReply(tx, lockedTarget, now);
      const sourceResponse = lockedSource.firstRespondedAt;
      const firstRespondedAt =
        lockedTarget.firstRespondedAt ??
        (sourceResponse && sourceResponse >= lockedTarget.createdAt
          ? sourceResponse
          : null);
      await tx
        .update(tickets)
        .set({ firstRespondedAt, updatedAt: now })
        .where(eq(tickets.id, target.id));

      // 9. Paper trail: an internal note on the target (keeps the source's
      // subject, which otherwise only lives on the closed source) and an
      // activity row on each side.
      await tx.insert(ticketComments).values({
        id: createId(),
        ticketId: target.id,
        authorId: actor.id,
        authorName: actor.name,
        authorRole: actor.role,
        content: textToRichTextJson(
          `Ticket #${source.ticketNumber} ("${source.subject}") was merged into this ticket. Its messages and attachments now appear here.`
        ),
        isInternal: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(ticketActivity).values([
        {
          id: createId(),
          ticketId: source.id,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: "merged_into",
          metadata: { ticketNumber: target.ticketNumber },
          createdAt: now,
        },
        {
          id: createId(),
          ticketId: target.id,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: "merged_from",
          metadata: { ticketNumber: source.ticketNumber },
          createdAt: now,
        },
      ]);
    });
  }

  // Side effects, best effort — the merge itself is committed. Refresh anyone
  // viewing either ticket or the list (no-op without Pusher Channels).
  await Promise.all([
    publishTicketCommentCreated(source.id),
    publishTicketCommentCreated(target.id),
    publishTicketCreated(),
  ]).catch((err) => console.error("[realtime.ticket_merged]", err));

  // Irreversible, so it also goes in the admin audit log.
  await audit({
    action: "ticket.merged",
    actorEmail: actor.email,
    actorId: actor.id,
    description: `Merged ticket #${source.ticketNumber} into #${target.ticketNumber}`,
    entityId: target.id,
    entityType: "ticket",
    metadata: {
      sourceTicketId: source.id,
      sourceTicketNumber: source.ticketNumber,
      targetTicketNumber: target.ticketNumber,
    },
  }).catch((err) => console.error("[audit.ticket_merged]", err));

  // Only ticket.merged — not also ticket.closed for the source, since
  // integrators commonly email the customer on ticket.closed and a merge is
  // deliberately silent.
  await dispatchWebhookEvent("ticket.merged", "ticket", target.id, {
    ticket: ticketPayloadData({ ...target, updatedAt: now }),
    mergedTicket: ticketPayloadData({
      ...source,
      status: sourceStatus,
      updatedAt: now,
    }),
  }).catch((err) => console.error("[webhook.ticket_merged]", err));

  return { ok: true, targetTicketNumber: target.ticketNumber };
}
