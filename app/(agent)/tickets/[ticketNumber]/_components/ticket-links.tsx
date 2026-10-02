"use client";

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TicketStatus } from "@/lib/ticket-config";
import { COLOR_BADGE } from "@/lib/tickets";
import {
  TICKET_LINK_TYPE_LABELS,
  TICKET_LINK_TYPES,
  type TicketLinkType,
  ticketLinkLabel,
} from "@/lib/tickets/link-types";
import type { TicketLinkView } from "@/lib/tickets/links";

interface Props {
  initialLinks: TicketLinkView[];
  statuses: TicketStatus[];
  ticketId: string;
}

export function TicketLinks({ ticketId, initialLinks, statuses }: Props) {
  const router = useRouter();
  const statusMap = Object.fromEntries(statuses.map((s) => [s.slug, s]));
  const [links, setLinks] = useState(initialLinks);
  // Re-sync on server refresh — a split (which adds a link) or another
  // agent's change arrives as new props via router.refresh().
  useEffect(() => {
    setLinks(initialLinks);
  }, [initialLinks]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TicketLinkType>("related_to");
  const [ticketNumber, setTicketNumber] = useState("");
  const [busy, setBusy] = useState(false);

  async function addLink() {
    const number = Number.parseInt(ticketNumber.replace("#", "").trim(), 10);
    if (!Number.isInteger(number) || number <= 0) {
      toast.error("Enter a ticket number.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketNumber: number, type }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(data?.error ?? "Failed to link ticket.");
        return;
      }
      setLinks((await res.json()) as TicketLinkView[]);
      setOpen(false);
      setTicketNumber("");
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(link: TicketLinkView) {
    const previous = links;
    setLinks(links.filter((l) => l.id !== link.id));
    try {
      const res = await fetch(`/api/tickets/${ticketId}/links/${link.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setLinks(previous);
        toast.error("Failed to remove link.");
        return;
      }
      toast.success(`Link to #${link.ticket.ticketNumber} removed.`);
      router.refresh();
    } catch {
      setLinks(previous);
      toast.error("Network error.");
    }
  }

  return (
    <div className="space-y-2">
      {links.length === 0 && (
        <p className="text-xs text-base-content-muted">No linked tickets.</p>
      )}
      {links.map((link) => {
        const status = statusMap[link.ticket.status];
        return (
          // Two lines: label + status + remove on top, so the subject below
          // gets the card's full width instead of truncating after a few words.
          <div className="text-xs" key={link.id}>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-base-content-muted">
                {ticketLinkLabel(link.type, link.direction)}
              </p>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${COLOR_BADGE[status?.color ?? "slate"] ?? ""}`}
              >
                {status?.label ?? link.ticket.status}
              </span>
              <Button
                aria-label={`Remove link to #${link.ticket.ticketNumber}`}
                className="shrink-0 text-base-content-muted hover:text-base-content"
                onClick={() => removeLink(link)}
                size="icon-xs"
                variant="ghost"
              >
                <XIcon className="size-3" />
              </Button>
            </div>
            <Link
              className="block truncate text-base-content hover:underline"
              href={`/tickets/${link.ticket.ticketNumber}`}
              title={link.ticket.subject}
            >
              <span className="font-mono">#{link.ticket.ticketNumber}</span>{" "}
              {link.ticket.subject}
            </Link>
          </div>
        );
      })}

      <Popover
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setTicketNumber("");
          }
        }}
        open={open}
      >
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center gap-1 rounded border border-dashed border-base-300 px-2 py-1 text-xs text-base-content-muted hover:text-base-content hover:border-base-content-muted transition-colors cursor-pointer"
            type="button"
          >
            <PlusIcon className="size-3" />
            Link ticket
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 space-y-2 p-3">
          <p className="text-xs text-base-content-muted">This ticket is…</p>
          <Select
            onValueChange={(v) => setType(v as TicketLinkType)}
            value={type}
          >
            <SelectTrigger
              aria-label="Link type"
              className="h-8 w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_LINK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TICKET_LINK_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Ticket number"
            autoFocus
            className="h-8 text-xs"
            disabled={busy}
            inputMode="numeric"
            onChange={(e) => setTicketNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder="Ticket number, e.g. 1042"
            value={ticketNumber}
          />
          <Button
            className="w-full text-xs"
            disabled={busy || !ticketNumber.trim()}
            onClick={addLink}
            size="sm"
          >
            {busy ? "Linking…" : "Link"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
