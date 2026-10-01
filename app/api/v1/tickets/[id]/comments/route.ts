import { createId } from "@paralleldrive/cuid2";
import { and, asc, count, eq, or, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_ROLE, AGENT_ROLE } from "@/config/platform";
import {
  customers,
  ticketActivity,
  ticketAttachments,
  ticketComments,
  tickets,
  user,
} from "@/db/schema";
import { requireApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createNotifications } from "@/lib/notifications";
import { publishPushToUsers } from "@/lib/push";
import { checkRateLimit } from "@/lib/rate-limit";
import { publishTicketCommentCreated } from "@/lib/realtime";
import {
  htmlToRichTextJson,
  isRichTextEmpty,
  richTextToHtml,
  richTextToPlainText,
  textToRichTextJson,
} from "@/lib/rich-text";
import { computeSlaTransition } from "@/lib/sla";
import { storage } from "@/lib/storage";
import { isClosedStatusSlug } from "@/lib/ticket-config";
import {
  API_MAX_ATTACHMENTS_PER_TICKET,
  decodeBase64Attachments,
  uploadDecodedAttachments,
} from "@/lib/tickets/api-attachments";
import {
  dispatchWebhookEvent,
  ticketPayloadData,
} from "@/lib/webhooks/dispatch";

// GET /api/v1/tickets/:id/comments — public API, API-key authenticated.
// Read-only thread of public replies; internal notes are never returned, the
// same rule the customer portal enforces. Each comment carries its attachments.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;

  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, id))
    .limit(1);
  if (!ticket) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const rows = await db
    .select({
      id: ticketComments.id,
      authorName: ticketComments.authorName,
      authorRole: ticketComments.authorRole,
      content: ticketComments.content,
      createdAt: ticketComments.createdAt,
    })
    .from(ticketComments)
    .where(
      and(eq(ticketComments.ticketId, id), eq(ticketComments.isInternal, false))
    )
    .orderBy(asc(ticketComments.createdAt));

  // All attachments for this ticket that belong to a reply (comment_id set),
  // grouped by comment so each comment can carry its own files. Opening-message
  // attachments (comment_id IS NULL) are returned by GET /tickets/:id instead.
  const attachmentRows = await db
    .select({
      id: ticketAttachments.id,
      commentId: ticketAttachments.commentId,
      filename: ticketAttachments.filename,
      fileSize: ticketAttachments.fileSize,
      mimeType: ticketAttachments.mimeType,
    })
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, id));

  const attachmentsByComment = new Map<
    string,
    Array<{
      id: string;
      filename: string;
      fileSize: number;
      mimeType: string;
      url: string;
    }>
  >();
  for (const a of attachmentRows) {
    if (!a.commentId) {
      continue;
    }
    const list = attachmentsByComment.get(a.commentId) ?? [];
    list.push({
      id: a.id,
      filename: a.filename,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      url: `${env.NEXT_PUBLIC_APP_URL}/api/v1/tickets/${id}/attachments/${a.id}`,
    });
    attachmentsByComment.set(a.commentId, list);
  }

  return NextResponse.json({
    comments: rows.map((c) => ({
      id: c.id,
      authorName: c.authorName,
      authorRole: c.authorRole,
      content: richTextToPlainText(c.content),
      html: richTextToHtml(c.content),
      attachments: attachmentsByComment.get(c.id) ?? [],
      createdAt: c.createdAt,
    })),
  });
}

// POST /api/v1/tickets/:id/comments — posts a CUSTOMER reply. The key is
// trusted but the reply stays bound to one customer: `email` must match the
// ticket's customerEmail. Mirrors the customer branch of the portal's reply
// route, but keyed on API key + email rather than the per-ticket customerToken.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let apiKey: { id: string; name: string };
  try {
    apiKey = await requireApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { id: ticketId } = await params;

  const { allowed } = await checkRateLimit({
    action: "api_ticket_reply",
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

  let body: {
    email?: string;
    content?: string;
    contentFormat?: string;
    attachments?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "Field 'email' is required." },
      { status: 400 }
    );
  }

  // Accept HTML (the DTM editor's output) or plain text; store the same Tiptap
  // JSON document the app's own editor produces.
  const rawContent = String(body.content ?? "");
  const content =
    body.contentFormat === "text"
      ? textToRichTextJson(rawContent)
      : htmlToRichTextJson(rawContent);
  if (isRichTextEmpty(content)) {
    return NextResponse.json(
      { error: "Content is required." },
      { status: 400 }
    );
  }
  const contentText = richTextToPlainText(content);

  const [ticket] = await db
    .select({
      status: tickets.status,
      customerName: customers.name,
      customerEmail: customers.email,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      category: tickets.category,
      priority: tickets.priority,
      assignedAgentId: tickets.assignedAgentId,
      awaitingReply: tickets.awaitingReply,
      waitingSince: tickets.waitingSince,
    })
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (ticket.customerEmail.trim().toLowerCase() !== email) {
    return NextResponse.json(
      { error: "This ticket does not belong to that email." },
      { status: 403 }
    );
  }
  if (await isClosedStatusSlug(ticket.status)) {
    return NextResponse.json(
      { error: "Cannot reply to a closed ticket." },
      { status: 400 }
    );
  }

  // How many more files this ticket may still hold.
  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, ticketId));
  const remaining = API_MAX_ATTACHMENTS_PER_TICKET - existingCount;

  const decoded = decodeBase64Attachments(body.attachments, remaining);
  if (!decoded.ok) {
    return NextResponse.json({ error: decoded.error }, { status: 400 });
  }

  const commentId = createId();
  const now = new Date();

  let uploaded: Awaited<ReturnType<typeof uploadDecodedAttachments>>;
  try {
    uploaded = await uploadDecodedAttachments(ticketId, decoded.attachments);
  } catch (err) {
    console.error("[POST /api/v1 reply] attachment upload", err);
    return NextResponse.json(
      { error: "Failed to store attachments." },
      { status: 500 }
    );
  }

  try {
    await db.insert(ticketComments).values({
      id: commentId,
      ticketId,
      authorId: null,
      authorName: ticket.customerName,
      authorRole: "customer",
      content,
      isInternal: false,
      createdAt: now,
      updatedAt: now,
    });

    if (uploaded.length > 0) {
      await db.insert(ticketAttachments).values(
        uploaded.map((a) => ({
          id: a.id,
          ticketId,
          commentId,
          filename: a.filename,
          storageKey: a.storageKey,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          uploadedById: null,
          uploadedByName: ticket.customerName,
          uploadedByRole: "customer",
          createdAt: now,
        }))
      );
    }

    // A customer reply puts the ticket back into "awaiting reply". SLA
    // pause/resume (lib/sla.ts) rides the same signal.
    const slaUpdate = computeSlaTransition(
      {
        awaitingReply: ticket.awaitingReply,
        waitingSince: ticket.waitingSince,
      },
      true,
      now
    );
    await db
      .update(tickets)
      .set({
        updatedAt: now,
        awaitingReply: true,
        pendingReplies: sql`${tickets.pendingReplies} + 1`,
        ...slaUpdate,
      })
      .where(eq(tickets.id, ticketId));

    await db.insert(ticketActivity).values({
      id: createId(),
      ticketId,
      actorId: null,
      actorName: ticket.customerName,
      actorRole: "customer",
      action: "comment_added",
      createdAt: now,
    });

    // Live-refresh anyone currently viewing this ticket (no-op unless Pusher
    // Channels is configured).
    await publishTicketCommentCreated(ticketId).catch((err) =>
      console.error("[realtime.comment_created]", err)
    );

    // Notify any configured outbound webhooks — this route only ever posts
    // public customer replies (no internal-note concept here).
    await dispatchWebhookEvent("ticket.replied", "ticket", ticketId, {
      ticket: ticketPayloadData({
        id: ticketId,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        createdAt: now,
        updatedAt: now,
      }),
      comment: {
        authorName: ticket.customerName,
        authorRole: "customer",
        content: contentText,
        createdAt: now.toISOString(),
      },
    }).catch((err) => console.error("[webhook.ticket_replied]", err));

    // Notify agents in-app + push: assigned agent if any, else every active
    // agent/admin — same routing the portal uses for a customer reply.
    let recipientIds: string[] = [];
    if (ticket.assignedAgentId) {
      const [agent] = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, ticket.assignedAgentId), eq(user.banned, false)))
        .limit(1);
      if (agent) {
        recipientIds = [agent.id];
      }
    } else {
      const agents = await db
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            or(eq(user.role, AGENT_ROLE), eq(user.role, ADMIN_ROLE)),
            eq(user.banned, false)
          )
        );
      recipientIds = agents.map((a) => a.id);
    }

    const notifTitle = `${ticket.customerName} replied to #${ticket.ticketNumber}`;
    await createNotifications(recipientIds, {
      type: "customer_replied",
      title: notifTitle,
      body: contentText.slice(0, 200),
      ticketId,
      ticketNumber: ticket.ticketNumber,
    }).catch((err) => console.error("[notification.customer_replied]", err));

    await publishPushToUsers(recipientIds, {
      title: notifTitle,
      body: contentText.slice(0, 120),
      deepLink: `${env.NEXT_PUBLIC_APP_URL}/tickets/${ticket.ticketNumber}`,
      tag: `ticket-${ticket.ticketNumber}`,
    }).catch((err) => console.error("[push.customer_replied]", err));

    return NextResponse.json({ id: commentId }, { status: 201 });
  } catch (err) {
    // Roll the DB rows + storage files back (either may be partially written).
    await db
      .delete(ticketAttachments)
      .where(eq(ticketAttachments.commentId, commentId))
      .catch(() => undefined);
    for (const a of uploaded) {
      await storage.delete(a.storageKey).catch(() => undefined);
    }
    console.error("[POST /api/v1/tickets/:id/comments]", err);
    return NextResponse.json(
      { error: "Failed to add reply." },
      { status: 500 }
    );
  }
}
