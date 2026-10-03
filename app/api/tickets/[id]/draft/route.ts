import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_ROLE, AGENT_ROLE } from "@/config/platform";
import { ticketReplyDrafts, tickets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRichTextEmpty } from "@/lib/rich-text";
import { resolveMergedTicketId } from "@/lib/tickets/merge";
import { deleteReplyDraft } from "@/lib/tickets/reply-drafts";

// Generous ceiling for a Tiptap JSON reply — only here to stop the autosave
// endpoint from being used to park arbitrarily large blobs in the DB.
const MAX_DRAFT_LENGTH = 200_000;

// /api/tickets/* is not covered by the proxy.ts middleware matcher, so we
// check the session directly here (same pattern as
// app/api/tickets/table-columns/route.ts).
async function requireAgentSession(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return null;
  }
  if (session.user.role !== AGENT_ROLE && session.user.role !== ADMIN_ROLE) {
    return null;
  }
  return session;
}

// PUT — upsert the caller's own reply draft for this ticket. An empty draft
// deletes the row instead, so clearing the composer also clears the list's
// "Draft" marker.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAgentSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id: requestedTicketId } = await params;
  // A merged ticket forwards to the ticket it was merged into (lib/tickets/merge.ts).
  const ticketId = await resolveMergedTicketId(requestedTicketId);

  let body: { content?: unknown; isInternal?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (
    typeof body.content !== "string" ||
    typeof body.isInternal !== "boolean" ||
    body.content.length > MAX_DRAFT_LENGTH
  ) {
    return NextResponse.json({ error: "Invalid draft." }, { status: 400 });
  }

  if (isRichTextEmpty(body.content)) {
    await deleteReplyDraft(ticketId, session.user.id);
    return NextResponse.json({ draft: null });
  }

  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const now = new Date();
  await db
    .insert(ticketReplyDrafts)
    .values({
      ticketId,
      userId: session.user.id,
      content: body.content,
      isInternal: body.isInternal,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [ticketReplyDrafts.ticketId, ticketReplyDrafts.userId],
      set: {
        content: body.content,
        isInternal: body.isInternal,
        updatedAt: now,
      },
    });

  return NextResponse.json({ draft: { updatedAt: now.toISOString() } });
}

// DELETE — discard the caller's own draft for this ticket.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAgentSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id: requestedTicketId } = await params;
  // A merged ticket forwards to the ticket it was merged into (lib/tickets/merge.ts).
  const ticketId = await resolveMergedTicketId(requestedTicketId);
  await deleteReplyDraft(ticketId, session.user.id);
  return NextResponse.json({ draft: null });
}
