import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTicketAgent } from "@/lib/tickets/agent-session";
import { mergeTickets } from "@/lib/tickets/merge";
import { parseTicketNumber, readJsonObject } from "@/lib/tickets/route-input";

// POST /api/tickets/[id]/merge — agent/admin only. Body: { targetTicketNumber }.
// Merges this ticket INTO the target (see lib/tickets/merge.ts). Irreversible.
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

  const targetTicketNumber = parseTicketNumber(body.targetTicketNumber);
  if (!targetTicketNumber) {
    return NextResponse.json(
      { error: "Choose a ticket to merge into." },
      { status: 400 }
    );
  }

  try {
    const result = await mergeTickets(id, targetTicketNumber, agent);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({
      ok: true,
      targetTicketNumber: result.targetTicketNumber,
    });
  } catch (err) {
    console.error("[POST /api/tickets/[id]/merge]", err);
    return NextResponse.json(
      { error: "Failed to merge tickets." },
      { status: 500 }
    );
  }
}
