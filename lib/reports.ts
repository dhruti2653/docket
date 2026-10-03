import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { user } from "@/db/schema/auth";
import { tags, ticketTags } from "@/db/schema/tags";
import { tickets } from "@/db/schema/tickets";
import { db } from "@/lib/db";
import { getTicketCategories, getTicketPriorities } from "@/lib/ticket-config";

export type ReportRange = "30d" | "90d" | "all";

const RANGE_DAYS: Record<Exclude<ReportRange, "all">, number> = {
  "30d": 30,
  "90d": 90,
};

export function getReportRangeStart(range: ReportRange): Date | null {
  if (range === "all") {
    return null;
  }
  const start = new Date();
  start.setDate(start.getDate() - RANGE_DAYS[range]);
  return start;
}

export function parseReportRange(value: string | null): ReportRange {
  return value === "90d" || value === "all" ? value : "30d";
}

/** Every report's ticket filter. Merged tickets are always excluded: their
 * content (and copied tags) now lives on the surviving ticket, so counting
 * the closed shell too would double-count it. */
function rangeCondition(range: ReportRange) {
  const start = getReportRangeStart(range);
  const notMerged = isNull(tickets.mergedIntoTicketId);
  return start ? and(gte(tickets.createdAt, start), notMerged) : notMerged;
}

export interface AgentReportRow {
  agentId: string | null;
  agentName: string;
  avgFirstResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
  openTickets: number;
  totalTickets: number;
}

/** Tickets grouped by *current* assignedAgentId — not reassignment-weighted,
 * matching how the rest of the app treats assignment (single current owner).
 * "Unassigned" is included as its own row. */
export async function getTicketsByAgentReport(
  range: ReportRange
): Promise<AgentReportRow[]> {
  const where = rangeCondition(range);

  const [totalRows, openRows, firstResponseRows, resolutionRows] =
    await Promise.all([
      db
        .select({ agentId: tickets.assignedAgentId, c: count() })
        .from(tickets)
        .where(where)
        .groupBy(tickets.assignedAgentId),
      db
        .select({ agentId: tickets.assignedAgentId, c: count() })
        .from(tickets)
        .where(and(where, isNull(tickets.closedAt)))
        .groupBy(tickets.assignedAgentId),
      db
        .select({
          agentId: tickets.assignedAgentId,
          avgSeconds: sql<number>`EXTRACT(EPOCH FROM AVG(${tickets.firstRespondedAt} - ${tickets.createdAt}))`,
        })
        .from(tickets)
        .where(and(where, isNotNull(tickets.firstRespondedAt)))
        .groupBy(tickets.assignedAgentId),
      db
        .select({
          agentId: tickets.assignedAgentId,
          avgSeconds: sql<number>`AVG(${tickets.slaActiveSeconds})`,
        })
        .from(tickets)
        .where(and(where, isNotNull(tickets.closedAt)))
        .groupBy(tickets.assignedAgentId),
    ]);

  const agentIds = [
    ...new Set(
      totalRows.map((r) => r.agentId).filter((id): id is string => id !== null)
    ),
  ];
  const agents = agentIds.length
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, agentIds))
    : [];
  const agentNameById = new Map(agents.map((a) => [a.id, a.name ?? a.email]));

  const openByAgent = new Map(openRows.map((r) => [r.agentId, Number(r.c)]));
  const firstResponseByAgent = new Map(
    firstResponseRows.map((r) => [r.agentId, Number(r.avgSeconds)])
  );
  const resolutionByAgent = new Map(
    resolutionRows.map((r) => [r.agentId, Number(r.avgSeconds)])
  );

  const rows: AgentReportRow[] = totalRows.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentId
      ? (agentNameById.get(r.agentId) ?? "Unknown agent")
      : "Unassigned",
    totalTickets: Number(r.c),
    openTickets: openByAgent.get(r.agentId) ?? 0,
    avgFirstResponseSeconds: firstResponseByAgent.get(r.agentId) ?? null,
    avgResolutionSeconds: resolutionByAgent.get(r.agentId) ?? null,
  }));

  return rows.sort((a, b) => b.totalTickets - a.totalTickets);
}

export interface BreakdownReportRow {
  count: number;
  label: string;
  share: number;
  slug: string;
}

async function getBreakdownReport(
  column: typeof tickets.category | typeof tickets.priority,
  labelsBySlug: Map<string, string>,
  range: ReportRange
): Promise<BreakdownReportRow[]> {
  const where = rangeCondition(range);
  const rows = await db
    .select({ slug: column, c: count() })
    .from(tickets)
    .where(where)
    .groupBy(column);

  const total = rows.reduce((sum, r) => sum + Number(r.c), 0);

  return rows
    .map((r) => ({
      slug: r.slug,
      label: labelsBySlug.get(r.slug) ?? r.slug,
      count: Number(r.c),
      share: total > 0 ? Number(r.c) / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function getTicketsByCategoryReport(
  range: ReportRange
): Promise<BreakdownReportRow[]> {
  const categories = await getTicketCategories();
  const labelsBySlug = new Map(categories.map((c) => [c.slug, c.label]));
  return getBreakdownReport(tickets.category, labelsBySlug, range);
}

export async function getTicketsByPriorityReport(
  range: ReportRange
): Promise<BreakdownReportRow[]> {
  const priorities = await getTicketPriorities();
  const labelsBySlug = new Map(priorities.map((p) => [p.slug, p.label]));
  return getBreakdownReport(tickets.priority, labelsBySlug, range);
}

export interface TagReportRow {
  count: number;
  name: string;
}

const TAG_REPORT_LIMIT = 20;

/** Top N tags by ticket count within the range — tags are an unbounded
 * freeform pool (db/schema/tags.ts), so this is capped rather than
 * silently returning an unbounded list. */
export async function getTicketsByTagReport(
  range: ReportRange,
  limit = TAG_REPORT_LIMIT
): Promise<TagReportRow[]> {
  const where = rangeCondition(range);
  const rows = await db
    .select({ name: tags.name, c: count() })
    .from(ticketTags)
    .innerJoin(tags, eq(ticketTags.tagId, tags.id))
    .innerJoin(tickets, eq(ticketTags.ticketId, tickets.id))
    .where(where)
    .groupBy(tags.name)
    .orderBy(desc(count()))
    .limit(limit);

  return rows.map((r) => ({ name: r.name, count: Number(r.c) }));
}

export { TAG_REPORT_LIMIT as tagReportLimit };
