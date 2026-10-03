// OpenAPI 3.1 spec for OUTBOUND webhooks, rendered by Scalar at
// /admin/webhooks/docs. Uses the top-level `webhooks` keyword — like `paths`,
// but for requests *we* send to *your* server. Hand-authored; keep in sync with
// docs/webhooks.md and the event catalog in lib/webhooks/events.ts.

import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";

const ERROR_NOTE =
  "This is a description of the request **we** send **you** — there's no response schema to define here beyond the status code: any 2xx marks the delivery sent, anything else is retried (see the Retries section above).";

const TICKET_SCHEMA = {
  type: "object",
  required: [
    "id",
    "ticketNumber",
    "subject",
    "status",
    "priority",
    "category",
    "customerName",
    "customerEmail",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", examples: ["cku1a2b3c4d5e6f"] },
    ticketNumber: { type: "integer", examples: [1042] },
    subject: { type: "string", examples: ["Can't log in"] },
    status: {
      type: "string",
      description:
        "Status slug at the time of this event. Deployment-specific — see `GET /api/v1/config`.",
      examples: ["open"],
    },
    priority: { type: "string", examples: ["normal"] },
    category: { type: "string", examples: ["bug"] },
    customerName: { type: "string", examples: ["Jane Doe"] },
    customerEmail: {
      type: "string",
      format: "email",
      examples: ["jane@example.com"],
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const COMMENT_SCHEMA = {
  type: "object",
  required: ["authorName", "authorRole", "content", "createdAt"],
  properties: {
    authorName: { type: "string", examples: ["Jane Doe"] },
    authorRole: {
      type: "string",
      enum: ["customer", "agent", "admin"],
      examples: ["customer"],
    },
    content: {
      type: "string",
      description: "Plain text — never the internal rich-text JSON.",
      examples: ["It still isn't working."],
    },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

function envelope(
  eventName: string,
  dataProperties: Record<string, unknown>,
  dataRequired: string[]
) {
  return {
    type: "object",
    required: ["id", "event", "createdAt", "data"],
    properties: {
      id: {
        type: "string",
        description: "Unique delivery event id.",
        examples: ["evt_c1a2b3c4d5e6"],
      },
      event: { type: "string", const: eventName },
      createdAt: { type: "string", format: "date-time" },
      data: {
        type: "object",
        required: dataRequired,
        properties: dataProperties,
      },
    },
  };
}

const HEADER_PARAMS = [
  {
    name: "X-Docket-Event",
    in: "header",
    required: true,
    description:
      "The event name, e.g. `ticket.created` — matches the body's `event` field.",
    schema: { type: "string" },
  },
  {
    name: "X-Docket-Delivery",
    in: "header",
    required: true,
    description:
      "This delivery's unique id — use it to dedupe if your endpoint is retried.",
    schema: { type: "string" },
  },
  {
    name: "X-Docket-Timestamp",
    in: "header",
    required: true,
    description:
      "Unix seconds the request was signed at. Reject requests where this is more than a few minutes old.",
    schema: { type: "string" },
  },
  {
    name: "X-Docket-Signature",
    in: "header",
    required: true,
    description:
      '`sha256=<hex hmac>` — HMAC-SHA256 of `"{timestamp}.{raw body}"`, keyed with your endpoint\'s signing secret (shown once, at creation or rotation, in `/admin/webhooks`). Recompute and compare — never trust the payload without checking it.',
    schema: { type: "string" },
  },
] as const;

function webhookOperation(opts: {
  summary: string;
  description: string;
  requestSchemaName: string;
  example: Record<string, unknown>;
}) {
  return {
    post: {
      tags: ["Ticket events"],
      summary: opts.summary,
      description: `${opts.description}\n\n${ERROR_NOTE}`,
      parameters: HEADER_PARAMS,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${opts.requestSchemaName}` },
            example: opts.example,
          },
        },
      },
      responses: {
        "200": {
          description:
            "Any 2xx marks the delivery sent. Return one as soon as you've durably queued the event on your end.",
        },
      },
    },
  };
}

const EXAMPLE_TICKET = {
  id: "cku1a2b3c4d5e6f",
  ticketNumber: 1042,
  subject: "Can't log in",
  status: "open",
  priority: "normal",
  category: "bug",
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
};

export function buildWebhooksOpenApiSpec(
  baseUrl: string
): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Docket Webhooks",
      version: "1.0.0",
      summary: "Get notified on your own server when ticket events happen.",
      description: [
        "Docket can POST a signed JSON payload to your own server when ticket events happen — the outbound counterpart to the [public API](/admin/api-keys/docs) (which you poll).",
        "",
        "Delivery is async and durable: an event is queued, sent by a background worker, and retried with backoff on failure. Nothing about creating, replying to, or closing a ticket ever blocks waiting on your server to respond.",
        "",
        "## Setting up a webhook",
        "",
        "Go to `/admin/webhooks` → **Add Webhook** → give it a name, your URL, and pick which events below you want. On create, you'll see a **signing secret** exactly once — copy it into your server's config immediately; Docket stores it encrypted and never displays it again (use **Rotate secret** if you lose it). Use **Send test event** to verify your endpoint before relying on real traffic, and check **delivery history** (with a **Redeliver** button for failures) any time from the same page.",
        "",
        "## Verifying a delivery",
        "",
        "Every request carries the four headers documented below. Recompute the signature yourself:",
        "",
        "```js",
        'const crypto = require("node:crypto");',
        "",
        "function verify(rawBody, timestampHeader, signatureHeader, secret) {",
        "  const expected = crypto",
        '    .createHmac("sha256", secret)',
        // A JavaScript sample rendered verbatim in the webhook docs: the ${...}
        // must reach the reader literally, being their template literal not ours.
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal code sample shown to API consumers
        "    .update(`${timestampHeader}.${rawBody}`)",
        "    .digest('hex');",
        '  const provided = signatureHeader.replace("sha256=", "");',
        "  const age = Math.abs(Date.now() / 1000 - Number(timestampHeader));",
        "  if (age > 300) return false; // replay protection",
        "  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));",
        "}",
        "```",
        "",
        "## Retries",
        "",
        "A non-2xx response, a 10s timeout, or a network error is retried up to 5 attempts total: **1 minute → 5 minutes → 30 minutes → 2 hours**. After the last attempt the delivery is marked failed — redeliver it manually from `/admin/webhooks`, or watch for the next real occurrence of that event.",
        "",
        "## Security notes",
        "",
        "`customerName`/`customerEmail` are included in every ticket payload — treat your receiving endpoint with the same data-handling care as anything else that sees customer PII. Deleting an endpoint also deletes its delivery history; disable it instead if you just want to pause it.",
      ].join("\n"),
    },
    servers: [
      {
        url: baseUrl,
        description: "This Docket instance (the sender, not the destination)",
      },
    ],
    tags: [
      {
        name: "Ticket events",
        description: "One entry per event your endpoint can subscribe to.",
      },
    ],
    webhooks: {
      "ticket.created": webhookOperation({
        summary: "Ticket Created",
        description:
          "A new ticket was submitted, via the customer portal or the public API.",
        requestSchemaName: "TicketCreatedPayload",
        example: {
          id: "evt_c1a2b3c4d5e6",
          event: "ticket.created",
          createdAt: "2026-07-23T12:00:00.000Z",
          data: { ticket: EXAMPLE_TICKET },
        },
      }),
      "ticket.replied": webhookOperation({
        summary: "Ticket Replied",
        description:
          "A **public** reply was posted by the customer or an agent. Internal notes never fire this — they're agent-only and never leave the building.",
        requestSchemaName: "TicketRepliedPayload",
        example: {
          id: "evt_d2b3c4d5e6f7",
          event: "ticket.replied",
          createdAt: "2026-07-23T12:05:00.000Z",
          data: {
            ticket: EXAMPLE_TICKET,
            comment: {
              authorName: "Jane Doe",
              authorRole: "customer",
              content: "It still isn't working.",
              createdAt: "2026-07-23T12:05:00.000Z",
            },
          },
        },
      }),
      "ticket.closed": webhookOperation({
        summary: "Ticket Closed",
        description:
          "A ticket moved into a closed status — via the dedicated close button, the API, or the sidebar status dropdown.",
        requestSchemaName: "TicketClosedPayload",
        example: {
          id: "evt_e3c4d5e6f7g8",
          event: "ticket.closed",
          createdAt: "2026-07-23T12:10:00.000Z",
          data: { ticket: { ...EXAMPLE_TICKET, status: "closed" } },
        },
      }),
      "ticket.reopened": webhookOperation({
        summary: "Ticket Reopened",
        description: "A closed ticket was reopened.",
        requestSchemaName: "TicketReopenedPayload",
        example: {
          id: "evt_f4d5e6f7g8h9",
          event: "ticket.reopened",
          createdAt: "2026-07-23T12:15:00.000Z",
          data: { ticket: EXAMPLE_TICKET },
        },
      }),
      "ticket.status_changed": webhookOperation({
        summary: "Status Changed",
        description:
          "Status changed to something other than a close/reopen transition (those fire `ticket.closed`/`ticket.reopened` instead).",
        requestSchemaName: "TicketStatusChangedPayload",
        example: {
          id: "evt_g5e6f7g8h9i0",
          event: "ticket.status_changed",
          createdAt: "2026-07-23T12:20:00.000Z",
          data: { ticket: { ...EXAMPLE_TICKET, status: "in_progress" } },
        },
      }),
      "ticket.category_changed": webhookOperation({
        summary: "Category Changed",
        description: "An agent changed the ticket's category.",
        requestSchemaName: "TicketCategoryChangedPayload",
        example: {
          id: "evt_h6f7g8h9i0j1",
          event: "ticket.category_changed",
          createdAt: "2026-07-23T12:25:00.000Z",
          data: { ticket: EXAMPLE_TICKET, previousCategory: "general" },
        },
      }),
      "ticket.priority_changed": webhookOperation({
        summary: "Priority Changed",
        description: "An agent changed the ticket's priority.",
        requestSchemaName: "TicketPriorityChangedPayload",
        example: {
          id: "evt_i7g8h9i0j1k2",
          event: "ticket.priority_changed",
          createdAt: "2026-07-23T12:30:00.000Z",
          data: { ticket: EXAMPLE_TICKET, previousPriority: "low" },
        },
      }),
      "ticket.assigned": webhookOperation({
        summary: "Ticket Assigned",
        description: "A ticket was assigned to an agent.",
        requestSchemaName: "TicketAssignedPayload",
        example: {
          id: "evt_j8h9i0j1k2l3",
          event: "ticket.assigned",
          createdAt: "2026-07-23T12:35:00.000Z",
          data: { ticket: EXAMPLE_TICKET, assignedAgentId: "cka1b2c3d4e5f" },
        },
      }),
      "ticket.unassigned": webhookOperation({
        summary: "Ticket Unassigned",
        description: "A ticket was unassigned.",
        requestSchemaName: "TicketUnassignedPayload",
        example: {
          id: "evt_k9i0j1k2l3m4",
          event: "ticket.unassigned",
          createdAt: "2026-07-23T12:40:00.000Z",
          data: { ticket: EXAMPLE_TICKET, assignedAgentId: null },
        },
      }),
      "ticket.merged": webhookOperation({
        summary: "Ticket Merged",
        description:
          "A duplicate ticket (`mergedTicket`) was merged into `ticket`. Its replies and attachments moved to `ticket`; the merged ticket is closed but kept, and its id/portal link forward to `ticket`. `ticket.closed` is **not** fired for the merged ticket — merges are silent toward the customer.",
        requestSchemaName: "TicketMergedPayload",
        example: {
          id: "evt_l0j1k2l3m4n5",
          event: "ticket.merged",
          createdAt: "2026-07-23T12:45:00.000Z",
          data: {
            ticket: EXAMPLE_TICKET,
            mergedTicket: {
              ...EXAMPLE_TICKET,
              id: "ckm9n8b7v6c5x",
              ticketNumber: 1043,
              status: "closed",
            },
          },
        },
      }),
      "ticket.split": webhookOperation({
        summary: "Ticket Split",
        description:
          "An agent split one customer reply out of `ticket` into the new ticket `newTicket`. `ticket.created` also fires for `newTicket`.",
        requestSchemaName: "TicketSplitPayload",
        example: {
          id: "evt_m1k2l3m4n5o6",
          event: "ticket.split",
          createdAt: "2026-07-23T12:50:00.000Z",
          data: {
            ticket: EXAMPLE_TICKET,
            newTicket: {
              ...EXAMPLE_TICKET,
              id: "ckq1w2e3r4t5y",
              ticketNumber: 1044,
            },
          },
        },
      }),
    },
    components: {
      schemas: {
        Ticket: TICKET_SCHEMA,
        Comment: COMMENT_SCHEMA,
        TicketCreatedPayload: envelope(
          "ticket.created",
          { ticket: { $ref: "#/components/schemas/Ticket" } },
          ["ticket"]
        ),
        TicketRepliedPayload: envelope(
          "ticket.replied",
          {
            ticket: { $ref: "#/components/schemas/Ticket" },
            comment: { $ref: "#/components/schemas/Comment" },
          },
          ["ticket", "comment"]
        ),
        TicketClosedPayload: envelope(
          "ticket.closed",
          { ticket: { $ref: "#/components/schemas/Ticket" } },
          ["ticket"]
        ),
        TicketReopenedPayload: envelope(
          "ticket.reopened",
          { ticket: { $ref: "#/components/schemas/Ticket" } },
          ["ticket"]
        ),
        TicketStatusChangedPayload: envelope(
          "ticket.status_changed",
          { ticket: { $ref: "#/components/schemas/Ticket" } },
          ["ticket"]
        ),
        TicketCategoryChangedPayload: envelope(
          "ticket.category_changed",
          {
            ticket: { $ref: "#/components/schemas/Ticket" },
            previousCategory: { type: "string", examples: ["general"] },
          },
          ["ticket", "previousCategory"]
        ),
        TicketPriorityChangedPayload: envelope(
          "ticket.priority_changed",
          {
            ticket: { $ref: "#/components/schemas/Ticket" },
            previousPriority: { type: "string", examples: ["low"] },
          },
          ["ticket", "previousPriority"]
        ),
        TicketAssignedPayload: envelope(
          "ticket.assigned",
          {
            ticket: { $ref: "#/components/schemas/Ticket" },
            assignedAgentId: { type: "string", examples: ["cka1b2c3d4e5f"] },
          },
          ["ticket", "assignedAgentId"]
        ),
        TicketUnassignedPayload: envelope(
          "ticket.unassigned",
          {
            ticket: { $ref: "#/components/schemas/Ticket" },
            assignedAgentId: { type: "null" },
          },
          ["ticket", "assignedAgentId"]
        ),
        TicketMergedPayload: envelope(
          "ticket.merged",
          {
            ticket: { $ref: "#/components/schemas/Ticket" },
            mergedTicket: { $ref: "#/components/schemas/Ticket" },
          },
          ["ticket", "mergedTicket"]
        ),
        TicketSplitPayload: envelope(
          "ticket.split",
          {
            ticket: { $ref: "#/components/schemas/Ticket" },
            newTicket: { $ref: "#/components/schemas/Ticket" },
          },
          ["ticket", "newTicket"]
        ),
      },
    },
  };
}

// Keeps the hand-authored event list above honest against the single source
// of truth in lib/webhooks/events.ts — throws at build/import time (not
// silently stale) if someone adds an event to one and forgets the other.
const specEventNames = new Set([
  "ticket.created",
  "ticket.replied",
  "ticket.closed",
  "ticket.reopened",
  "ticket.status_changed",
  "ticket.category_changed",
  "ticket.priority_changed",
  "ticket.assigned",
  "ticket.unassigned",
  "ticket.merged",
  "ticket.split",
]);
const catalogEventNames = new Set(WEBHOOK_EVENTS.map((e) => e.value));
if (
  specEventNames.size !== catalogEventNames.size ||
  ![...specEventNames].every((e) => catalogEventNames.has(e))
) {
  throw new Error(
    "lib/webhooks-openapi-spec.ts's event list is out of sync with lib/webhooks/events.ts's WEBHOOK_EVENTS — update both together."
  );
}
