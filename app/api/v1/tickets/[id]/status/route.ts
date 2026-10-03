import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { customers, ticketActivity, tickets } from "@/db/schema";
import { requireApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { ticketClosedTemplate } from "@/lib/email/templates/ticket-closed";
import { checkRateLimit } from "@/lib/rate-limit";
import { computeSlaTransition } from "@/lib/sla";
import {
  getClosedStatus,
  getDefaultStatus,
  isClosedStatusSlug,
} from "@/lib/ticket-config";
import { resolveMergedTicketId } from "@/lib/tickets/merge";
import { notifyTicketStatusChange } from "@/lib/tickets/notify-status-change";
import { resolveTicketPortalUrl } from "@/lib/tickets/portal-url";

// PATCH /api/v1/tickets/:id/status — lets the ticket owner close or reopen
// (`action`), bound to their email exactly as the reply endpoint is. Mirrors the
// customer branch of the portal's close/reopen routes, same awaiting-reply
// bookkeeping and close email, but authenticated by API key + email.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let apiKey: { id: string; name: string };
  try {
    apiKey = await requireApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { id: requestedTicketId } = await params;
  // A merged ticket forwards to the ticket it was merged into (lib/tickets/merge.ts).
  const ticketId = await resolveMergedTicketId(requestedTicketId);

  const { allowed } = await checkRateLimit({
    action: "api_ticket_status",
    key: apiKey.id,
    limit: 60,
    windowMinutes: 1,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: { email?: string; action?: string };
  try {
    body = (await request.json()) as { email?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const action = String(body.action ?? "").trim();
  if (!email) {
    return NextResponse.json(
      { error: "Field 'email' is required." },
      { status: 400 }
    );
  }
  if (action !== "close" && action !== "reopen") {
    return NextResponse.json(
      { error: "Field 'action' must be 'close' or 'reopen'." },
      { status: 400 }
    );
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
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
  if (customer.email.trim().toLowerCase() !== email) {
    return NextResponse.json(
      { error: "This ticket does not belong to that email." },
      { status: 403 }
    );
  }

  const now = new Date();
  const alreadyClosed = await isClosedStatusSlug(ticket.status);

  if (action === "close") {
    if (alreadyClosed) {
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
    const slaUpdate = computeSlaTransition(
      {
        awaitingReply: ticket.awaitingReply,
        waitingSince: ticket.waitingSince,
      },
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
      actorId: null,
      actorName: customer.name,
      actorRole: "customer",
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

  // action === "reopen"
  if (!alreadyClosed) {
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
  // A customer reopening needs the team's attention again.
  const slaUpdate = computeSlaTransition(
    { awaitingReply: ticket.awaitingReply, waitingSince: ticket.waitingSince },
    true,
    now,
    "reopening"
  );
  await db
    .update(tickets)
    .set({
      status: defaultStatus.slug,
      closedAt: null,
      updatedAt: now,
      awaitingReply: true,
      pendingReplies: 1,
      ...slaUpdate,
    })
    .where(eq(tickets.id, ticketId));

  await db.insert(ticketActivity).values({
    id: createId(),
    ticketId,
    actorId: null,
    actorName: customer.name,
    actorRole: "customer",
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
