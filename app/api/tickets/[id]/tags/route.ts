import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ticketActivity, tickets, ticketTags } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrCreateTagId, getTicketTags, normalizeTagName } from "@/lib/tags";
import { resolveMergedTicketId } from "@/lib/tickets/merge";

const MAX_TAG_LENGTH = 50;

// POST /api/tickets/[id]/tags — agent/admin only. Body: { name: string }.
// Find-or-creates the tag in the shared pool, then links it to this ticket
// (idempotent — adding an already-linked tag is a no-op, not an error).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (
    !session?.user ||
    (session.user.role !== "agent" && session.user.role !== "admin")
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: requestedTicketId } = await params;
  // A merged ticket forwards to the ticket it was merged into (lib/tickets/merge.ts).
  const ticketId = await resolveMergedTicketId(requestedTicketId);
  let body: { name?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const name = normalizeTagName(body.name ?? "");
  if (!name) {
    return NextResponse.json(
      { error: "Tag name is required." },
      { status: 400 }
    );
  }
  if (name.length > MAX_TAG_LENGTH) {
    return NextResponse.json(
      { error: `Tag name must be ${MAX_TAG_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const tagId = await getOrCreateTagId(name);

  const [existingLink] = await db
    .select({ id: ticketTags.id })
    .from(ticketTags)
    .where(and(eq(ticketTags.ticketId, ticketId), eq(ticketTags.tagId, tagId)))
    .limit(1);

  if (!existingLink) {
    await db.insert(ticketTags).values({
      id: createId(),
      ticketId,
      tagId,
    });

    await db.insert(ticketActivity).values({
      id: createId(),
      ticketId,
      actorId: session.user.id,
      actorName: session.user.name ?? session.user.email,
      actorRole: session.user.role,
      action: "tag_added",
      metadata: { tag: name },
      createdAt: new Date(),
    });
  }

  const tags = await getTicketTags(ticketId);
  return NextResponse.json(tags);
}
