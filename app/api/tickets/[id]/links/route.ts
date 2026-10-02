import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTicketAgent } from "@/lib/tickets/agent-session";
import { isTicketLinkType } from "@/lib/tickets/link-types";
import { addTicketLink, getTicketLinks } from "@/lib/tickets/links";
import {
  isUniqueViolation,
  parseTicketNumber,
  readJsonObject,
} from "@/lib/tickets/route-input";

// GET /api/tickets/[id]/links — agent/admin only. Every link touching this
// ticket, from either end, with the other ticket's number/subject/status.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getTicketAgent(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  try {
    return NextResponse.json(await getTicketLinks(id));
  } catch (err) {
    console.error("[GET /api/tickets/[id]/links]", err);
    return NextResponse.json(
      { error: "Failed to load linked tickets." },
      { status: 500 }
    );
  }
}

// POST /api/tickets/[id]/links — agent/admin only.
// Body: { ticketNumber: number, type: "related_to" | "duplicate_of" | "blocks" }.
// Returns the ticket's updated link list.
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

  const ticketNumber = parseTicketNumber(body.ticketNumber);
  if (!ticketNumber) {
    return NextResponse.json(
      { error: "Enter a valid ticket number." },
      { status: 400 }
    );
  }
  if (!isTicketLinkType(body.type)) {
    return NextResponse.json({ error: "Invalid link type." }, { status: 400 });
  }

  try {
    const result = await addTicketLink(id, ticketNumber, body.type, agent);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(await getTicketLinks(id), { status: 201 });
  } catch (err) {
    // Two agents adding the same link at once: the loser hits the unique index.
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "These tickets are already linked." },
        { status: 409 }
      );
    }
    console.error("[POST /api/tickets/[id]/links]", err);
    return NextResponse.json(
      { error: "Failed to link tickets." },
      { status: 500 }
    );
  }
}
