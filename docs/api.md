# Public API

Docket exposes a small REST API so your own website's backend can
create tickets without sending customers through the customer portal form.

> **Interactive docs & machine-readable contract.** Admins get an
> interactive reference (rendered by Scalar, with a built-in "Test Request"
> client) at `/admin/api-keys/docs`. The canonical contract is the OpenAPI
> 3.1 spec in `lib/openapi-spec.ts`, downloadable at
> `GET /api/admin/api-keys/openapi` — import it into Postman or any other
> API tooling. There's also a ready-to-use Postman collection (hand-authored,
> in `app/api/admin/api-keys/postman/route.ts`), pre-filled with this
> instance's URL, downloadable from `/admin/api-keys` ("Postman Collection")
> or `GET /api/admin/api-keys/postman`. When the API changes, update the
> spec, this document, and the Postman collection together.

This is a **server-to-server** API: your backend calls it with a secret API
key. Don't call it directly from a customer's browser — the key would be
exposed to anyone who opens your page's network tab.

## Authentication

Generate a key from `/admin/api-keys` (admin only). You'll see the raw key
exactly once, at creation — copy it somewhere safe immediately. Support
Tool only ever stores a hash of it, so it can't be shown to you again; if
you lose it, revoke it and create a new one.

Send it as a bearer token on every request:

```
Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

A missing, invalid, or revoked key gets a `401`.

## Rate limits

Per API key: **100 ticket creations/min** (`POST /tickets`), **60
replies/min** (`POST /tickets/:id/comments`), **60 status changes/min**
(`PATCH /tickets/:id/status`). Read-only endpoints (`GET /config`,
`GET /tickets`, `GET /tickets/:id`, `GET /tickets/:id/comments`,
`GET /tickets/:id/attachments/:attachmentId`) aren't rate-limited. A `429`
means you've hit a write limit — back off and retry after a moment.

## Errors

Every error response is `{ "error": "<message>" }` with an appropriate HTTP
status (`400` validation, `401` auth, `404` not found, `429` rate limited,
`500` server error).

---

## `GET /api/v1/config`

The current valid category, priority, and status slugs, plus the shared tag
pool — fetch this once (cache it) to build a ticket form or interpret a
`status` value, instead of hardcoding slugs an admin could rename or reorder
later. `categories`/`priorities`/`statuses` are pre-sorted in display order
(the same order agents see in the app); `tags` is alphabetical.

```bash
curl https://support.example.com/api/v1/config \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response** — `200 OK`:

```json
{
  "categories": [{ "slug": "bug", "label": "Bug", "color": "red" }],
  "priorities": [
    { "slug": "normal", "label": "Normal", "color": "slate", "isDefault": true }
  ],
  "statuses": [
    {
      "slug": "open",
      "label": "Open",
      "color": "blue",
      "isDefault": true,
      "isClosedState": false
    }
  ],
  "customFields": [
    {
      "key": "order_id",
      "label": "Order ID",
      "type": "text",
      "required": false
    },
    {
      "key": "plan",
      "label": "Plan",
      "type": "select",
      "options": ["Free", "Pro", "Enterprise"],
      "required": true
    }
  ],
  "tags": [{ "id": "ckt1a2b3c4d5e6f", "name": "billing" }]
}
```

`customFields` lists whatever an admin has configured at `/admin/custom-fields`
(empty array if none). `type` is one of `text`, `number`, `date`, `checkbox`,
`select`; `options` is only present for `select`.

`tags` is the shared tag pool agents pick from when tagging a ticket
(empty array if none exist yet) — alphabetical, not display-ordered, since
tags have no admin-defined order.

## `POST /api/v1/tickets`

Create a ticket.

**Body** (JSON):

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Customer's name, 2–100 characters |
| `email` | Yes | Customer's email |
| `subject` | Yes | 5–200 characters |
| `description` | Yes | 10–5000 characters (counted after formatting is stripped), see note below |
| `descriptionFormat` | No | `"text"` (default) or `"html"` |
| `category` | Yes | Must match a category slug configured in `/admin/ticket-config` |
| `priority` | No | Must match a priority slug if given; falls back to the platform's default priority |
| `customFields` | No | `{ "<key>": <value> }` map — see below |
| `attachments` | No | Array of base64-encoded files — see below |

> **Attachments.** Send an array of `{ filename, mimeType, data }`, where
> `data` is the raw file content base64-encoded (no `data:` URL prefix —
> just the base64 string). Up to 5 files per ticket, 10 MB each. Allowed
> `mimeType`s: `image/jpeg`, `image/png`, `application/pdf`,
> `application/zip`, `text/plain` — the same limits the customer portal
> itself enforces. More files can be added later via
> `POST /api/v1/tickets/:id/comments`, up to the same 5-per-ticket cap
> (existing attachments count against it).
>
> ```json
> "attachments": [
>   {
>     "filename": "screenshot.png",
>     "mimeType": "image/png",
>     "data": "iVBORw0KGgoAAAANSU..."
>   }
> ]
> ```

> **Custom fields.** Admins can define extra fields at `/admin/custom-fields`
> (text, number, date, checkbox, or select) — fetch `GET /api/v1/config` to
> see what's configured. Send matching values as a flat object keyed by each
> field's `key`: strings for `text`/`date` (date as `YYYY-MM-DD`), a number
> for `number`, `true`/`false` for `checkbox`, and one of the field's
> `options` for `select`. **Required fields are only enforced if you include
> the `customFields` object at all** — omit it entirely and ticket creation
> proceeds without touching custom fields (so adding a required field later
> never breaks an integration that doesn't know about it yet); include it
> and any required field left out returns a `400`.

> **Editor-agnostic by design.** Ticket descriptions are rich text
> internally (same as replies), but you don't need to speak our internal
> format to submit one. Send plain text (the default), or set
> `descriptionFormat: "html"` and send whatever your own editor exports —
> Quill, TipTap, TinyMCE, CKEditor, Lexical, Slate, all of them can export
> HTML. We convert it server-side, safely: your HTML is parsed strictly
> through Docket's own schema, so any tag or attribute it doesn't
> recognize (scripts, event handlers, unknown elements) is simply dropped,
> never stored or trusted as-is. If your form is a plain textarea, just
> send plain text — no conversion needed either way.

```bash
curl -X POST https://support.example.com/api/v1/tickets \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "subject": "Cannot log in",
    "description": "I get an error when I try to sign in.",
    "category": "bug",
    "customFields": { "order_id": "A-1042", "plan": "Pro" }
  }'
```

```js
// Plain text (default) — descriptionFormat omitted
await fetch("https://support.example.com/api/v1/tickets", {
  method: "POST",
  headers: {
    Authorization: "Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Jane Doe",
    email: "jane@example.com",
    subject: "Cannot log in",
    description: "I get an error when I try to sign in.",
    category: "bug",
  }),
});

// HTML from your own editor
await fetch("https://support.example.com/api/v1/tickets", {
  method: "POST",
  headers: {
    Authorization: "Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Jane Doe",
    email: "jane@example.com",
    subject: "Cannot log in",
    description: "<p>I get an error when I try to sign in.</p><p><strong>It started this morning.</strong></p>",
    descriptionFormat: "html",
    category: "bug",
  }),
});
```

**Response** — `201 Created`:

```json
{
  "id": "cku1a2b3c4d5e6f",
  "ticketNumber": 1042,
  "status": "open",
  "portalUrl": "https://support.example.com/ticket/cku1a2b3c4d5e6f?token=..."
}
```

The customer also gets the standard confirmation email, which links to the
same `portalUrl` — they can reply and track the ticket there without any
extra work on your end. Fetch `GET /api/v1/config` to get the current
`category`/`priority` slugs — the set is deployment-specific and
admin-configurable, so don't hardcode it.

> **Your own support page instead of ours.** If this API key has a
> "Customer portal URL" configured (`/admin/api-keys`), `portalUrl` here —
> and every later email link for this ticket (agent replies, closing) —
> points at your own site instead of Docket's built-in `/ticket/:id`
> portal. No response shape change, just a different value.

## Merged tickets

When an agent merges a duplicate ticket into another, the merged ticket's id keeps
working: every `/api/v1/tickets/:id/*` endpoint transparently acts on the ticket it was
merged into. Reads return that ticket — compare the response's `id` with the one you
requested to detect a merge — and replies/status changes land on it. Merged tickets
are left out of `GET /api/v1/tickets?email=`. A reply that races a merge gets a
`409`; retrying it is safe and applies it to the merged ticket. Attachment URLs keep
working after a merge or a split (see below).

## `GET /api/v1/tickets/:id`

Look up a ticket's current status — e.g. to show "In Progress" on your own
site without redirecting to the portal.

```bash
curl https://support.example.com/api/v1/tickets/cku1a2b3c4d5e6f \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response** — `200 OK`:

```json
{
  "id": "cku1a2b3c4d5e6f",
  "ticketNumber": 1042,
  "subject": "Cannot log in",
  "status": "in_progress",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-02T09:15:00.000Z"
}
```

This endpoint also returns `category`, `priority`, `customerName`,
`customerEmail`, `description`/`descriptionHtml`, `attachments`, and
`customFields` (a flat `{ "<key>": <value> }` map, decoded to native JSON
types — number/boolean/string — matching what you'd send on create); they're
omitted above for brevity.

`404` if the ticket doesn't exist. Any active API key can read any ticket
on your instance — there's no per-key scoping, since a self-hosted
deployment belongs to one owner.

## `GET /api/v1/tickets/:id/attachments/:attachmentId`

Download a single attachment's bytes — e.g. to proxy a file the customer or
an agent uploaded through to your own users, without exposing storage keys.
The attachment is matched by its id alone, so a stored URL keeps working after an
agent merges or splits the ticket and the file moves to another ticket. This is the endpoint
every `url` field elsewhere in the API (on `GET /tickets/:id` and
`GET /tickets/:id/comments`) points to.

```bash
curl https://support.example.com/api/v1/tickets/cku1a2b3c4d5e6f/attachments/ckw3c4d5e6f7g8h \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -o screenshot.png
```

**Response** — `200 OK`: the raw file bytes, with `Content-Type` set to the
attachment's stored MIME type and `Content-Disposition: attachment` (so a
browser hitting this URL directly downloads rather than navigates). `404`
if the attachment doesn't exist or the underlying file is missing from storage.

## `GET /api/v1/tickets/:id/comments`

Read the conversation thread — e.g. to show ticket replies on your own
site, not just its status.

```bash
curl https://support.example.com/api/v1/tickets/cku1a2b3c4d5e6f/comments \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response** — `200 OK`:

```json
{
  "comments": [
    {
      "id": "ckv2b3c4d5e6f7g",
      "authorName": "Alex (Support)",
      "authorRole": "agent",
      "content": "Thanks for reaching out — looking into this now.",
      "html": "<p>Thanks for reaching out — looking into this now.</p>",
      "attachments": [],
      "createdAt": "2026-07-01T11:30:00.000Z"
    }
  ]
}
```

Only public replies — internal agent notes are never returned, same rule
the customer portal itself enforces. Replies are stored as rich text
internally (bold, lists, links, etc.) — `content` is that flattened to
plain text; `html` renders the same content with formatting intact, safe
to insert into a page (it's generated from our own stored document, not
arbitrary external HTML — only tags the editor itself can produce ever
come out). Use whichever fits where you're displaying it. `attachments` is
an array of `{ id, filename, fileSize, mimeType, url }` — files uploaded
with that specific reply (`url` points to
`GET /tickets/:id/attachments/:attachmentId`); empty if the reply had
none. `404` if the ticket doesn't exist.

## `POST /api/v1/tickets/:id/comments`

Post a reply on behalf of the ticket's customer — e.g. to let them keep
replying from your own product instead of the portal link. The reply is
bound to whichever email the ticket was created with: `email` must match
exactly, so an integrating backend can only reply as the account that
actually owns the ticket (enforcing which of *your* logged-in users maps to
which ticket is your job, not ours).

**Body** (JSON):

| Field | Required | Notes |
|---|---|---|
| `email` | Yes | Must match the ticket's customer email |
| `content` | Yes | The reply body |
| `contentFormat` | No | `"html"` (default) or `"text"` — note the *opposite* default from ticket creation's `descriptionFormat` |
| `attachments` | No | Same base64 array format as ticket creation, capped at 5 files *total* per ticket (existing attachments count against the cap) |

```bash
curl -X POST https://support.example.com/api/v1/tickets/cku1a2b3c4d5e6f/comments \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "content": "Thanks, that fixed it!",
    "contentFormat": "text"
  }'
```

**Response** — `201 Created`:

```json
{ "id": "ckx4d5e6f7g8h9i" }
```

`400` if `email`/`content` is missing, the JSON body is invalid, an
attachment fails validation, or the ticket is closed (reopen it first via
`PATCH /tickets/:id/status`). `403` if `email` doesn't match the ticket's
customer email. `404` if the ticket doesn't exist. `429` if this key has
posted more than 60 replies in a minute.

## `PATCH /api/v1/tickets/:id/status`

Close or reopen a ticket on behalf of its customer — the same action the
"Close"/"Reopen" button does in the customer portal.

**Body** (JSON):

| Field | Required | Notes |
|---|---|---|
| `email` | Yes | Must match the ticket's customer email |
| `action` | Yes | `"close"` or `"reopen"` |

```bash
curl -X PATCH https://support.example.com/api/v1/tickets/cku1a2b3c4d5e6f/status \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{ "email": "jane@example.com", "action": "close" }'
```

**Response** — `200 OK`:

```json
{ "status": "closed" }
```

`status` is the resulting status slug (the platform's configured
closed/default status — resolve its label via `GET /api/v1/config`).
Closing sends the customer the standard "ticket closed" email. `400` if
`email`/`action` is missing or invalid, or the ticket is already in the
requested state (already closed / not closed). `403` if `email` doesn't
match the ticket's customer email. `404` if the ticket doesn't exist.
`429` if this key has made more than 60 status changes in a minute.

## `GET /api/v1/tickets?email=`

List a customer's tickets, most recent first — e.g. to show "Your Tickets"
on your own site.

| Query param | Required | Notes |
|---|---|---|
| `email` | Yes | Customer email the tickets were created with |
| `page` | No | 1-indexed page number, default `1` |
| `per_page` | No | Results per page, default `50`, max `100` |

```bash
curl "https://support.example.com/api/v1/tickets?email=jane@example.com&page=1&per_page=50" \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response** — `200 OK`:

```json
{
  "tickets": [
    {
      "id": "cku1a2b3c4d5e6f",
      "ticketNumber": 1042,
      "subject": "Cannot log in",
      "status": "in_progress",
      "createdAt": "2026-07-01T10:00:00.000Z",
      "updatedAt": "2026-07-02T09:15:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "perPage": 50,
    "total": 1,
    "totalPages": 1
  }
}
```

`total` is the customer's total ticket count and `totalPages` is
`ceil(total / perPage)` — page through with `page=2`, `page=3`, etc. until
`page >= totalPages`. `400` if `email` is missing, `page` isn't a positive
integer, or `per_page` isn't an integer between 1 and 100. Matches on an
exact, case-sensitive equality against the email the ticket was created
with (same as everywhere else in the app) — an empty `tickets` array just
means no match, not an error.

---

## What's not supported yet

- **Webhooks** — there's no way yet to get notified when an agent replies
  or a ticket's status changes. Poll `GET /api/v1/tickets/:id/comments` if
  you need that today.
- **A client-side/embeddable widget.** The API is designed to be called
  from your backend, not a browser.
- **Deleting or editing** a reply or attachment once posted.
