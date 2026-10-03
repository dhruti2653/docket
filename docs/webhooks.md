# Webhooks

## Overview

Docket can POST a signed JSON payload to your own server when ticket events happen — the outbound counterpart to the [Public API](./api.md) (which you poll) and the opposite direction from the inbound `/api/webhooks/email` route (which only receives email delivery events from your SMTP provider).

Delivery is async and durable: an event is queued (`webhook_deliveries` table), sent by a background worker (pg-boss, the same queue used for outbound email — see `lib/worker/`), and retried with backoff on failure. Nothing about creating, replying to, or closing a ticket ever blocks waiting on your server to respond.

Manage endpoints at `/admin/webhooks` (admin role required). For an interactive, per-event reference (rendered by Scalar from `lib/webhooks-openapi-spec.ts`, the same pattern used for the [public API docs](./api.md)), see **View Docs** on that page, or go straight to `/admin/webhooks/docs`.

If your backend sends its own customer emails off these events, turn off Docket's built-in ticket notification emails at `/admin/email-templates` ("Docket sends email") to avoid double-notifying customers — see [Disabling Docket's Ticket Emails](./email-notifications.md#disabling-dockets-ticket-emails).

---

## Setting up a webhook

1. Go to `/admin/webhooks` → **Add Webhook**.
2. Fill in a name (just a label for your own reference), your endpoint's URL, and which events you want (Ticket Created, Replied, Closed, Reopened are pre-checked; status/category/priority/assignment changes are available but off by default).
3. Click **Create**. A dialog shows the **signing secret** exactly once — copy it into your server's config now. Docket stores it encrypted and never displays it again; if you lose it, use **Rotate secret** to get a new one (this invalidates the old one).
4. Click **Send test event** (paper-plane icon) to verify your endpoint before relying on real traffic.
5. From then on, matching events POST to your URL automatically. Check the endpoint's **delivery history** (clock icon) any time — each attempt shows its status, HTTP response code, and a **Redeliver** button if it failed.

---

## Events

| Event | Fires when |
|---|---|
| `ticket.created` | A new ticket is submitted (customer portal or public API) |
| `ticket.replied` | A **public** reply is posted by the customer or an agent. Internal notes never fire this — they're agent-only and never leave the building. |
| `ticket.closed` | A ticket moves into a closed status — via the dedicated close button, the API, or the sidebar status dropdown |
| `ticket.reopened` | A closed ticket is reopened |
| `ticket.status_changed` | Status changes to something other than a close/reopen transition |
| `ticket.category_changed` | An agent changes the ticket's category |
| `ticket.priority_changed` | An agent changes the ticket's priority |
| `ticket.assigned` / `ticket.unassigned` | A ticket is assigned to (or unassigned from) an agent |
| `ticket.merged` | A duplicate ticket was merged into another. `data.ticket` is the surviving ticket, `data.mergedTicket` the one merged away. The merged ticket is closed, but `ticket.closed` is **not** fired for it — merges are silent toward the customer. |
| `ticket.split` | A customer reply was split into a new ticket. `data.ticket` is the original, `data.newTicket` the new one. `ticket.created` also fires for the new ticket. |

Each endpoint subscribes to a subset of these events (configurable per endpoint in the admin UI). An endpoint with zero matching events for a given occurrence receives nothing.

---

## Payload shape

Every delivery has the same envelope:

```json
{
  "id": "evt_c1a2b3c4d5e6",
  "event": "ticket.created",
  "createdAt": "2026-07-23T12:00:00.000Z",
  "data": {
    "ticket": {
      "id": "cm3x...",
      "ticketNumber": 1042,
      "subject": "Can't log in",
      "status": "open",
      "priority": "normal",
      "category": "bug",
      "customerName": "Jane Doe",
      "customerEmail": "jane@example.com",
      "createdAt": "2026-07-23T12:00:00.000Z",
      "updatedAt": "2026-07-23T12:00:00.000Z"
    }
  }
}
```

`ticket.replied` additionally includes `data.comment`:

```json
"comment": {
  "authorName": "Jane Doe",
  "authorRole": "customer",
  "content": "It still isn't working.",
  "createdAt": "2026-07-23T12:05:00.000Z"
}
```

`ticket.category_changed` / `ticket.priority_changed` include `previousCategory` / `previousPriority`. `ticket.assigned` / `ticket.unassigned` include `assignedAgentId`.

`data.ticket.customerName`/`customerEmail` are always the values on the ticket at the time of the event — plain fields, matching the ticket detail API response shape (see [api.md](./api.md)).

---

## Verifying a delivery

Every request carries:

| Header | Meaning |
|---|---|
| `X-Docket-Event` | The event name, e.g. `ticket.created` |
| `X-Docket-Delivery` | This delivery's unique id — use it to dedupe if your endpoint is retried |
| `X-Docket-Timestamp` | Unix seconds the request was signed at |
| `X-Docket-Signature` | `sha256=<hex hmac>` — HMAC-SHA256 of `"{timestamp}.{raw body}"`, keyed with your endpoint's signing secret |

Recompute the signature yourself and compare — never trust the payload without checking it:

```js
const crypto = require("node:crypto");

function verify(rawBody, timestampHeader, signatureHeader, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestampHeader}.${rawBody}`)
    .digest("hex");
  const provided = signatureHeader.replace("sha256=", "");
  // Reject if the timestamp is more than a few minutes old — this is what
  // makes the signature replay-resistant, not the HMAC alone.
  const age = Math.abs(Date.now() / 1000 - Number(timestampHeader));
  if (age > 300) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
```

The signing secret is shown **once**, at endpoint creation (or after using "Rotate secret") — Docket stores it encrypted at rest and never displays it again.

---

## Retries

A non-2xx response, timeout (10s), or network error is retried up to 5 attempts total, with backoff: **1 minute → 5 minutes → 30 minutes → 2 hours**. After the final attempt, the delivery is marked `failed` and stops retrying automatically — you can inspect it and click "Redeliver" from `/admin/webhooks`.

Any 2xx response status marks the delivery `sent`. Return a 2xx as soon as you've durably queued the event on your end — do your own slow processing after responding, not before, so you don't accidentally cause a timeout-triggered retry (and a duplicate event, since retries are not otherwise deduplicated on our side — use `X-Docket-Delivery` to dedupe on yours).

---

## Security notes

- Endpoints must be `http://` or `https://` URLs you control — Docket has no way to verify ownership, so treat the signing secret as the only trust boundary.
- Disable (don't delete) an endpoint you want to pause — deleting one also deletes its delivery history.
- `customerEmail`/`customerName` are included in every ticket payload — treat your receiving endpoint with the same data-handling care as anything else that sees customer PII.
