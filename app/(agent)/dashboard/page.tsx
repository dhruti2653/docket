import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  EyeIcon,
  HourglassIcon,
  TicketIcon,
} from "@phosphor-icons/react/dist/ssr";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ADMIN_ROLE, AGENT_ROLE } from "@/config/platform";
import { user } from "@/db/schema/auth";
import { tickets } from "@/db/schema/tickets";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTicketCategories, getTicketStatuses } from "@/lib/ticket-config";
import { COLOR_BADGE } from "@/lib/tickets";
import { VolumeChart } from "./_components/volume-chart";

export const metadata = { title: "Dashboard" };

function formatWait(ms: number): string {
  const s = ms / 1000;
  if (s < 3600) {
    return `${Math.max(1, Math.floor(s / 60))}m`;
  }
  if (s < 86_400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86_400);
  return `${d}d`;
}

function formatAvgWait(ms: number): string {
  const s = ms / 1000;
  if (s < 3600) {
    return `${Math.max(1, Math.floor(s / 60))}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== AGENT_ROLE && session.user.role !== ADMIN_ROLE) {
    redirect("/login");
  }

  const now = Date.now();

  const [dbStatuses, dbCategories] = await Promise.all([
    getTicketStatuses(),
    getTicketCategories(),
  ]);

  const statusMap = Object.fromEntries(dbStatuses.map((s) => [s.slug, s]));
  const categoryMap = Object.fromEntries(dbCategories.map((c) => [c.slug, c]));

  // ── Status buckets (derived from dynamic status flags) ──────────────────
  // Open = the default status, Closed = any closed-state status,
  // In Progress = everything in between. Generalises the old fixed 3 statuses.
  const closedSlugs = new Set(
    dbStatuses.filter((s) => s.isClosedState).map((s) => s.slug)
  );
  const defaultSlug = dbStatuses.find((s) => s.isDefault)?.slug;
  const nonClosedSlugs = dbStatuses
    .filter((s) => !s.isClosedState)
    .map((s) => s.slug);

  // ── Overview stats ──────────────────────────────────────────────────────
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

  // Average wait across the open (non-closed) queue.
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

  const stats = {
    total,
    open,
    inProgress,
    closed,
    avgWaitMs:
      waitRow.avgWaitSeconds == null
        ? null
        : Number(waitRow.avgWaitSeconds) * 1000,
  };

  // ── 7-day volume (initial data for chart) ──────────────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const volumeRows = await db
    .select({
      date: sql<string>`DATE(${tickets.createdAt})::text`,
      count: count(),
    })
    .from(tickets)
    .where(gte(tickets.createdAt, sevenDaysAgo))
    .groupBy(sql`DATE(${tickets.createdAt})`)
    .orderBy(sql`DATE(${tickets.createdAt})`);

  const volumeMap = new Map(volumeRows.map((r) => [r.date, Number(r.count)]));
  const initialVolumeData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: volumeMap.get(key) ?? 0 };
  });

  // ── Recent open tickets (last 10 by updatedAt) ─────────────────────────
  const recentTickets = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      category: tickets.category,
      createdAt: tickets.createdAt,
      agentName: user.name,
    })
    .from(tickets)
    .leftJoin(user, eq(tickets.assignedAgentId, user.id))
    .where(
      nonClosedSlugs.length
        ? inArray(tickets.status, nonClosedSlugs)
        : sql`false`
    )
    .orderBy(desc(tickets.updatedAt))
    .limit(10);

  // ── My tickets (assigned to me, open + in_progress) ────────────────────
  const myTickets = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      category: tickets.category,
      status: tickets.status,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.assignedAgentId, session.user.id),
        nonClosedSlugs.length
          ? inArray(tickets.status, nonClosedSlugs)
          : sql`false`
      )
    )
    .orderBy(desc(tickets.updatedAt))
    .limit(10);

  // Each card links to the ticket list with its bucket pre-applied. Buckets
  // that span several statuses (In Progress, Closed) use the comma-separated
  // status filter the list supports.
  const bucketHref = (slugs: Array<string | undefined>) => {
    const list = slugs.filter(Boolean) as string[];
    return list.length
      ? `/tickets?status=${encodeURIComponent(list.join(","))}`
      : "/tickets";
  };
  const inProgressSlugs = dbStatuses
    .filter((s) => !s.isClosedState && s.slug !== defaultSlug)
    .map((s) => s.slug);

  const statCards = [
    {
      label: "Total Tickets",
      value: stats.total,
      sub: "All time",
      icon: TicketIcon,
      color: "text-base-content",
      bg: "bg-primary/8",
      href: "/tickets",
    },
    {
      label: "Open",
      value: stats.open,
      sub:
        stats.avgWaitMs == null
          ? "No open tickets"
          : `Avg. wait: ${formatAvgWait(stats.avgWaitMs)}`,
      icon: HourglassIcon,
      color: "text-amber-600",
      bg: "bg-amber-50",
      href: bucketHref([defaultSlug]),
    },
    {
      label: "In Progress",
      value: stats.inProgress,
      sub: "Being handled",
      icon: ArrowsClockwiseIcon,
      color: "text-blue-600",
      bg: "bg-blue-50",
      href: bucketHref(inProgressSlugs),
    },
    {
      label: "Closed",
      value: stats.closed,
      sub: "Resolved",
      icon: CheckCircleIcon,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      href: bucketHref(Array.from(closedSlugs)),
    },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-base-content">Dashboard</h1>
        <p className="text-sm text-base-content-muted mt-1">
          Support queue overview.
        </p>
      </div>

      {/* Stat cards — each opens the ticket list with its filter applied */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Link
            className="block bg-base-100 rounded-xl border border-base-300 shadow-soft p-5 transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            href={card.href}
            key={card.label}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`${card.bg} rounded-lg p-2`}>
                <card.icon
                  className={`size-5 ${card.color}`}
                  weight="duotone"
                />
              </div>
            </div>
            <p className="text-2xl font-bold text-base-content">{card.value}</p>
            <p className="text-xs font-medium text-base-content-muted mt-0.5">
              {card.label}
            </p>
            <p className="text-xs text-base-content-muted/70 mt-1">
              {card.sub}
            </p>
          </Link>
        ))}
      </div>

      {/* Volume chart */}
      <VolumeChart initialData={initialVolumeData} />

      {/* Recent open tickets */}
      <div className="bg-base-100 rounded-xl border border-base-300 shadow-soft">
        <div className="px-6 py-4 border-b border-base-300">
          <h2 className="text-base font-semibold text-base-content">
            Recent Open Tickets
          </h2>
          <p className="text-xs text-base-content-muted mt-0.5">
            Last 10 open tickets by activity
          </p>
        </div>
        {recentTickets.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-base-content-muted">
              No open tickets. Great work!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-300">
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Assigned To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Waiting
                  </th>
                  <th className="w-14 px-6 py-3">
                    <span className="sr-only">View</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-300">
                {recentTickets.map((t) => (
                  <tr
                    className="hover:bg-base-300/30 transition-colors"
                    key={t.id}
                  >
                    <td className="px-6 py-3 text-base-content-muted font-mono text-xs">
                      #{t.ticketNumber}
                    </td>
                    <td className="px-6 py-3 max-w-xs">
                      <Link
                        className="text-base-content font-medium hover:underline truncate block"
                        href={`/tickets/${t.ticketNumber}`}
                      >
                        {t.subject}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300/30 text-base-content">
                        {categoryMap[t.category]?.label ?? t.category}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-base-content-muted text-xs">
                      {t.agentName ?? (
                        <span className="italic text-base-content-muted/50">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-xs text-base-content-muted">
                      {formatWait(now - t.createdAt.getTime())}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link
                        aria-label={`View ticket #${t.ticketNumber}`}
                        className="inline-flex size-7 items-center justify-center rounded-md text-base-content-muted hover:text-base-content hover:bg-base-300 transition-colors"
                        href={`/tickets/${t.ticketNumber}`}
                      >
                        <EyeIcon className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {recentTickets.length > 0 && (
          <div className="px-6 py-3 border-t border-base-300">
            <Link
              className="text-xs text-base-content-muted hover:text-base-content transition-colors"
              href="/tickets"
            >
              View all open tickets →
            </Link>
          </div>
        )}
      </div>

      {/* My tickets */}
      <div className="bg-base-100 rounded-xl border border-base-300 shadow-soft">
        <div className="px-6 py-4 border-b border-base-300">
          <h2 className="text-base font-semibold text-base-content">
            My Tickets
          </h2>
          <p className="text-xs text-base-content-muted mt-0.5">
            Open and in-progress tickets assigned to you
          </p>
        </div>
        {myTickets.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-base-content-muted">
              No tickets assigned to you.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-300">
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-base-content-muted">
                    Waiting
                  </th>
                  <th className="w-14 px-6 py-3">
                    <span className="sr-only">View</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-300">
                {myTickets.map((t) => (
                  <tr
                    className="hover:bg-base-300/30 transition-colors"
                    key={t.id}
                  >
                    <td className="px-6 py-3 text-base-content-muted font-mono text-xs">
                      #{t.ticketNumber}
                    </td>
                    <td className="px-6 py-3 max-w-xs">
                      <Link
                        className="text-base-content font-medium hover:underline truncate block"
                        href={`/tickets/${t.ticketNumber}`}
                      >
                        {t.subject}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300/30 text-base-content">
                        {categoryMap[t.category]?.label ?? t.category}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${COLOR_BADGE[statusMap[t.status]?.color ?? "slate"] ?? ""}`}
                      >
                        {statusMap[t.status]?.label ?? t.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-base-content-muted">
                      {formatWait(now - t.createdAt.getTime())}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link
                        aria-label={`View ticket #${t.ticketNumber}`}
                        className="inline-flex size-7 items-center justify-center rounded-md text-base-content-muted hover:text-base-content hover:bg-base-300 transition-colors"
                        href={`/tickets/${t.ticketNumber}`}
                      >
                        <EyeIcon className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
