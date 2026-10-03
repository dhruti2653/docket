export interface WebhookEventDefinition {
  defaultEnabled: boolean;
  description: string;
  label: string;
  value: string;
}

// The full catalog of events an endpoint can subscribe to. `defaultEnabled`
// only affects which boxes are pre-checked in the admin "create endpoint"
// dialog — it has no runtime effect (dispatchWebhookEvent() only checks a
// given endpoint's own `events` array).
export const WEBHOOK_EVENTS: WebhookEventDefinition[] = [
  {
    value: "ticket.created",
    label: "Ticket Created",
    description: "A new ticket was submitted (portal or public API).",
    defaultEnabled: true,
  },
  {
    value: "ticket.replied",
    label: "Ticket Replied",
    description:
      "A public reply was posted by the customer or an agent. Internal notes never fire this event.",
    defaultEnabled: true,
  },
  {
    value: "ticket.closed",
    label: "Ticket Closed",
    description: "A ticket moved into a closed status.",
    defaultEnabled: true,
  },
  {
    value: "ticket.reopened",
    label: "Ticket Reopened",
    description: "A closed ticket was reopened.",
    defaultEnabled: true,
  },
  {
    value: "ticket.status_changed",
    label: "Status Changed",
    description:
      "Status changed to something other than a close/reopen transition (those fire ticket.closed/ticket.reopened instead).",
    defaultEnabled: false,
  },
  {
    value: "ticket.category_changed",
    label: "Category Changed",
    description: "An agent changed the ticket's category.",
    defaultEnabled: false,
  },
  {
    value: "ticket.priority_changed",
    label: "Priority Changed",
    description: "An agent changed the ticket's priority.",
    defaultEnabled: false,
  },
  {
    value: "ticket.assigned",
    label: "Ticket Assigned",
    description: "A ticket was assigned to an agent.",
    defaultEnabled: false,
  },
  {
    value: "ticket.unassigned",
    label: "Ticket Unassigned",
    description: "A ticket was unassigned.",
    defaultEnabled: false,
  },
  {
    value: "ticket.merged",
    label: "Ticket Merged",
    description:
      "A duplicate ticket was merged into another. The merged ticket is closed, but ticket.closed is not fired for it.",
    defaultEnabled: false,
  },
  {
    value: "ticket.split",
    label: "Ticket Split",
    description:
      "A customer reply was split out of a ticket into a new ticket. ticket.created also fires for the new ticket.",
    defaultEnabled: false,
  },
];

export const WEBHOOK_EVENT_VALUES = WEBHOOK_EVENTS.map((e) => e.value);
export type WebhookEvent = (typeof WEBHOOK_EVENT_VALUES)[number];

export const DEFAULT_WEBHOOK_EVENTS = WEBHOOK_EVENTS.filter(
  (e) => e.defaultEnabled
).map((e) => e.value);

export function isValidWebhookEvent(value: string): value is WebhookEvent {
  return WEBHOOK_EVENT_VALUES.includes(value);
}
