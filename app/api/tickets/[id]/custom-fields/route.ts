import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ticketActivity, tickets } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  coerceCustomFieldValue,
  getCustomFields,
  getCustomFieldValues,
  setCustomFieldValues,
  validateCustomFieldInput,
} from "@/lib/custom-fields";
import { db } from "@/lib/db";
import { resolveMergedTicketId } from "@/lib/tickets/merge";

async function requireAgentSession(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return null;
  }
  if (session.user.role !== "agent" && session.user.role !== "admin") {
    return null;
  }
  return session;
}

// PATCH /api/tickets/[id]/custom-fields — agent/admin session, body is
// `{ [field.key]: rawValue }`. Partial: only keys present in the body are
// changed, matching PATCH /api/tickets/[id]'s per-property semantics.
export async function PATCH(
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
  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const fields = await getCustomFields();
  const before = await getCustomFieldValues(ticketId);
  const beforeByFieldId = new Map(before.map((v) => [v.fieldId, v]));

  const validated = validateCustomFieldInput(fields, body, { partial: true });
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error },
      { status: validated.httpStatus }
    );
  }

  const changed = validated.values.filter(
    (v) => (beforeByFieldId.get(v.fieldId)?.value ?? null) !== v.value
  );
  if (changed.length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  await setCustomFieldValues(ticketId, changed);

  const actorId = session.user.id;
  const actorName = session.user.name ?? session.user.email;
  const actorRole = session.user.role!;
  const now = new Date();
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  await db.insert(ticketActivity).values(
    changed.map((v) => ({
      id: createId(),
      ticketId,
      actorId,
      actorName,
      actorRole,
      action: "custom_field_changed",
      metadata: {
        field: fieldById.get(v.fieldId)?.label ?? v.fieldId,
        from: beforeByFieldId.get(v.fieldId)?.value ?? null,
        to: v.value,
      },
      createdAt: now,
    }))
  );

  const after = await getCustomFieldValues(ticketId);
  return NextResponse.json({
    ok: true,
    changed: true,
    values: after.map((v) => ({
      key: v.key,
      value: coerceCustomFieldValue(v.type, v.value),
    })),
  });
}
