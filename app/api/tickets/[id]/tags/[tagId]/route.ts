import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { tags, ticketActivity, ticketTags } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveMergedTicketId } from "@/lib/tickets/merge";

// DELETE /api/tickets/[id]/tags/[tagId] — agent/admin only. Unlinks the tag
// from this ticket; the tag itself stays in the shared pool for reuse.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (
    !session?.user ||
    (session.user.role !== "agent" && session.user.role !== "admin")
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: requestedTicketId, tagId } = await params;
  // A merged ticket forwards to the ticket it was merged into (lib/tickets/merge.ts).
  const ticketId = await resolveMergedTicketId(requestedTicketId);

  const [link] = await db
    .select({ id: ticketTags.id, name: tags.name })
    .from(ticketTags)
    .innerJoin(tags, eq(ticketTags.tagId, tags.id))
    .where(and(eq(ticketTags.ticketId, ticketId), eq(ticketTags.tagId, tagId)))
    .limit(1);
  if (!link) {
    return NextResponse.json(
      { error: "Tag not found on ticket." },
      { status: 404 }
    );
  }

  await db.delete(ticketTags).where(eq(ticketTags.id, link.id));

  await db.insert(ticketActivity).values({
    id: createId(),
    ticketId,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email,
    actorRole: session.user.role,
    action: "tag_removed",
    metadata: { tag: link.name },
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true });
}
