"use client";

import { ClockIcon, TrashIcon, UserIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/common/searchable-select";
import {
  SlaMetricBadge,
  SlaOutcomeBadge,
  SlaWaitBadge,
} from "@/components/common/sla-badge";
import { Button } from "@/components/ui/button";
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
import type { CustomFieldWithValue } from "@/lib/custom-fields";
import type { SlaSnapshot } from "@/lib/sla";
import type {
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "@/lib/ticket-config";
import {
  buildAssigneeOptions,
  COLOR_BADGE,
  formatTicketDateTime,
} from "@/lib/tickets";
import { type TicketLinkType, ticketLinkLabel } from "@/lib/tickets/link-types";
import type { TicketLinkView } from "@/lib/tickets/links";
import { getInitials } from "@/lib/utils";
import { CustomerProfilePopover } from "./customer-profile-popover";
import { SidebarCard } from "./sidebar-card";
import { TicketCustomFields } from "./ticket-custom-fields";
import { TicketLinks } from "./ticket-links";
import { TicketTags } from "./ticket-tags";

type Agent = { id: string; name: string | null; email: string };

interface Activity {
  action: string;
  actorName: string;
  actorRole: string;
  createdAt: Date;
  id: string;
  metadata: unknown;
}

interface Props {
  activity: Activity[];
  agents: Agent[];
  categories: TicketCategory[];
  currentUserId: string;
  customFields: CustomFieldWithValue[];
  isAdmin?: boolean;
  links: TicketLinkView[];
  priorities: TicketPriority[];
  /** The agent's "Show SLA & Overdue" preference (lib/sla-display-pref.ts) —
   * off shows only the waiting time, not SLA/overdue badges, same as the
   * ticket list's SLA column. */
  showSlaAndOverdue: boolean;
  slaSnapshot: SlaSnapshot;
  statuses: TicketStatus[];
  tags: Array<{ id: string; name: string }>;
  ticket: {
    id: string;
    ticketNumber: number;
    subject: string;
    status: string;
    category: string;
    priority: string;
    customerId: string;
    customerName: string;
    customerEmail: string;
    assignedAgentId: string | null;
    assignedAgentName: string | null;
    assignedAgentEmail: string | null;
    createdAt: Date;
    updatedAt: Date;
    closedAt: Date | null;
  };
}

export function TicketInfoSidebar({
  ticket,
  agents,
  activity,
  statuses,
  categories,
  priorities,
  showSlaAndOverdue,
  slaSnapshot,
  tags,
  customFields,
  currentUserId,
  isAdmin = false,
  links,
}: Props) {
  const statusMap = Object.fromEntries(statuses.map((s) => [s.slug, s]));
  const categoryMap = Object.fromEntries(categories.map((c) => [c.slug, c]));
  const priorityMap = Object.fromEntries(priorities.map((p) => [p.slug, p]));
  const closedStatus = statuses.find((s) => s.isClosedState);
  const defaultStatus = statuses.find((s) => s.isDefault);

  const ACTION_LABELS: Record<string, (a: Activity) => string> = {
    ticket_created: () => "Ticket submitted",
    ticket_closed: () => "Ticket closed",
    ticket_reopened: () => "Ticket reopened",
    status_changed: (a) => {
      const m = a.metadata as { from?: string; to?: string } | null;
      return `Status: ${statusMap[m?.from ?? ""]?.label ?? m?.from} → ${statusMap[m?.to ?? ""]?.label ?? m?.to}`;
    },
    priority_changed: (a) => {
      const m = a.metadata as { from?: string; to?: string } | null;
      return `Priority: ${priorityMap[m?.from ?? ""]?.label ?? m?.from} → ${priorityMap[m?.to ?? ""]?.label ?? m?.to}`;
    },
    assigned: (a) => {
      const m = a.metadata as { agentName?: string } | null;
      return `Assigned to ${m?.agentName ?? "agent"}`;
    },
    unassigned: () => "Unassigned",
    comment_added: (a) =>
      `${a.actorRole === "customer" ? "Customer" : "Agent"} replied`,
    internal_note_added: () => "Internal note added",
    attachment_added: () => "Attachment added",
    attachment_deleted: (a) => {
      const m = a.metadata as { filename?: string } | null;
      return `Attachment deleted${m?.filename ? `: ${m.filename}` : ""}`;
    },
    tag_added: (a) => {
      const m = a.metadata as { tag?: string } | null;
      return `Tag added${m?.tag ? `: ${m.tag}` : ""}`;
    },
    tag_removed: (a) => {
      const m = a.metadata as { tag?: string } | null;
      return `Tag removed${m?.tag ? `: ${m.tag}` : ""}`;
    },
    custom_field_changed: (a) => {
      const m = a.metadata as { field?: string } | null;
      return `${m?.field ?? "Custom field"} updated`;
    },
    ticket_linked: (a) => {
      const m = a.metadata as {
        type?: TicketLinkType;
        direction?: "outgoing" | "incoming";
        ticketNumber?: number;
      } | null;
      return m?.type
        ? `Link added: ${ticketLinkLabel(m.type, m.direction ?? "outgoing").toLowerCase()} #${m.ticketNumber}`
        : "Ticket linked";
    },
    ticket_unlinked: (a) => {
      const m = a.metadata as { ticketNumber?: number } | null;
      return `Link to #${m?.ticketNumber ?? "?"} removed`;
    },
  };
  const router = useRouter();

  // Accordion: only one sidebar section open at a time. `null` = all closed.
  const [openSection, setOpenSection] = useState<string | null>("ticket-info");
  const accordionProps = (key: string) => ({
    open: openSection === key,
    onOpenChange: (o: boolean) => setOpenSection(o ? key : null),
  });

  const [status, setStatus] = useState(ticket.status);
  const [category, setCategory] = useState(ticket.category);
  const [priority, setPriority] = useState(ticket.priority);
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(
    ticket.assignedAgentId
  );
  const [closeOpen, setCloseOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: object) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        const msg = data.error ?? "Update failed.";
        setError(msg);
        toast.error(msg);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Network error.");
      toast.error("Network error.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    // Moving to a closed state needs confirmation (it notifies the customer).
    if (statusMap[newStatus]?.isClosedState) {
      setPendingClose(newStatus);
      setCloseOpen(true);
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

  async function handleConfirmClose() {
    const target = pendingClose ?? closedStatus?.slug;
    if (!target) {
      setCloseOpen(false);
      return;
    }
    const ok = await patch({ status: target });
    if (ok) {
      setStatus(target);
      setCloseOpen(false);
      setPendingClose(null);
      toast.success("Ticket closed. The customer has been notified.");
    }
  }

  async function handleCategoryChange(newCategory: string) {
    const ok = await patch({ category: newCategory });
    if (ok) {
      setCategory(newCategory);
      toast.success(
        `Category changed to ${categoryMap[newCategory]?.label ?? newCategory}.`
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

  async function handleReopen() {
    const res = await fetch(`/api/tickets/${ticket.id}/reopen`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        status?: string;
      } | null;
      setStatus(data?.status ?? defaultStatus?.slug ?? status);
      toast.success("Ticket reopened.");
      router.refresh();
    } else {
      toast.error("Failed to reopen ticket.");
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Ticket deleted.");
        router.push("/tickets");
      } else {
        toast.error("Failed to delete ticket.");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <aside className="space-y-5">
      {/* Ticket Info */}
      <SidebarCard
        contentClassName="space-y-4"
        title="Ticket Info"
        {...accordionProps("ticket-info")}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-base-content-muted">Number</span>
            <span className="text-xs font-mono font-medium text-base-content">
              #{ticket.ticketNumber}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-base-content-muted">Status</span>
            <Select
              disabled={loading}
              onValueChange={handleStatusChange}
              value={status}
            >
              <SelectTrigger
                className={`h-8 w-full text-xs border ${COLOR_BADGE[statusMap[status]?.color ?? "slate"] ?? "border-base-300"}`}
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
          </div>

          <div className="space-y-1">
            <span className="text-xs text-base-content-muted">Priority</span>
            <Select
              disabled={loading}
              onValueChange={handlePriorityChange}
              value={priority}
            >
              <SelectTrigger
                className={`h-8 w-full text-xs border ${COLOR_BADGE[priorityMap[priority]?.color ?? "slate"] ?? "border-base-300"}`}
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
          </div>

          <div className="space-y-1">
            <span className="text-xs text-base-content-muted">Category</span>
            <Select
              disabled={loading}
              onValueChange={handleCategoryChange}
              value={category}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {categoryMap[c.slug]?.label ?? c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-base-content-muted">Created</span>
            <span className="text-xs text-base-content">
              {formatTicketDateTime(ticket.createdAt)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-base-content-muted">Updated</span>
            <span className="text-xs text-base-content">
              {formatTicketDateTime(ticket.updatedAt)}
            </span>
          </div>
          {ticket.closedAt && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-base-content-muted">Closed</span>
              <span className="text-xs text-base-content">
                {formatTicketDateTime(ticket.closedAt)}
              </span>
            </div>
          )}
        </div>

        {statusMap[status]?.isClosedState ? (
          <Button
            className="w-full border-base-300 text-base-content hover:bg-base-300 text-xs"
            disabled={loading}
            onClick={handleReopen}
            size="sm"
            variant="outline"
          >
            Reopen Ticket
          </Button>
        ) : (
          <Button
            className="w-full border-red-200 text-red-600 hover:bg-red-50 text-xs"
            disabled={loading}
            onClick={() => {
              setPendingClose(null);
              setCloseOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            Close Ticket
          </Button>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </SidebarCard>

      {/* SLA / Waiting Time — "SLA" only when SLA & overdue info is shown;
          otherwise just the waiting-time badge, same as the ticket list's
          Waiting Time column (see lib/sla-display-pref.ts). */}
      <SidebarCard
        contentClassName="space-y-3"
        title={showSlaAndOverdue ? "SLA" : "Waiting Time"}
        {...accordionProps("waitingTime")}
      >
        <div className="flex items-center justify-between gap-2">
          <SlaWaitBadge snapshot={slaSnapshot} />
          {showSlaAndOverdue && (
            <SlaOutcomeBadge className="shrink-0" snapshot={slaSnapshot} />
          )}
        </div>
        {showSlaAndOverdue && (
          <div className="space-y-1.5">
            {slaSnapshot.firstResponse && (
              <SlaMetricBadge
                className="w-full justify-start"
                metric={slaSnapshot.firstResponse}
              />
            )}
            {slaSnapshot.nextResponse && (
              <SlaMetricBadge
                className="w-full justify-start"
                metric={slaSnapshot.nextResponse}
              />
            )}
            {slaSnapshot.resolution && (
              <SlaMetricBadge
                className="w-full justify-start"
                metric={slaSnapshot.resolution}
              />
            )}
            {!slaSnapshot.firstResponse && (
              <p className="text-xs text-base-content-muted">
                No SLA policy configured.
              </p>
            )}
          </div>
        )}
      </SidebarCard>

      {/* Tags */}
      <SidebarCard title="Tags" {...accordionProps("tags")}>
        <TicketTags initialTags={tags} ticketId={ticket.id} />
      </SidebarCard>

      {/* Linked Tickets */}
      <SidebarCard title="Linked Tickets" {...accordionProps("links")}>
        <TicketLinks
          initialLinks={links}
          key={ticket.id}
          statuses={statuses}
          ticketId={ticket.id}
        />
      </SidebarCard>

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <SidebarCard title="Custom Fields" {...accordionProps("custom-fields")}>
          <TicketCustomFields
            initialFields={customFields}
            ticketId={ticket.id}
          />
        </SidebarCard>
      )}

      {/* Customer Info */}
      <SidebarCard title="Customer" {...accordionProps("customer")}>
        <CustomerProfilePopover
          currentTicketId={ticket.id}
          customerEmail={ticket.customerEmail}
          customerId={ticket.customerId}
          customerName={ticket.customerName}
        >
          <button
            className="flex items-start gap-2.5 w-full text-left rounded-md -m-1 p-1 hover:bg-base-300 transition-colors"
            type="button"
          >
            <div className="size-7 rounded-full bg-base-300 border border-base-300 flex items-center justify-center text-xs font-medium text-base-content shrink-0">
              {getInitials(ticket.customerName)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-base-content truncate">
                {ticket.customerName}
              </p>
              <p className="text-xs text-base-content-muted truncate">
                {ticket.customerEmail}
              </p>
            </div>
          </button>
        </CustomerProfilePopover>
      </SidebarCard>

      {/* Assigned Agent */}
      <SidebarCard
        contentClassName="space-y-3"
        title="Assigned Agent"
        {...accordionProps("assigned-agent")}
      >
        <SearchableSelect
          disabled={loading}
          onValueChange={handleAssignChange}
          options={buildAssigneeOptions(
            agents,
            assignedAgentId,
            // Only relevant while the assignee is still the one the server
            // rendered — reassigning always lands on an agent from `agents`.
            assignedAgentId === ticket.assignedAgentId
              ? (ticket.assignedAgentName ?? ticket.assignedAgentEmail)
              : null
          )}
          searchPlaceholder="Search agents…"
          triggerClassName="h-8 w-full text-xs"
          value={assignedAgentId ?? "unassigned"}
        />
        {assignedAgentId !== currentUserId && (
          <Button
            className="w-full border-base-300 text-base-content hover:bg-base-300 text-xs flex items-center gap-1.5"
            disabled={loading}
            onClick={() => handleAssignChange(currentUserId)}
            size="sm"
            variant="outline"
          >
            <UserIcon className="size-3" />
            Assign to me
          </Button>
        )}
      </SidebarCard>

      {/* Activity */}
      <SidebarCard
        icon={<ClockIcon className="size-3.5" />}
        title="Activity"
        {...accordionProps("activity")}
      >
        <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
          {activity.map((a) => {
            const label = ACTION_LABELS[a.action]?.(a) ?? a.action;
            return (
              <div className="flex gap-2 text-xs" key={a.id}>
                <span className="size-1.5 rounded-full bg-base-300 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-base-content">{label}</p>
                  <p className="text-base-content-muted mt-0.5">
                    {a.actorName} · {formatTicketDateTime(a.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </SidebarCard>

      {/* Admin: Delete Ticket */}
      {isAdmin && (
        <SidebarCard
          className="border-red-200"
          title="Danger Zone"
          titleClassName="text-red-600"
          {...accordionProps("danger-zone")}
        >
          <Button
            className="w-full border-red-200 text-red-600 hover:bg-red-50 text-xs flex items-center gap-1.5"
            onClick={() => setDeleteOpen(true)}
            size="sm"
            variant="outline"
          >
            <TrashIcon className="size-3.5" />
            Delete Ticket
          </Button>
        </SidebarCard>
      )}

      {/* Close confirmation dialog */}
      <Dialog onOpenChange={setCloseOpen} open={closeOpen}>
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
              className="border-base-300 text-base-content"
              disabled={loading}
              onClick={() => setCloseOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-content"
              disabled={loading}
              onClick={handleConfirmClose}
            >
              {loading ? "Closing…" : "Close Ticket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Ticket dialog */}
      <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-red-100">
              <TrashIcon className="size-5 text-red-600" />
            </div>
            <DialogTitle className="text-base-content text-center">
              Delete ticket #{ticket.ticketNumber}?
            </DialogTitle>
            <DialogDescription className="text-base-content-muted text-center">
              All comments and attachments will be permanently deleted. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              className="flex-1 border-base-300 text-base-content"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
