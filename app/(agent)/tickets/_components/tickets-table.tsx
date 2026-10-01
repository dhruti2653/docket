"use client";

import {
  ArrowDownIcon,
  ArrowsDownUpIcon,
  ArrowUpIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/common/searchable-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  type ColumnPref,
  CUSTOMIZABLE_COLUMNS,
} from "@/lib/tickets-table-columns";
import { BulkTagSelect } from "./bulk-tag-select";
import { TicketRow } from "./ticket-row";

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

const COLUMN_META = Object.fromEntries(
  CUSTOMIZABLE_COLUMNS.map((c) => [c.id, c])
);

function SortIcon({
  active,
  order,
}: {
  active: boolean;
  order: "asc" | "desc";
}) {
  if (!active) {
    return <ArrowsDownUpIcon className="size-3.5 text-base-content-muted/50" />;
  }
  return order === "asc" ? (
    <ArrowUpIcon className="size-3.5 text-base-content" />
  ) : (
    <ArrowDownIcon className="size-3.5 text-base-content" />
  );
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

export function TicketsTable({
  rows: initialRows,
  statusMap,
  categoryMap,
  priorityMap,
  statuses,
  priorities,
  agents,
  isAdmin,
  columnPrefs,
  listQuery,
  showSlaAndOverdue,
}: {
  rows: Row[];
  statusMap: Record<string, ColorRow | undefined>;
  categoryMap: Record<string, ColorRow | undefined>;
  priorityMap: Record<string, ColorRow | undefined>;
  statuses: TicketStatus[];
  priorities: TicketPriority[];
  agents: Agent[];
  isAdmin: boolean;
  columnPrefs: ColumnPref[];
  /** Current filter/sort/page query string (e.g. "?status=open&sort=id") —
   * carried onto each row's ticket link so the detail page's Previous/Next
   * buttons can traverse this same filtered result set. */
  listQuery: string;
  /** The agent's "Show SLA & Overdue" preference (lib/sla-display-pref.ts) —
   * off shows only the waiting time, not SLA/overdue badges. */
  showSlaAndOverdue: boolean;
}) {
  const visibleColumns = columnPrefs.filter((c) => c.visible);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Seeded from the server prop but never re-synced to it — see the note above
  // `runBulk`. A real navigation remounts this component (page.tsx keys the
  // Suspense boundary on `params`), re-seeding it from fresh data naturally.
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState<{
    rowId: string;
    status: string;
  } | null>(null);
  const [closingBusy, setClosingBusy] = useState(false);

  const sortParam = searchParams.get("sort");
  const activeSort =
    sortParam === "id"
      ? "id"
      : sortParam === "waitingTime"
        ? "waitingTime"
        : "updatedAt";
  const activeOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

  function toggleSort(column: "id" | "updatedAt" | "waitingTime") {
    const params = new URLSearchParams(searchParams.toString());
    const nextOrder =
      activeSort === column && activeOrder === "desc" ? "asc" : "desc";
    params.set("sort", column);
    params.set("order", nextOrder);
    params.delete("page"); // reset pagination on sort change
    router.push(`/tickets?${params.toString()}`);
  }

  /** Derives the effective selection from the rows actually on screen, so counts
   * and bulk payloads never include ghosts from a prior page/filter view.
   * Defensive — real navigation already clears the selection. */
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const selectedCount = selectedIds.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /** Applies a bulk action to the matching local rows in place, rather than
   * waiting on a server refresh that could re-sort or filter them out from under
   * the user — so the action visibly lands on the tickets they picked. */
  function patchSelectedRows(action: string, value: string | null) {
    setRows((prev) =>
      prev.map((r) => {
        if (!selected.has(r.id)) {
          return r;
        }
        switch (action) {
          case "status":
            return value ? { ...r, status: value } : r;
          case "priority":
            return value ? { ...r, priority: value } : r;
          case "assign": {
            const agent = value ? agents.find((a) => a.id === value) : null;
            return {
              ...r,
              assignedAgentId: value,
              assignedAgentName: agent ? (agent.name ?? agent.email) : null,
            };
          }
          case "tag":
            return value && !r.tags.includes(value)
              ? { ...r, tags: [...r.tags, value] }
              : r;
          default:
            return r;
        }
      })
    );
  }

  async function runBulk(body: { action: string; value: string | null }) {
    setBusy(true);
    try {
      const res = await fetch("/api/tickets/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, ...body }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Bulk update failed.");
        return;
      }
      toast.success(
        `Updated ${selectedCount} ticket${selectedCount === 1 ? "" : "s"}.`
      );
      patchSelectedRows(body.action, body.value);
      // Keep the selection so bulk actions can be chained on the same tickets;
      // only a delete clears it. Still refresh so server-rendered parts (total
      // count) stay accurate — the table ignores it for `rows`, per above.
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkDelete() {
    setBusy(true);
    try {
      const res = await fetch("/api/tickets/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Bulk delete failed.");
        return;
      }
      toast.success(
        `Deleted ${selectedCount} ticket${selectedCount === 1 ? "" : "s"}.`
      );
      setRows((prev) => prev.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
      setDeleteOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmClose() {
    if (!closeConfirm) {
      return;
    }
    setClosingBusy(true);
    try {
      const res = await fetch(`/api/tickets/${closeConfirm.rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: closeConfirm.status }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Update failed.");
        return;
      }
      toast.success("Ticket closed. The customer has been notified.");
      setRows((prev) =>
        prev.map((r) =>
          r.id === closeConfirm.rowId
            ? { ...r, status: closeConfirm.status }
            : r
        )
      );
      setCloseConfirm(null);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setClosingBusy(false);
    }
  }

  return (
    <>
      {/* Bulk action bar — admin only, shown when rows are selected */}
      {isAdmin && someSelected && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-base-content">
            {selectedCount} selected
          </span>
          <button
            className="text-xs text-base-content-muted hover:text-base-content"
            onClick={() => setSelected(new Set())}
            type="button"
          >
            Clear
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SearchableSelect
              disabled={busy}
              onValueChange={(v) =>
                runBulk({
                  action: "assign",
                  value: v === "unassigned" ? null : v,
                })
              }
              options={[
                { value: "unassigned", label: "Unassign" },
                ...agents.map((a) => ({
                  value: a.id,
                  label: a.name ?? a.email,
                })),
              ]}
              placeholder="Assign to…"
              searchPlaceholder="Search agents…"
              triggerClassName="h-9 w-44"
              value=""
            />
            <Select
              disabled={busy}
              onValueChange={(v) => runBulk({ action: "status", value: v })}
              value=""
            >
              <SelectTrigger className="h-9 w-44">
                <SelectValue placeholder="Change status…" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.slug} value={s.slug}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              disabled={busy}
              onValueChange={(v) => runBulk({ action: "priority", value: v })}
              value=""
            >
              <SelectTrigger className="h-9 w-44">
                <SelectValue placeholder="Change priority…" />
              </SelectTrigger>
              <SelectContent>
                {priorities.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <BulkTagSelect
              disabled={busy}
              onSelect={(name) => runBulk({ action: "tag", value: name })}
            />
            <Button
              className="h-9"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
              size="sm"
              variant="destructive"
            >
              <TrashIcon className="size-4" />
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-base-100 rounded-xl border border-base-300 shadow-soft overflow-clip">
        {/* overflow-y-clip, not "auto" — a plain scroll container here would
            intercept the sticky header's positioning before it reaches the
            page's real scrolling ancestor. */}
        <div className="overflow-x-auto overflow-y-clip">
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-base-300 bg-base-300">
                {isAdmin && (
                  <th className="sticky left-0 z-20 w-10 bg-base-300 px-4 py-3">
                    <Checkbox
                      // The primitive's resting border is `base-300`, which is
                      // exactly this header cell's fill — invisible. Lift it to
                      // a muted content tier so the box reads against base-300.
                      checked={allSelected}
                      className="border-base-content/30"
                      onCheckedChange={toggleAll}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = selectedCount > 0 && !allSelected;
                        }
                      }}
                    />
                  </th>
                )}
                <th className="w-16 px-4 py-3 text-left text-xs font-medium text-base-content-muted uppercase tracking-wide">
                  <button
                    className="inline-flex items-center gap-1 hover:text-base-content"
                    onClick={() => toggleSort("id")}
                    type="button"
                  >
                    #
                    <SortIcon
                      active={activeSort === "id"}
                      order={activeOrder}
                    />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-base-content-muted uppercase tracking-wide w-56">
                  Subject
                </th>
                {visibleColumns.map((c) => {
                  const sortableColumn =
                    c.id === "updatedAt" || c.id === "waitingTime"
                      ? c.id
                      : null;
                  return (
                    <th
                      className={`text-left px-4 py-3 text-xs font-medium text-base-content-muted uppercase tracking-wide ${COLUMN_META[c.id].width}`}
                      key={c.id}
                    >
                      {sortableColumn ? (
                        <button
                          className="inline-flex items-center gap-1 hover:text-base-content"
                          onClick={() => toggleSort(sortableColumn)}
                          type="button"
                        >
                          {COLUMN_META[c.id].label}
                          <SortIcon
                            active={activeSort === sortableColumn}
                            order={activeOrder}
                          />
                        </button>
                      ) : (
                        COLUMN_META[c.id].label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-base-300/60">
              {rows.map((row) => (
                <TicketRow
                  agents={agents}
                  categoryMap={categoryMap}
                  isAdmin={isAdmin}
                  key={row.id}
                  listQuery={listQuery}
                  onRequestClose={(status) =>
                    setCloseConfirm({ rowId: row.id, status })
                  }
                  onToggleSelect={() => toggleOne(row.id)}
                  priorities={priorities}
                  priorityMap={priorityMap}
                  row={row}
                  selected={selected.has(row.id)}
                  showSlaAndOverdue={showSlaAndOverdue}
                  statuses={statuses}
                  statusMap={statusMap}
                  visibleColumns={visibleColumns}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk delete confirmation */}
      <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-error/10">
              <WarningCircleIcon className="size-6 text-error" weight="fill" />
            </div>
            <DialogTitle className="text-center">
              Delete {selectedCount} ticket{selectedCount === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription className="text-center">
              This will permanently delete the selected tickets and their
              attachments. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={handleBulkDelete}
              variant="destructive"
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close confirmation — moving to a closed status notifies the customer */}
      <Dialog
        onOpenChange={(open) => !open && setCloseConfirm(null)}
        open={closeConfirm !== null}
      >
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base-content">
              Close this ticket?
            </DialogTitle>
            <DialogDescription className="text-base-content-muted">
              The ticket will be marked as closed and the customer will be
              notified by email.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              className="border-base-300 text-base-content hover:bg-base-300"
              onClick={() => setCloseConfirm(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={closingBusy} onClick={handleConfirmClose}>
              {closingBusy ? "Closing…" : "Close Ticket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
