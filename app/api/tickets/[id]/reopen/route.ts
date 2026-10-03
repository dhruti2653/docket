import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { customers, ticketActivity, tickets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { computeSlaTransition } from "@/lib/sla";
import { getDefaultStatus, isClosedStatusSlug } from "@/lib/ticket-config";
import { forwardMergedTicket } from "@/lib/tickets/merge";
import { notifyTicketStatusChange } from "@/lib/tickets/notify-status-change";

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
      action: "ticket_reopen",
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

  if (!(await isClosedStatusSlug(ticket.status))) {
    return NextResponse.json(
      { error: "Ticket is not closed." },
      { status: 400 }
    );
  }

  const defaultStatus = await getDefaultStatus();
  if (!defaultStatus) {
    return NextResponse.json(
      { error: "No default status is configured." },
      { status: 400 }
    );
  }

  const previousStatus = ticket.status;

  // A customer reopening needs the team's attention again; an agent reopening
  // is already handling it.
  const reopenedByCustomer = actorRole === "customer";

  // Resuming from "resolved" always restarts the SLA clock at `now` — there's
  // no in-progress span to flush since it was already stopped at close (see
  // lib/sla.ts's "reopening" mode).
  const slaUpdate = computeSlaTransition(
    { awaitingReply: ticket.awaitingReply, waitingSince: ticket.waitingSince },
    reopenedByCustomer,
    now,
    "reopening"
  );

  await db
    .update(tickets)
    .set({
      status: defaultStatus.slug,
      closedAt: null,
      updatedAt: now,
      awaitingReply: reopenedByCustomer,
      pendingReplies: reopenedByCustomer ? 1 : 0,
      ...slaUpdate,
    })
    .where(eq(tickets.id, ticketId));

  await db.insert(ticketActivity).values({
    id: createId(),
    ticketId,
    actorId: actorId ?? null,
    actorName,
    actorRole,
    action: "ticket_reopened",
    metadata: { from: previousStatus, to: defaultStatus.slug },
    createdAt: now,
  });

  // Notify any configured outbound webhooks.
  await notifyTicketStatusChange(
    {
      id: ticketId,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      status: defaultStatus.slug,
      priority: ticket.priority,
      category: ticket.category,
      customerName: customer.name,
      customerEmail: customer.email,
      createdAt: ticket.createdAt,
      updatedAt: now,
    },
    true,
    false
  ).catch((err) => console.error("[webhook.ticket_reopened]", err));

  return NextResponse.json({ status: defaultStatus.slug });
}
