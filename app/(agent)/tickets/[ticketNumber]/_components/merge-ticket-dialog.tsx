"use client";

import { GitMergeIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CustomerTicketSummary } from "@/lib/customers";
import type { TicketStatus } from "@/lib/ticket-config";
import { COLOR_BADGE, formatTicketDateTime } from "@/lib/tickets";
import { cn } from "@/lib/utils";

interface Props {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  statuses: TicketStatus[];
  ticket: { id: string; ticketNumber: number; customerId: string };
}

type Targets =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; tickets: CustomerTicketSummary[] };

/** Picks which of the same customer's open tickets this one merges into.
 * Merges are same-customer and open-target only (lib/tickets/merge.ts), so the
 * customer's open-ticket list is the complete set of valid targets. */
export function MergeTicketDialog({
  ticket,
  open,
  onOpenChange,
  statuses,
}: Props) {
  const router = useRouter();
  const statusMap = Object.fromEntries(statuses.map((s) => [s.slug, s]));
  const [targets, setTargets] = useState<Targets>({ state: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTargets({ state: "loading" });
    setSelected(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/customers/${ticket.customerId}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          openTickets: CustomerTicketSummary[];
        };
        if (!cancelled) {
          setTargets({
            state: "ready",
            tickets: data.openTickets.filter((t) => t.id !== ticket.id),
          });
        }
      } catch {
        // Distinct from "no other open tickets" — that would be misleading.
        if (!cancelled) {
          setTargets({ state: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ticket.customerId, ticket.id]);

  // Ignore Esc / outside-click while the request is in flight, so the dialog
  // can't vanish and then navigate away under the agent a moment later.
  function handleOpenChange(next: boolean) {
    if (!merging) {
      onOpenChange(next);
    }
  }

  async function handleMerge() {
    if (selected === null) {
      return;
    }
    setMerging(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTicketNumber: selected }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        targetTicketNumber?: number;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to merge tickets.");
        return;
      }
      const targetNumber = data?.targetTicketNumber ?? selected;
      toast.success(`Merged #${ticket.ticketNumber} into #${targetNumber}.`);
      onOpenChange(false);
      router.push(`/tickets/${targetNumber}`);
    } catch {
      toast.error("Network error.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="rounded-xl">
        <DialogHeader>
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-base-300">
            <GitMergeIcon className="size-5 text-base-content" />
          </div>
          <DialogTitle className="text-base-content text-center">
            Merge ticket #{ticket.ticketNumber} into another ticket?
          </DialogTitle>
          <DialogDescription className="text-base-content-muted text-center">
            All messages and attachments from #{ticket.ticketNumber} move into
            the ticket you pick, and #{ticket.ticketNumber} is closed. The
            customer isn't emailed — their old link opens the merged ticket.
            This can't be undone.
          </DialogDescription>
        </DialogHeader>

        {/* Native radios: arrow-key navigation and the selected state come
            for free; the input is visually hidden and the row is its label. */}
        <fieldset className="min-w-0 space-y-1.5" disabled={merging}>
          <legend className="mb-1.5 text-xs text-base-content-muted">
            Only this customer's open tickets can be merged into.
          </legend>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {targets.state === "loading" && (
              <p className="py-4 text-center text-xs text-base-content-muted">
                Loading…
              </p>
            )}
            {targets.state === "error" && (
              <p className="py-4 text-center text-xs text-red-600">
                Couldn't load this customer's tickets. Close this dialog and try
                again.
              </p>
            )}
            {targets.state === "ready" && targets.tickets.length === 0 && (
              <p className="py-4 text-center text-xs text-base-content-muted">
                This customer has no other open tickets. To merge into a closed
                ticket, reopen it first.
              </p>
            )}
            {targets.state === "ready" &&
              targets.tickets.map((t) => {
                const status = statusMap[t.status];
                const isSelected = selected === t.ticketNumber;
                return (
                  <label
                    className={cn(
                      "flex w-full items-center gap-2 rounded-field border px-3 py-2 text-left text-sm transition-colors cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                      isSelected
                        ? "border-primary bg-base-300"
                        : "border-base-300 hover:bg-base-300"
                    )}
                    key={t.id}
                  >
                    <input
                      checked={isSelected}
                      className="sr-only"
                      name={`merge-target-${ticket.id}`}
                      onChange={() => setSelected(t.ticketNumber)}
                      type="radio"
                      value={t.ticketNumber}
                    />
                    <span className="shrink-0 font-mono text-xs text-base-content-muted">
                      #{t.ticketNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base-content">
                        {t.subject}
                      </span>
                      <span className="block text-xs text-base-content-muted">
                        Opened {formatTicketDateTime(new Date(t.createdAt))}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${COLOR_BADGE[status?.color ?? "slate"] ?? ""}`}
                    >
                      {status?.label ?? t.status}
                    </span>
                  </label>
                );
              })}
          </div>
        </fieldset>

        <DialogFooter className="gap-2">
          <Button
            className="flex-1 border-base-300 text-base-content"
            disabled={merging}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={merging || selected === null}
            onClick={handleMerge}
          >
            {merging ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
