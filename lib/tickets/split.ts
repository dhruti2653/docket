import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import {
  customers,
  ticketActivity,
  ticketAttachments,
  ticketComments,
  ticketLinks,
  tickets,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { ticketCreatedTemplate } from "@/lib/email/templates/ticket-created";
import { env } from "@/lib/env";
import {
  publishTicketCommentCreated,
  publishTicketCreated,
} from "@/lib/realtime";
import { textToRichTextJson } from "@/lib/rich-text";
import { getDefaultStatus, isClosedStatusSlug } from "@/lib/ticket-config";
import { resolveTicketPortalUrl } from "@/lib/tickets/portal-url";
import {
  CONCURRENT_CHANGE_MESSAGE,
  ConcurrentTicketChangeError,
  recomputeAwaitingReply,
} from "@/lib/tickets/thread-state";
import {
  dispatchWebhookEvent,
  ticketPayloadData,
} from "@/lib/webhooks/dispatch";

interface Actor {
  email?: string;
  id: string;
  name: string;
  role: string;
}

export type SplitResult =
  | { ok: true; newTicketNumber: number }
  | { ok: false; error: string; status: number };

/** Moves one customer reply out of `ticketId` into a brand-new ticket for the
 * same customer: the reply becomes the new ticket's description, its files go
 * with it, and it's removed from the original (an internal note marks the
 * spot). The two are linked related_to, and the customer gets the normal
 * "ticket created" email with the new ticket's own link. */
export async function splitComment(
  ticketId: string,
  commentId: string,
  rawSubject: string,
  actor: Actor
): Promise<SplitResult> {
  const subject = rawSubject.trim();
  if (subject.length < 5 || subject.length > 200) {
    return {
      ok: false,
      error: "Subject must be 5–200 characters.",
      status: 400,
    };
  }

  const [original] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      category: tickets.category,
      priority: tickets.priority,
      customerId: tickets.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      source: tickets.source,
      apiKeyId: tickets.apiKeyId,
      mergedIntoTicketId: tickets.mergedIntoTicketId,
      awaitingReply: tickets.awaitingReply,
      waitingSince: tickets.waitingSince,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!original) {
    return { ok: false, error: "This ticket no longer exists.", status: 404 };
  }
  if (original.mergedIntoTicketId) {
    return {
      ok: false,
      error: "This ticket has been merged and can't be split.",
      status: 400,
    };
  }

  const [comment] = await db
    .select()
    .from(ticketComments)
    .where(
      and(
        eq(ticketComments.id, commentId),
        eq(ticketComments.ticketId, ticketId)
      )
    )
    .limit(1);
  if (!comment) {
    return {
      ok: false,
      error: "This reply no longer exists on this ticket. Refresh the page.",
      status: 404,
    };
  }
  // Only the customer's own public messages make sense as a ticket's opening
  // message — an agent reply or internal note would read as the customer's.
  if (comment.authorRole !== "customer" || comment.isInternal) {
    return {
      ok: false,
      error: "Only customer replies can be split into a new ticket.",
      status: 400,
    };
  }

  const defaultStatus = await getDefaultStatus();
  const status = defaultStatus?.slug ?? "open";
  const newTicketId = createId();
  const customerToken = createId();
  const now = new Date();

  let newTicketNumber: number;
  try {
    newTicketNumber = await runSplit();
  } catch (err) {
    if (err instanceof ConcurrentTicketChangeError) {
      return { ok: false, error: CONCURRENT_CHANGE_MESSAGE, status: 409 };
    }
    throw err;
  }

  // Lock the original and re-check inside the transaction: a merge or another
  // split may have moved this reply since the checks above.
  function runSplit() {
    return db.transaction(async (tx) => {
      const [lockedOriginal] = await tx
        .select({
          mergedIntoTicketId: tickets.mergedIntoTicketId,
          status: tickets.status,
          awaitingReply: tickets.awaitingReply,
          waitingSince: tickets.waitingSince,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .where(eq(tickets.id, original.id))
        .for("no key update");
      const [stillThere] = await tx
        .select({ id: ticketComments.id })
        .from(ticketComments)
        .where(
          and(
            eq(ticketComments.id, comment.id),
            eq(ticketComments.ticketId, original.id)
          )
        );
      if (!lockedOriginal || lockedOriginal.mergedIntoTicketId || !stillThere) {
        throw new ConcurrentTicketChangeError();
      }

      const [inserted] = await tx
        .insert(tickets)
        .values({
          id: newTicketId,
          subject,
          description: comment.content,
          category: original.category,
          priority: original.priority,
          status,
          customerId: original.customerId,
          customerToken,
          // Same source/key as the original, so the customer's link for the new
          // ticket uses the same portal (an API key's portalUrlTemplate).
          source: original.source,
          apiKeyId: original.apiKeyId,
          awaitingReply: true,
          pendingReplies: 1,
          waitingSince: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ ticketNumber: tickets.ticketNumber });

      // The reply's files become the new ticket's opening-message attachments.
      await tx
        .update(ticketAttachments)
        .set({ ticketId: newTicketId, commentId: null })
        .where(eq(ticketAttachments.commentId, comment.id));
      await tx.delete(ticketComments).where(eq(ticketComments.id, comment.id));

      await tx.insert(ticketComments).values({
        id: createId(),
        ticketId: original.id,
        authorId: actor.id,
        authorName: actor.name,
        authorRole: actor.role,
        content: textToRichTextJson(
          `A reply from ${original.customerName} was split into new ticket #${inserted.ticketNumber} ("${subject}").`
        ),
        isInternal: true,
        // Back-dated to the removed reply so the note sits where it was.
        createdAt: comment.createdAt,
        updatedAt: now,
      });
      // A closed ticket isn't waiting on anyone — leave its flags alone (the
      // close already cleared them). Uses the locked row, not the pre-lock read.
      if (!(await isClosedStatusSlug(lockedOriginal.status))) {
        await recomputeAwaitingReply(
          tx,
          { id: original.id, ...lockedOriginal },
          now
        );
      }
      await tx
        .update(tickets)
        .set({ updatedAt: now })
        .where(eq(tickets.id, original.id));

      await tx.insert(ticketLinks).values({
        id: createId(),
        ticketId: newTicketId,
        linkedTicketId: original.id,
        type: "related_to",
        createdById: actor.id,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(ticketActivity).values([
        {
          id: createId(),
          ticketId: original.id,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: "split_to",
          metadata: { ticketNumber: inserted.ticketNumber },
          createdAt: now,
        },
        {
          id: createId(),
          ticketId: newTicketId,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: "split_from",
          metadata: { ticketNumber: original.ticketNumber },
          createdAt: now,
        },
      ]);

      return inserted.ticketNumber;
    });
  }

  // Side effects, best effort — the split itself is committed.
  const ticketUrl = await resolveTicketPortalUrl(
    newTicketId,
    customerToken,
    original.apiKeyId
  );
  ticketCreatedTemplate({
    customerName: original.customerName,
    ticketNumber: newTicketNumber,
    ticketSubject: subject,
    ticketUrl,
    myTicketsUrl: `${env.NEXT_PUBLIC_APP_URL}/my-tickets`,
  })
    .then(({ subject: emailSubject, html, text }) =>
      enqueueEmail({
        to: original.customerEmail,
        subject: emailSubject,
        html,
        text,
        category: "ticket",
      })
    )
    .catch((err) => console.error("[ticket.split email]", err));

  await audit({
    action: "ticket.split",
    actorEmail: actor.email,
    actorId: actor.id,
    description: `Split a reply from ticket #${original.ticketNumber} into new ticket #${newTicketNumber}`,
    entityId: newTicketId,
    entityType: "ticket",
    metadata: {
      originalTicketId: original.id,
      originalTicketNumber: original.ticketNumber,
      newTicketNumber,
    },
  }).catch((err) => console.error("[audit.ticket_split]", err));

  await Promise.all([
    publishTicketCommentCreated(original.id),
    publishTicketCreated(),
  ]).catch((err) => console.error("[realtime.ticket_split]", err));

  const newTicketPayload = ticketPayloadData({
    id: newTicketId,
    ticketNumber: newTicketNumber,
    subject,
    status,
    priority: original.priority,
    category: original.category,
    customerName: original.customerName,
    customerEmail: original.customerEmail,
    createdAt: now,
    updatedAt: now,
  });
  await dispatchWebhookEvent("ticket.created", "ticket", newTicketId, {
    ticket: newTicketPayload,
  }).catch((err) => console.error("[webhook.ticket_created]", err));
  await dispatchWebhookEvent("ticket.split", "ticket", original.id, {
    ticket: ticketPayloadData({ ...original, updatedAt: now }),
    newTicket: newTicketPayload,
  }).catch((err) => console.error("[webhook.ticket_split]", err));

  return { ok: true, newTicketNumber };
}
