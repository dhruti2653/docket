import {
  and,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { customers } from "@/db/schema/customers";
import { tickets } from "@/db/schema/tickets";
import { waitingTimeSecondsSql } from "@/lib/sla";

/** Everything the tickets list page's filters/sort/pagination can put in the URL. */
export interface TicketListSearchParams {
  assignee?: string;
  awaiting?: string;
  category?: string;
  from?: string;
  mine?: string;
  order?: string;
  page?: string;
  pageSize?: string;
  priority?: string;
  q?: string;
  range?: string;
  sort?: string;
  status?: string;
  to?: string;
  /** The active queue tab — see ticketMatchesView(). Unset = the unrestricted
   * list (today's default behavior), unaffected by this filter. */
  view?: string;
}

export type TicketView = "awaiting" | "open";

/** Parses the `view` query param into a known tab, or null when unset/unrecognized. */
export function parseTicketView(
  params: Pick<TicketListSearchParams, "view">
): TicketView | null {
  return params.view === "awaiting" || params.view === "open"
    ? params.view
    : null;
}

/** Whether `ticket` belongs to the given queue tab — the same rule
 * buildTicketsWhereClause applies via SQL, exposed standalone so it's unit
 * testable without a database. "open" = any non-closed status. "awaiting" =
 * open AND currently awaiting an agent reply. The open-status check also
 * applies to "awaiting": closing a ticket through a generic status-change
 * route (PATCH /api/tickets/[id], bulk) only sets closedAt, not
 * awaitingReply, so a closed ticket can still have awaitingReply = true. */
export function ticketMatchesView(
  view: TicketView,
  ticket: { awaitingReply: boolean; status: string },
  openStatusSlugs: string[]
): boolean {
  const isOpen = openStatusSlugs.includes(ticket.status);
  return view === "awaiting" ? isOpen && ticket.awaitingReply : isOpen;
}

export const SORT_COLUMNS = {
  id: tickets.ticketNumber,
  updatedAt: tickets.updatedAt,
  waitingTime: waitingTimeSecondsSql,
} as const;
export type SortKey = keyof typeof SORT_COLUMNS;

const RANGE_DAYS: Record<string, number> = {
  last_day: 1,
  last_week: 7,
  // "Today/7d/30d/90d/All time" quick-filter row (TicketDateQuickFilter) —
  // additive slugs alongside the Filters popover's own Date Range options
  // above; both write the same `range` param via getRangeStart().
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function getRangeStart(range: string | null): Date | null {
  if (!range) {
    return null;
  }
  if (range === "this_month" || range === "today") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const days = RANGE_DAYS[range];
  if (!days) {
    return null;
  }
  const start = new Date();
  start.setDate(start.getDate() - days);
  return start;
}

export function parseTicketListSort(params: TicketListSearchParams): {
  sortKey: SortKey;
  sortOrder: "asc" | "desc";
} {
  const sortKey: SortKey =
    params.sort === "id"
      ? "id"
      : params.sort === "waitingTime"
        ? "waitingTime"
        : "updatedAt";
  return {
    sortKey,
    sortOrder: params.order === "asc" ? "asc" : "desc",
  };
}

/** The tickets list page's WHERE semantics, in one place so the detail page's
 * prev/next lookup filters identically. Search touches `customers`, so callers
 * must innerJoin it on tickets.customerId before applying this clause.
 * `openStatusSlugs` is only consulted when `params.view` is set — pass the
 * result of `getTicketStatuses().filter(s => !s.isClosedState)`. */
export function buildTicketsWhereClause(
  params: TicketListSearchParams,
  agentId: string,
  openStatusSlugs: string[] = []
): SQL | undefined {
  const search = params.q?.trim() ?? "";
  const statusFilter =
    params.status && params.status !== "all" ? params.status : null;
  const categoryFilter =
    params.category && params.category !== "all" ? params.category : null;
  const priorityFilter =
    params.priority && params.priority !== "all" ? params.priority : null;
  const assigneeFilter =
    params.assignee && params.assignee !== "all" ? params.assignee : null;
  const rangeFilter =
    params.range && params.range !== "all" ? params.range : null;
  const awaitingFilter = params.awaiting === "1";
  const mineFilter = params.mine === "1";

  // Merged tickets never show in the list — they're closed shells that
  // forward to the ticket they were merged into.
  const conditions: SQL[] = [isNull(tickets.mergedIntoTicketId)];
  if (search) {
    const numSearch = Number.parseInt(search.replace("#", ""), 10);
    const textConditions = [
      ilike(tickets.subject, `%${search}%`),
      ilike(customers.name, `%${search}%`),
      ilike(customers.email, `%${search}%`),
    ];
    if (!Number.isNaN(numSearch)) {
      textConditions.push(eq(tickets.ticketNumber, numSearch) as never);
    }
    conditions.push(or(...textConditions) as SQL);
  }
  if (statusFilter) {
    // Supports a comma-separated slug list — dashboard buckets like
    // "In Progress" and "Closed" span multiple statuses.
    const statusSlugs = statusFilter
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (statusSlugs.length > 1) {
      conditions.push(inArray(tickets.status, statusSlugs));
    } else if (statusSlugs.length === 1) {
      conditions.push(eq(tickets.status, statusSlugs[0]));
    }
  }
  if (categoryFilter) {
    conditions.push(eq(tickets.category, categoryFilter));
  }
  if (priorityFilter) {
    conditions.push(eq(tickets.priority, priorityFilter));
  }
  if (rangeFilter === "custom") {
    // Custom range: from/to are YYYY-MM-DD day bounds, both optional.
    const isDay = (v: string | undefined): v is string =>
      !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (isDay(params.from)) {
      conditions.push(
        gte(tickets.createdAt, new Date(`${params.from}T00:00:00`))
      );
    }
    if (isDay(params.to)) {
      conditions.push(
        lte(tickets.createdAt, new Date(`${params.to}T23:59:59.999`))
      );
    }
  }
  const rangeStart = getRangeStart(rangeFilter);
  if (rangeStart) {
    conditions.push(gte(tickets.createdAt, rangeStart));
  }
  if (awaitingFilter) {
    conditions.push(eq(tickets.awaitingReply, true));
  }
  const view = parseTicketView(params);
  if (view) {
    // Mirrors ticketMatchesView(): both tabs require a non-closed status;
    // "awaiting" additionally requires the awaitingReply flag.
    conditions.push(
      openStatusSlugs.length > 0
        ? inArray(tickets.status, openStatusSlugs)
        : sql`false`
    );
    if (view === "awaiting") {
      conditions.push(eq(tickets.awaitingReply, true));
    }
  }
  if (mineFilter) {
    conditions.push(eq(tickets.assignedAgentId, agentId));
  }
  if (assigneeFilter) {
    conditions.push(
      assigneeFilter === "unassigned"
        ? isNull(tickets.assignedAgentId)
        : eq(tickets.assignedAgentId, assigneeFilter)
    );
  }

  return and(...conditions);
}

/** Re-serializes a searchParams object back into a query string, carrying
 * filters/sort/pagination forward unchanged between list rows and the
 * detail page's prev/next links. */
export function toQueryString(params: TicketListSearchParams): string {
  const qp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      qp.set(key, value);
    }
  }
  const qs = qp.toString();
  return qs ? `?${qs}` : "";
}
