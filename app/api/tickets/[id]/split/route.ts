import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTicketAgent } from "@/lib/tickets/agent-session";
import { readJsonObject } from "@/lib/tickets/route-input";
import { splitComment } from "@/lib/tickets/split";

// POST /api/tickets/[id]/split — agent/admin only. Body: { commentId, subject }.
// Moves one customer reply into a new ticket (see lib/tickets/split.ts).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await getTicketAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }
  if (typeof body.commentId !== "string" || typeof body.subject !== "string") {
    return NextResponse.json(
      { error: "Choose a reply and enter a subject for the new ticket." },
      { status: 400 }
    );
  }

  try {
    const result = await splitComment(id, body.commentId, body.subject, agent);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(
      { ok: true, newTicketNumber: result.newTicketNumber },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/tickets/[id]/split]", err);
    return NextResponse.json(
      { error: "Failed to split ticket." },
      { status: 500 }
    );
  }
}
