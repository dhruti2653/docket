// Client-safe (no DB imports) — shared by the links API and the sidebar panel.

export const TICKET_LINK_TYPES = [
  "related_to",
  "duplicate_of",
  "blocks",
] as const;
export type TicketLinkType = (typeof TICKET_LINK_TYPES)[number];

export function isTicketLinkType(value: unknown): value is TicketLinkType {
  return (
    typeof value === "string" &&
    (TICKET_LINK_TYPES as readonly string[]).includes(value)
  );
}

/** Label for the "add link" picker — completes "This ticket is…". */
export const TICKET_LINK_TYPE_LABELS: Record<TicketLinkType, string> = {
  related_to: "Related to",
  duplicate_of: "A duplicate of",
  blocks: "Blocking",
};

/** How a link reads on the ticket that created it. */
const OUTGOING_LABELS: Record<TicketLinkType, string> = {
  related_to: "Related to",
  duplicate_of: "Duplicate of",
  blocks: "Blocks",
};

/** How a link reads from one end. `outgoing` = this ticket is the row's
 * ticketId; `incoming` = it's the linkedTicketId, so directional types flip. */
export function ticketLinkLabel(
  type: TicketLinkType,
  direction: "outgoing" | "incoming"
): string {
  if (direction === "outgoing" || type === "related_to") {
    return OUTGOING_LABELS[type];
  }
  return type === "blocks" ? "Blocked by" : "Duplicated by";
}
