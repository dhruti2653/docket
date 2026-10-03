"use client";

import { ArrowsSplitIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  commentId: string;
  ticketId: string;
  ticketNumber: number;
  ticketSubject: string;
}

/** "Split" action on a customer reply — moves it into a new ticket. */
export function SplitCommentButton({
  commentId,
  ticketId,
  ticketNumber,
  ticketSubject,
}: Props) {
  const router = useRouter();
  // The customer sees this subject in their "ticket created" email, so it
  // reads as a follow-up rather than agent-speak like "split".
  const defaultSubject =
    `${ticketSubject} (follow-up to #${ticketNumber})`.slice(0, 200);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [splitting, setSplitting] = useState(false);
  const subjectLength = subject.trim().length;
  const subjectValid = subjectLength >= 5 && subjectLength <= 200;

  async function handleSplit() {
    setSplitting(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, subject }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        newTicketNumber?: number;
      } | null;
      if (!res.ok || !data?.newTicketNumber) {
        toast.error(data?.error ?? "Failed to split ticket.");
        return;
      }
      setOpen(false);
      toast.success(`Reply split into new ticket #${data.newTicketNumber}.`, {
        action: {
          label: "Open",
          onClick: () => router.push(`/tickets/${data.newTicketNumber}`),
        },
      });
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setSplitting(false);
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Split into a new ticket"
            className="shrink-0 text-base-content-muted hover:text-base-content"
            onClick={() => {
              setSubject(defaultSubject);
              setOpen(true);
            }}
            size="icon-xs"
            variant="ghost"
          >
            <ArrowsSplitIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Split into a new ticket</TooltipContent>
      </Tooltip>

      {/* Esc / outside-click is ignored while the request is in flight. */}
      <Dialog
        onOpenChange={(next) => {
          if (!splitting) {
            setOpen(next);
          }
        }}
        open={open}
      >
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-base-300">
              <ArrowsSplitIcon className="size-5 text-base-content" />
            </div>
            <DialogTitle className="text-base-content text-center">
              Split this reply into a new ticket?
            </DialogTitle>
            <DialogDescription className="text-base-content-muted text-center">
              This reply and its attachments move out of #{ticketNumber} into a
              new ticket for the same customer. The customer gets an email with
              a link to the new ticket.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label
              className="text-xs text-base-content-muted"
              htmlFor={`split-subject-${commentId}`}
            >
              New ticket subject
            </label>
            <Input
              aria-invalid={!subjectValid}
              disabled={splitting}
              id={`split-subject-${commentId}`}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              value={subject}
            />
            {!subjectValid && (
              <p className="text-xs text-red-600">
                Subject must be 5–200 characters.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              className="flex-1 border-base-300 text-base-content"
              disabled={splitting}
              onClick={() => setOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={splitting || !subjectValid}
              onClick={handleSplit}
            >
              {splitting ? "Splitting…" : "Split Reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
