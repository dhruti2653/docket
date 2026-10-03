import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, or } from "drizzle-orm";
import { ticketActivity, ticketLinks, tickets } from "@/db/schema";
import { db } from "@/lib/db";
import type { TicketLinkType } from "@/lib/tickets/link-types";

export interface TicketLinkView {
  direction: "outgoing" | "incoming";
  id: string;
  ticket: {
    id: string;
    ticketNumber: number;
    subject: string;
    status: string;
  };
  type: TicketLinkType;
}

const otherTicketColumns = {
  id: tickets.id,
  ticketNumber: tickets.ticketNumber,
  subject: tickets.subject,
  status: tickets.status,
};

/** Every link touching `ticketId`, from either end, oldest first. */
export async function getTicketLinks(
  ticketId: string
): Promise<TicketLinkView[]> {
  const [outgoing, incoming] = await Promise.all([
    db
      .select({
        id: ticketLinks.id,
        type: ticketLinks.type,
        createdAt: ticketLinks.createdAt,
        ticket: otherTicketColumns,
      })
      .from(ticketLinks)
      .innerJoin(tickets, eq(ticketLinks.linkedTicketId, tickets.id))
      .where(eq(ticketLinks.ticketId, ticketId))
      .orderBy(asc(ticketLinks.createdAt)),
    db
      .select({
        id: ticketLinks.id,
        type: ticketLinks.type,
        createdAt: ticketLinks.createdAt,
        ticket: otherTicketColumns,
      })
      .from(ticketLinks)
      .innerJoin(tickets, eq(ticketLinks.ticketId, tickets.id))
      .where(eq(ticketLinks.linkedTicketId, ticketId))
      .orderBy(asc(ticketLinks.createdAt)),
  ]);

  return [
    ...outgoing.map((l) => ({ ...l, direction: "outgoing" as const })),
    ...incoming.map((l) => ({ ...l, direction: "incoming" as const })),
  ]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(({ createdAt: _createdAt, ...l }) => ({
      ...l,
      type: l.type as TicketLinkType,
    }));
}

interface Actor {
  id: string;
  name: string;
  role: string;
}

type LinkResult = { ok: true } | { ok: false; error: string; status: number };

/** Links `ticketId` → the ticket numbered `linkedTicketNumber`. Rejects self
 * links, merged tickets, and a second link of the same type between the same
 * pair in either direction. Writes an activity row on both tickets. */
export async function addTicketLink(
  ticketId: string,
  linkedTicketNumber: number,
  type: TicketLinkType,
  actor: Actor
): Promise<LinkResult> {
  const [source] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      mergedIntoTicketId: tickets.mergedIntoTicketId,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!source) {
    return { ok: false, error: "This ticket no longer exists.", status: 404 };
  }

  const [target] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      mergedIntoTicketId: tickets.mergedIntoTicketId,
    })
    .from(tickets)
    .where(eq(tickets.ticketNumber, linkedTicketNumber))
    .limit(1);
  if (!target) {
    return {
      ok: false,
      error: `Ticket #${linkedTicketNumber} not found.`,
      status: 404,
    };
  }
  if (target.id === source.id) {
    return {
      ok: false,
      error: "A ticket can't be linked to itself.",
      status: 400,
    };
  }
  if (source.mergedIntoTicketId || target.mergedIntoTicketId) {
    return {
      ok: false,
      error:
        "Merged tickets can't be linked — link the ticket they were merged into.",
      status: 400,
    };
  }

  // One link per pair and type, in either direction: the reverse of
  // related_to is the same link, and reverse duplicate_of / blocks would be a
  // contradiction (A blocks B and B blocks A).
  const [existing] = await db
    .select({ id: ticketLinks.id })
    .from(ticketLinks)
    .where(
      and(
        eq(ticketLinks.type, type),
        or(
          and(
            eq(ticketLinks.ticketId, source.id),
            eq(ticketLinks.linkedTicketId, target.id)
          ),
          and(
            eq(ticketLinks.ticketId, target.id),
            eq(ticketLinks.linkedTicketId, source.id)
          )
        )
      )
    )
    .limit(1);
  if (existing) {
    return {
      ok: false,
      error: "These tickets are already linked.",
      status: 409,
    };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(ticketLinks).values({
      id: createId(),
      ticketId: source.id,
      linkedTicketId: target.id,
      type,
      createdById: actor.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(ticketActivity).values([
      linkActivity(source.id, "ticket_linked", actor, now, {
        type,
        direction: "outgoing",
        ticketNumber: target.ticketNumber,
      }),
      linkActivity(target.id, "ticket_linked", actor, now, {
        type,
        direction: "incoming",
        ticketNumber: source.ticketNumber,
      }),
    ]);
  });
  return { ok: true };
}

/** Removes a link, but only one that actually touches `ticketId` — the link id
 * alone isn't trusted to belong to the ticket in the URL. */
export async function removeTicketLink(
  ticketId: string,
  linkId: string,
  actor: Actor
): Promise<LinkResult> {
  const [link] = await db
    .select({
      id: ticketLinks.id,
      ticketId: ticketLinks.ticketId,
      linkedTicketId: ticketLinks.linkedTicketId,
      type: ticketLinks.type,
    })
    .from(ticketLinks)
    .where(
      and(
        eq(ticketLinks.id, linkId),
        or(
          eq(ticketLinks.ticketId, ticketId),
          eq(ticketLinks.linkedTicketId, ticketId)
        )
      )
    )
    .limit(1);
  if (!link) {
    return {
      ok: false,
      error: "This link no longer exists. Refresh the page.",
      status: 404,
    };
  }

  const ends = await db
    .select({ id: tickets.id, ticketNumber: tickets.ticketNumber })
    .from(tickets)
    .where(
      or(eq(tickets.id, link.ticketId), eq(tickets.id, link.linkedTicketId))
    );
  const numberOf = (id: string) =>
    ends.find((t) => t.id === id)?.ticketNumber ?? null;

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(ticketLinks).where(eq(ticketLinks.id, link.id));
    await tx.insert(ticketActivity).values([
      linkActivity(link.ticketId, "ticket_unlinked", actor, now, {
        type: link.type,
        direction: "outgoing",
        ticketNumber: numberOf(link.linkedTicketId),
      }),
      linkActivity(link.linkedTicketId, "ticket_unlinked", actor, now, {
        type: link.type,
        direction: "incoming",
        ticketNumber: numberOf(link.ticketId),
      }),
    ]);
  });
  return { ok: true };
}

function linkActivity(
  ticketId: string,
  action: "ticket_linked" | "ticket_unlinked",
  actor: Actor,
  now: Date,
  metadata: Record<string, unknown>
) {
  return {
    id: createId(),
    ticketId,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    metadata,
    createdAt: now,
  };
}

/** Identity of a link for duplicate checks: type + unordered pair, matching
 * addTicketLink's "one link per pair and type, either direction" rule. */
export function ticketLinkKey(link: {
  ticketId: string;
  linkedTicketId: string;
  type: string;
}): string {
  const [a, b] = [link.ticketId, link.linkedTicketId].sort();
  return `${link.type}:${a}:${b}`;
}
