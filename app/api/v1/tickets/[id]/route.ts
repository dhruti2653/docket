import { and, asc, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { customers, ticketAttachments, tickets } from "@/db/schema";
import { requireApiKey } from "@/lib/api-auth";
import {
  coerceCustomFieldValue,
  getCustomFieldValues,
} from "@/lib/custom-fields";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { richTextToHtml, richTextToPlainText } from "@/lib/rich-text";
import { resolveMergedTicketId } from "@/lib/tickets/merge";

// GET /api/v1/tickets/:id — any active key reads any ticket; single-tenant, so
// there is no cross-tenant isolation to enforce. Returns the opening message
// (the one thing /comments omits), the customer's email/name so a backend can
// bind the ticket to an account, and that message's attachments.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { id: requestedId } = await params;
  // A merged ticket forwards to the ticket it was merged into (lib/tickets/merge.ts).
  const id = await resolveMergedTicketId(requestedId);
  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      description: tickets.description,
      status: tickets.status,
      category: tickets.category,
      priority: tickets.priority,
      customerName: customers.name,
      customerEmail: customers.email,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .where(eq(tickets.id, id))
    .limit(1);

  if (!ticket) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Opening-message attachments have no comment_id (they were attached to the
  // ticket itself at creation, not to any later reply).
  const openingAttachments = await db
    .select({
      id: ticketAttachments.id,
      filename: ticketAttachments.filename,
      fileSize: ticketAttachments.fileSize,
      mimeType: ticketAttachments.mimeType,
    })
    .from(ticketAttachments)
    .where(
      and(
        eq(ticketAttachments.ticketId, id),
        isNull(ticketAttachments.commentId)
      )
    )
    .orderBy(asc(ticketAttachments.createdAt));

  const customFieldValues = await getCustomFieldValues(id);
  const customFields = Object.fromEntries(
    customFieldValues.map((f) => [
      f.key,
      coerceCustomFieldValue(f.type, f.value),
    ])
  );

  return NextResponse.json({
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status,
    category: ticket.category,
    priority: ticket.priority,
    customerName: ticket.customerName,
    customerEmail: ticket.customerEmail,
    description: richTextToPlainText(ticket.description),
    descriptionHtml: richTextToHtml(ticket.description),
    attachments: openingAttachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      url: `${env.NEXT_PUBLIC_APP_URL}/api/v1/tickets/${id}/attachments/${a.id}`,
    })),
    customFields,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  });
}
