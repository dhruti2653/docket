import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTicketAgent } from "@/lib/tickets/agent-session";
import { removeTicketLink } from "@/lib/tickets/links";

// DELETE /api/tickets/[id]/links/[linkId] — agent/admin only. Works from
// either end of the link.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const agent = await getTicketAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id, linkId } = await params;
  try {
    const result = await removeTicketLink(id, linkId, agent);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/tickets/[id]/links/[linkId]]", err);
    return NextResponse.json(
      { error: "Failed to remove link." },
      { status: 500 }
    );
  }
}
