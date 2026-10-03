import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { customers, ticketActivity, tickets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { ticketClosedTemplate } from "@/lib/email/templates/ticket-closed";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { computeSlaTransition } from "@/lib/sla";
import { getClosedStatus, isClosedStatusSlug } from "@/lib/ticket-config";
import { forwardMergedTicket } from "@/lib/tickets/merge";
import { notifyTicketStatusChange } from "@/lib/tickets/notify-status-change";
import { resolveTicketPortalUrl } from "@/lib/tickets/portal-url";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requestedTicketId } = await params;

  let body: { token?: string } = {};
  try {
    // `?? {}`: a literal `null` body would otherwise crash on body.token.
    body = ((await request.json()) as { token?: string } | null) ?? {};
  } catch {
    // no body is fine
  }

  // A merged ticket forwards to the ticket it was merged into (lib/tickets/merge.ts).
  const forwarded = await forwardMergedTicket(requestedTicketId, body.token);
  const ticketId = forwarded.ticketId;
  body.token = forwarded.token;

  const now = new Date();

  // Determine actor
  let actorName: string | undefined;
  let actorRole: string;
  let actorId: string | undefined;

  const session = await auth.api.getSession({ headers: request.headers });

  let ticket;
  if (
    session?.user &&
    (session.user.role === "agent" || session.user.role === "admin")
  ) {
    [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .limit(1);
    actorId = session.user.id;
    actorName = session.user.name ?? session.user.email;
    actorRole = session.user.role;
  } else if (body.token) {
    const { allowed } = await checkRateLimit({
      action: "ticket_close",
      key: getClientIp(request),
      limit: 20,
      windowMinutes: 10,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    [ticket] = await db
      .select()
      .from(tickets)
      .where(
        and(eq(tickets.id, ticketId), eq(tickets.customerToken, body.token))
      )
      .limit(1);
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }
    actorRole = "customer";
  } else {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const [customer] = await db
    .select({ name: customers.name, email: customers.email })
    .from(customers)
    .where(eq(customers.id, ticket.customerId))
    .limit(1);
  if (!customer) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (!actorName) {
    actorName = customer.name;
  }

  if (await isClosedStatusSlug(ticket.status)) {
    return NextResponse.json(
      { error: "Ticket is already closed." },
      { status: 400 }
    );
  }

  const closedStatus = await getClosedStatus();
  if (!closedStatus) {
    return NextResponse.json(
      { error: "No closed status is configured." },
      { status: 400 }
    );
  }

  const previousStatus = ticket.status;

  // Closing resolves the ticket — it's no longer awaiting a reply, and the
  // SLA resolution clock stops (flushing any in-progress active span first).
  const slaUpdate = computeSlaTransition(
    { awaitingReply: ticket.awaitingReply, waitingSince: ticket.waitingSince },
    false,
    now,
    "closing"
  );

  await db
    .update(tickets)
    .set({
      status: closedStatus.slug,
      closedAt: now,
      updatedAt: now,
      awaitingReply: false,
      pendingReplies: 0,
      ...slaUpdate,
    })
    .where(eq(tickets.id, ticketId));

  await db.insert(ticketActivity).values({
    id: createId(),
    ticketId,
    actorId: actorId ?? null,
    actorName,
    actorRole,
    action: "ticket_closed",
    metadata: { from: previousStatus, to: closedStatus.slug },
    createdAt: now,
  });

  // Notify any configured outbound webhooks.
  await notifyTicketStatusChange(
    {
      id: ticketId,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      status: closedStatus.slug,
      priority: ticket.priority,
      category: ticket.category,
      customerName: customer.name,
      customerEmail: customer.email,
      createdAt: ticket.createdAt,
      updatedAt: now,
    },
    false,
    true
  ).catch((err) => console.error("[webhook.ticket_closed]", err));

  // Notify customer on close
  const ticketUrl = await resolveTicketPortalUrl(
    ticketId,
    ticket.customerToken,
    ticket.apiKeyId
  );
  ticketClosedTemplate({
    customerName: customer.name,
    ticketNumber: ticket.ticketNumber,
    ticketSubject: ticket.subject,
    ticketUrl,
  })
    .then(({ subject: emailSubject, html, text }) =>
      enqueueEmail({
        to: customer.email,
        subject: emailSubject,
        html,
        text,
        category: "ticket",
      })
    )
    .catch((err) => console.error("[ticket.closed email]", err));

  return NextResponse.json({ status: closedStatus.slug });
}
