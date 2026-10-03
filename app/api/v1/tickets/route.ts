import { createId } from "@paralleldrive/cuid2";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { customers, tickets } from "@/db/schema";
import { requireApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { htmlToRichTextJson, textToRichTextJson } from "@/lib/rich-text";
import { linkTagsToTicket } from "@/lib/tags";
import {
  API_MAX_ATTACHMENTS_PER_TICKET,
  decodeBase64Attachments,
  uploadDecodedAttachments,
} from "@/lib/tickets/api-attachments";
import {
  createTicketFromSubmission,
  validateTicketSubmission,
} from "@/lib/tickets/create-ticket";

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;
const MAX_API_TAGS = 10;
const MAX_TAG_LENGTH = 50;

// GET /api/v1/tickets?email=…&page=1&per_page=50 — public API, API-key
// authenticated. Lists that customer's tickets, newest first. Any active key can
// list any customer: single-tenant, same reasoning as GET /api/v1/tickets/:id.
export async function GET(request: NextRequest) {
  try {
    await requireApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const email = request.nextUrl.searchParams.get("email")?.trim();
  if (!email) {
    return NextResponse.json(
      { error: "Query parameter 'email' is required." },
      { status: 400 }
    );
  }

  const rawPage = request.nextUrl.searchParams.get("page");
  const page = rawPage ? Number.parseInt(rawPage, 10) : 1;
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json(
      { error: "Query parameter 'page' must be a positive integer." },
      { status: 400 }
    );
  }

  const rawPerPage = request.nextUrl.searchParams.get("per_page");
  const perPage = rawPerPage
    ? Number.parseInt(rawPerPage, 10)
    : DEFAULT_PER_PAGE;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
    return NextResponse.json(
      {
        error: `Query parameter 'per_page' must be an integer between 1 and ${MAX_PER_PAGE}.`,
      },
      { status: 400 }
    );
  }

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.email, email.toLowerCase()))
    .limit(1);

  if (!customer) {
    return NextResponse.json({
      tickets: [],
      pagination: { page, perPage, total: 0, totalPages: 0 },
    });
  }

  // Merged tickets are hidden, matching the portal — their ids still resolve
  // via GET /api/v1/tickets/:id, which forwards to the surviving ticket.
  const where = and(
    eq(tickets.customerId, customer.id),
    isNull(tickets.mergedIntoTicketId)
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        status: tickets.status,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .where(where)
      .orderBy(desc(tickets.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(tickets).where(where),
  ]);

  return NextResponse.json({
    tickets: rows,
    pagination: {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    },
  });
}

// POST /api/v1/tickets — public API, authenticated with an API key
// (Authorization: Bearer dk_live_...). See docs/api.md for the full
// reference. JSON only — attachments aren't supported via the API yet.
export async function POST(request: NextRequest) {
  let apiKey: { id: string; name: string };
  try {
    apiKey = await requireApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { allowed } = await checkRateLimit({
    action: "api_ticket_create",
    key: apiKey.id,
    limit: 100,
    windowMinutes: 1,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: {
    name?: string;
    email?: string;
    subject?: string;
    description?: string;
    descriptionFormat?: string;
    category?: string;
    priority?: string;
    attachments?: unknown;
    customFields?: Record<string, unknown>;
    tags?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // "text" (default) or "html", both converted to the app's own Tiptap JSON
  // before validation sees them. HTML is parsed strictly through our schema, so
  // unrecognized tags and attributes are dropped rather than stored.
  const rawDescription = String(body.description ?? "");
  const description =
    body.descriptionFormat === "html"
      ? htmlToRichTextJson(rawDescription)
      : textToRichTextJson(rawDescription);

  // A new ticket has no attachments yet, so the full per-ticket cap applies.
  // Decoded only after the ticket fields validate — files should never be
  // uploaded for a submission that is going to be rejected anyway.
  const decoded = decodeBase64Attachments(
    body.attachments,
    API_MAX_ATTACHMENTS_PER_TICKET
  );
  if (!decoded.ok) {
    return NextResponse.json({ error: decoded.error }, { status: 400 });
  }

  const validated = await validateTicketSubmission({
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    subject: String(body.subject ?? ""),
    description,
    category: String(body.category ?? ""),
    priority: body.priority ? String(body.priority) : undefined,
    customFields: body.customFields,
  });
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error },
      { status: validated.httpStatus }
    );
  }

  const ticketId = createId();
  let uploadedAttachments: Awaited<ReturnType<typeof uploadDecodedAttachments>>;
  try {
    uploadedAttachments = await uploadDecodedAttachments(
      ticketId,
      decoded.attachments
    );
  } catch (err) {
    console.error("[POST /api/v1/tickets] attachment upload", err);
    return NextResponse.json(
      { error: "Failed to store attachments." },
      { status: 500 }
    );
  }

  const result = await createTicketFromSubmission({
    id: ticketId,
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    subject: String(body.subject ?? ""),
    description,
    category: String(body.category ?? ""),
    priority: body.priority ? String(body.priority) : undefined,
    customFields: body.customFields,
    source: "api",
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.name,
    attachments: uploadedAttachments,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.httpStatus }
    );
  }

  // Optional tags let an integrating backend classify a ticket at creation.
  // Normalized, deduped and find-or-created in the shared pool exactly like
  // agent-added tags. Best effort — a failure is logged, never fatal.
  const appliedTags = Array.isArray(body.tags)
    ? body.tags
        .map((t) => String(t))
        .filter((t) => t.trim().length > 0 && t.length <= MAX_TAG_LENGTH)
        .slice(0, MAX_API_TAGS)
    : [];
  if (appliedTags.length > 0) {
    try {
      await linkTagsToTicket(result.id, appliedTags);
    } catch (err) {
      console.error("[POST /api/v1/tickets] tag linking", err);
    }
  }

  return NextResponse.json(
    {
      id: result.id,
      ticketNumber: result.ticketNumber,
      status: result.status,
      portalUrl: result.portalUrl,
    },
    { status: 201 }
  );
}
