import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_ROLE } from "@/config/platform";
import {
  ticketActivity,
  ticketAttachments,
  tickets,
  ticketTags,
  user,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { getOrCreateTagId, normalizeTagName } from "@/lib/tags";
import { getTicketPriorities, getTicketStatuses } from "@/lib/ticket-config";
import { withMergedShells } from "@/lib/tickets/merge";

const MAX_BULK_IDS = 200;
const MAX_TAG_LENGTH = 50;

// /api/tickets/* is not covered by the proxy.ts middleware matcher, so we
// check the session directly here (same pattern as app/api/tickets/[id]/route.ts)
// instead of the header-based requireAdminFromRequest helper.
async function requireAdminSession(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.role !== ADMIN_ROLE) {
    return null;
  }
  return session;
}

// PATCH /api/tickets/bulk — admin only. Bulk-assign, bulk-change-status,
// bulk-change-priority, or bulk-add-tag.
// body: { ids: string[], action: "assign" | "status" | "priority" | "tag", value: string | null }
export async function PATCH(request: NextRequest) {
  const session = await requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const actorId = session.user.id;
  const actorName = session.user.name ?? session.user.email;
  const actorRole = session.user.role!;

  let body: {
    ids?: string[];
    action?: "assign" | "status" | "priority" | "tag";
    value?: string | null;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id) => typeof id === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "No tickets selected." },
      { status: 400 }
    );
  }
  if (ids.length > MAX_BULK_IDS) {
    return NextResponse.json(
      { error: `Cannot update more than ${MAX_BULK_IDS} tickets at once.` },
      { status: 400 }
    );
  }

  const now = new Date();

  if (body.action === "assign") {
    const agentId = body.value ?? null;
    if (agentId) {
      const [agent] = await db
        .select({ id: user.id, role: user.role })
        .from(user)
        .where(eq(user.id, agentId))
        .limit(1);
      if (!agent || (agent.role !== "agent" && agent.role !== "admin")) {
        return NextResponse.json({ error: "Invalid agent." }, { status: 400 });
      }
    }

    await db
      .update(tickets)
      .set({ assignedAgentId: agentId, updatedAt: now })
      .where(inArray(tickets.id, ids));

    await db.insert(ticketActivity).values(
      ids.map((ticketId) => ({
        id: createId(),
        ticketId,
        actorId,
        actorName,
        actorRole,
        action: agentId ? "assigned" : "unassigned",
        metadata: agentId ? { agentId } : null,
        createdAt: now,
      }))
    );

    await audit({
      action: "ticket.bulk_update",
      actorId,
      actorEmail: session.user.email,
      description: `Bulk-assigned ${ids.length} ticket(s)${agentId ? "" : " (unassigned)"}`,
      entityType: "ticket",
      metadata: { ticketIds: ids, action: "assign", value: agentId },
    });

    return NextResponse.json({ ok: true, count: ids.length });
  }

  if (body.action === "status") {
    const validStatuses = await getTicketStatuses();
    const statusRow = validStatuses.find((s) => s.slug === body.value);
    if (!statusRow) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    await db
      .update(tickets)
      .set({
        status: statusRow.slug,
        closedAt: statusRow.isClosedState ? now : null,
        updatedAt: now,
      })
      .where(inArray(tickets.id, ids));

    await db.insert(ticketActivity).values(
      ids.map((ticketId) => ({
        id: createId(),
        ticketId,
        actorId,
        actorName,
        actorRole,
        action: statusRow.isClosedState ? "ticket_closed" : "status_changed",
        metadata: { to: statusRow.slug },
        createdAt: now,
      }))
    );

    await audit({
      action: "ticket.bulk_update",
      actorId,
      actorEmail: session.user.email,
      description: `Bulk-changed status to "${statusRow.label}" for ${ids.length} ticket(s)`,
      entityType: "ticket",
      metadata: { ticketIds: ids, action: "status", value: statusRow.slug },
    });

    return NextResponse.json({ ok: true, count: ids.length });
  }

  if (body.action === "priority") {
    const validPriorities = await getTicketPriorities();
    const priorityRow = validPriorities.find((p) => p.slug === body.value);
    if (!priorityRow) {
      return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
    }

    await db
      .update(tickets)
      .set({ priority: priorityRow.slug, updatedAt: now })
      .where(inArray(tickets.id, ids));

    await db.insert(ticketActivity).values(
      ids.map((ticketId) => ({
        id: createId(),
        ticketId,
        actorId,
        actorName,
        actorRole,
        action: "priority_changed",
        metadata: { to: priorityRow.slug },
        createdAt: now,
      }))
    );

    await audit({
      action: "ticket.bulk_update",
      actorId,
      actorEmail: session.user.email,
      description: `Bulk-changed priority to "${priorityRow.label}" for ${ids.length} ticket(s)`,
      entityType: "ticket",
      metadata: { ticketIds: ids, action: "priority", value: priorityRow.slug },
    });

    return NextResponse.json({ ok: true, count: ids.length });
  }

  if (body.action === "tag") {
    const name = normalizeTagName(body.value ?? "");
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

    const tagId = await getOrCreateTagId(name);

    // Skip tickets that already have this tag — avoids a unique-constraint
    // violation on (ticketId, tagId) and keeps re-applying a tag a no-op.
    const existingLinks = await db
      .select({ ticketId: ticketTags.ticketId })
      .from(ticketTags)
      .where(
        and(inArray(ticketTags.ticketId, ids), eq(ticketTags.tagId, tagId))
      );
    const alreadyTagged = new Set(existingLinks.map((r) => r.ticketId));
    const newTicketIds = ids.filter((id) => !alreadyTagged.has(id));

    if (newTicketIds.length > 0) {
      await db
        .insert(ticketTags)
        .values(
          newTicketIds.map((ticketId) => ({ id: createId(), ticketId, tagId }))
        );

      await db.insert(ticketActivity).values(
        newTicketIds.map((ticketId) => ({
          id: createId(),
          ticketId,
          actorId,
          actorName,
          actorRole,
          action: "tag_added",
          metadata: { tag: name },
          createdAt: now,
        }))
      );
    }

    await audit({
      action: "ticket.bulk_update",
      actorId,
      actorEmail: session.user.email,
      description: `Bulk-tagged ${newTicketIds.length} ticket(s) with "${name}"`,
      entityType: "ticket",
      metadata: { ticketIds: ids, action: "tag", value: name },
    });

    return NextResponse.json({ ok: true, count: newTicketIds.length });
  }

  return NextResponse.json({ error: "Invalid action." }, { status: 400 });
}

// DELETE /api/tickets/bulk — admin only. Storage cleanup + hard delete.
// body: { ids: string[] }
export async function DELETE(request: NextRequest) {
  const session = await requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { ids?: string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id) => typeof id === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "No tickets selected." },
      { status: 400 }
    );
  }
  if (ids.length > MAX_BULK_IDS) {
    return NextResponse.json(
      { error: `Cannot delete more than ${MAX_BULK_IDS} tickets at once.` },
      { status: 400 }
    );
  }

  // Tickets merged into a selected one go with it (see withMergedShells).
  const deleteIds = await withMergedShells(ids);

  // Delete storage files before DB records
  const attachments = await db
    .select({ storageKey: ticketAttachments.storageKey })
    .from(ticketAttachments)
    .where(inArray(ticketAttachments.ticketId, deleteIds));

  for (const att of attachments) {
    try {
      await storage.delete(att.storageKey);
    } catch {
      // Non-fatal — proceed even if storage delete fails
    }
  }

  // Delete tickets (cascade removes comments, activity, attachments)
  await db.delete(tickets).where(inArray(tickets.id, deleteIds));

  await audit({
    action: "ticket.bulk_delete",
    actorId: session.user.id,
    actorEmail: session.user.email,
    description: `Bulk-deleted ${ids.length} ticket(s)`,
    entityType: "ticket",
    metadata: { ticketIds: ids, count: ids.length },
  });

  return NextResponse.json({ ok: true, count: ids.length });
}
