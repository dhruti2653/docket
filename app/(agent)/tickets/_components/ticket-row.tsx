"use client";

import { PencilSimpleLineIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/common/searchable-select";
import {
  pickMostUrgentMetric,
  SlaMetricBadge,
  SlaOutcomeBadge,
  SlaWaitBadge,
} from "@/components/common/sla-badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SlaSnapshot } from "@/lib/sla";
import type { TicketPriority, TicketStatus } from "@/lib/ticket-config";
import {
  buildAssigneeOptions,
  COLOR_BADGE,
  formatTicketDate,
} from "@/lib/tickets";
import type { ColumnPref } from "@/lib/tickets-table-columns";

interface Row {
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  category: string;
  customerName: string;
  /** The current agent has an unsent reply draft on this ticket. */
  hasDraft: boolean;
  id: string;
  priority: string;
  slaSnapshot: SlaSnapshot;
  status: string;
  subject: string;
  tags: string[];
  ticketNumber: number;
  updatedAt: Date;
  updatedByName: string | null;
}

interface Agent {
  email: string;
  id: string;
  name: string | null;
}

interface ColorRow {
  color: string;
  label: string;
}

interface Props {
  agents: Agent[];
  categoryMap: Record<string, ColorRow | undefined>;
  isAdmin: boolean;
  /** Current filter/sort/page query string — appended to this row's ticket
   * link so the detail page's Previous/Next buttons stay within this same
   * filtered result set. */
  listQuery: string;
  onRequestClose: (status: string) => void;
  onToggleSelect: () => void;
  priorities: TicketPriority[];
  priorityMap: Record<string, ColorRow | undefined>;
  row: Row;
  selected: boolean;
  /** The agent's "Show SLA & Overdue" preference — off shows only the
   * waiting time (SlaWaitBadge), not SLA/overdue badges. */
  showSlaAndOverdue: boolean;
  statuses: TicketStatus[];
  statusMap: Record<string, ColorRow | undefined>;
  visibleColumns: ColumnPref[];
}

export function TicketRow({
  row,
  statusMap,
  categoryMap,
  priorityMap,
  statuses,
  priorities,
  agents,
  isAdmin,
  selected,
  onRequestClose,
  onToggleSelect,
  showSlaAndOverdue,
  visibleColumns,
  listQuery,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(row.status);
  const [priority, setPriority] = useState(row.priority);
  const [assignedAgentId, setAssignedAgentId] = useState(row.assignedAgentId);
  const [loading, setLoading] = useState(false);

  useEffect(() => setStatus(row.status), [row.status]);
  useEffect(() => setPriority(row.priority), [row.priority]);
  useEffect(
    () => setAssignedAgentId(row.assignedAgentId),
    [row.assignedAgentId]
  );

  async function patch(body: object) {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(data?.error ?? "Update failed.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.error("Network error.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    // Moving to a closed state needs confirmation (it notifies the customer).
    if (statuses.find((s) => s.slug === newStatus)?.isClosedState) {
      onRequestClose(newStatus);
      return;
    }
    const ok = await patch({ status: newStatus });
    if (ok) {
      setStatus(newStatus);
      toast.success(
        `Status changed to ${statusMap[newStatus]?.label ?? newStatus}.`
      );
    }
  }

  async function handlePriorityChange(newPriority: string) {
    const ok = await patch({ priority: newPriority });
    if (ok) {
      setPriority(newPriority);
      toast.success(
        `Priority changed to ${priorityMap[newPriority]?.label ?? newPriority}.`
      );
    }
  }

  async function handleAssignChange(agentId: string) {
    const newId = agentId === "unassigned" ? null : agentId;
    const ok = await patch({ assignedAgentId: newId });
    if (ok) {
      setAssignedAgentId(newId);
      toast.success(newId ? "Ticket assigned." : "Ticket unassigned.");
    }
  }

  function renderCell(columnId: ColumnPref["id"]) {
    switch (columnId) {
      case "status":
        return (
          <Select
            disabled={loading}
            onValueChange={handleStatusChange}
            value={status}
          >
            <SelectTrigger
              className={`h-7 w-full text-xs border ${COLOR_BADGE[statusMap[status]?.color ?? "slate"] ?? "border-base-300"}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s.slug} value={s.slug}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "category":
        return (
          <span
            className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${COLOR_BADGE[categoryMap[row.category]?.color ?? "slate"] ?? ""}`}
          >
            {categoryMap[row.category]?.label ?? row.category}
          </span>
        );
      case "priority":
        return (
          <Select
            disabled={loading}
            onValueChange={handlePriorityChange}
            value={priority}
          >
            <SelectTrigger
              className={`h-7 w-full text-xs border ${COLOR_BADGE[priorityMap[priority]?.color ?? "slate"] ?? "border-base-300"}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((p) => (
                <SelectItem key={p.slug} value={p.slug}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "waitingTime": {
        // "Show SLA & Overdue" off: the waiting time alone (SlaWaitBadge) is
        // never SLA-policy-dependent, so it stays visible either way — only
        // the SLA/overdue-specific badges below it are gated on the pref.
        if (!showSlaAndOverdue) {
          return <SlaWaitBadge compact snapshot={row.slaSnapshot} />;
        }
        // A closed ticket has no countdown left — show the final verdict
        // instead of the most-urgent live metric.
        if (row.slaSnapshot.waitState === "resolved") {
          return (
            <div className="space-y-1">
              <SlaWaitBadge compact snapshot={row.slaSnapshot} />
              <SlaOutcomeBadge snapshot={row.slaSnapshot} />
            </div>
          );
        }
        const urgent = pickMostUrgentMetric(row.slaSnapshot, Date.now());
        return (
          <div className="space-y-1">
            <SlaWaitBadge compact snapshot={row.slaSnapshot} />
            {urgent && <SlaMetricBadge metric={urgent} />}
          </div>
        );
      }
      case "customer":
        return (
          <span
            className="block max-w-36 truncate text-base-content-muted text-xs"
            title={row.customerName}
          >
            {row.customerName}
          </span>
        );
      case "assigned":
        return (
          <SearchableSelect
            compact
            disabled={loading}
            onValueChange={handleAssignChange}
            options={buildAssigneeOptions(
              agents,
              assignedAgentId,
              // Only relevant while the assignee is still the one the server
              // rendered — reassigning always lands on an agent from `agents`.
              assignedAgentId === row.assignedAgentId
                ? row.assignedAgentName
                : null
            )}
            searchPlaceholder="Search agents…"
            triggerClassName="h-7 w-full text-xs"
            value={assignedAgentId ?? "unassigned"}
          />
        );
      case "tags":
        return row.tags.length === 0 ? (
          <span className="text-base-content-muted text-xs">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.tags.slice(0, 2).map((tag) => (
              <span
                className="inline-flex items-center whitespace-nowrap rounded border border-base-300 bg-base-300 px-1.5 py-0.5 text-xs font-medium text-base-content"
                key={tag}
              >
                {tag}
              </span>
            ))}
            {row.tags.length > 2 && (
              <span className="text-base-content-muted text-xs">
                +{row.tags.length - 2}
              </span>
            )}
          </div>
        );
      case "updatedBy":
        return (
          <span className="text-base-content-muted text-xs">
            {row.updatedByName ?? "—"}
          </span>
        );
      case "updatedAt":
        return (
          <span className="text-base-content-muted text-xs whitespace-nowrap">
            {formatTicketDate(row.updatedAt)}
          </span>
        );
      default:
        return null;
    }
  }

  return (
    <tr
      className={`hover:bg-base-300/40 transition-colors group ${
        selected ? "bg-primary/5" : ""
      }`}
    >
      {isAdmin && (
        <td
          className={`sticky left-0 z-10 px-4 py-3 transition-colors group-hover:bg-base-300/40 ${
            selected ? "bg-primary/5" : "bg-base-100"
          }`}
        >
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        </td>
      )}
      <td className="px-4 py-3 text-base-content-muted font-mono text-xs">
        #{row.ticketNumber}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-start gap-2">
          {row.hasDraft && (
            <span
              aria-label="Draft — you have an unsent reply on this ticket"
              className="-my-0.5 flex size-6 shrink-0 items-center justify-center rounded-field text-primary"
              role="img"
              title="Draft — unsent reply saved"
            >
              <PencilSimpleLineIcon className="size-4" weight="bold" />
            </span>
          )}
          <Link
            className="text-[13px] font-medium text-base-content hover:underline line-clamp-2"
            href={`/tickets/${row.ticketNumber}${listQuery}`}
            title={row.subject}
          >
            {row.subject}
          </Link>
        </div>
      </td>
      {visibleColumns.map((c) => (
        <td className="px-4 py-3" key={c.id}>
          {renderCell(c.id)}
        </td>
      ))}
    </tr>
  );
}
