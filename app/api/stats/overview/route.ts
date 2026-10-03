import { count, inArray, isNull, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { tickets } from "@/db/schema";
import { db } from "@/lib/db";
import { getTicketStatuses } from "@/lib/ticket-config";

// GET — agent/admin can read (middleware already enforced access)
export async function GET(_request: NextRequest) {
  const statuses = await getTicketStatuses();
  const closedSlugs = new Set(
    statuses.filter((s) => s.isClosedState).map((s) => s.slug)
  );
  const defaultSlug = statuses.find((s) => s.isDefault)?.slug;
  const nonClosedSlugs = statuses
    .filter((s) => !s.isClosedState)
    .map((s) => s.slug);

  const statusCounts = await db
    .select({ status: tickets.status, c: count() })
    .from(tickets)
    // Merged tickets are hidden from the ticket list these counts link to.
    .where(isNull(tickets.mergedIntoTicketId))
    .groupBy(tickets.status);

  let open = 0;
  let inProgress = 0;
  let closed = 0;
  let total = 0;
  for (const row of statusCounts) {
    const c = Number(row.c);
    total += c;
    if (closedSlugs.has(row.status)) {
      closed += c;
    } else if (row.status === defaultSlug) {
      open += c;
    } else {
      inProgress += c;
    }
  }

  const [waitRow] = nonClosedSlugs.length
    ? await db
        .select({
          avgWaitSeconds: sql<
            number | null
          >`EXTRACT(EPOCH FROM AVG(NOW() - ${tickets.createdAt}))`,
        })
        .from(tickets)
        .where(inArray(tickets.status, nonClosedSlugs))
    : [{ avgWaitSeconds: null }];

  return NextResponse.json({
    total,
    open,
    inProgress,
    closed,
    avgWaitMs:
      waitRow.avgWaitSeconds == null
        ? null
        : Number(waitRow.avgWaitSeconds) * 1000,
  });
}
