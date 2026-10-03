# Customer Portal

## Overview

The customer portal is the public-facing side of the support tool. Customers do not create accounts or log in. They submit tickets by providing their name and email, then access their tickets via a secure link sent to their email.

All routes under `/(customer)/` are public — no session required.

---

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page — short intro + "Submit a ticket" CTA |
| `/submit` | Create ticket form |
| `/ticket/{ticketId}` | Ticket detail — requires valid `?token=` query param |
| `/my-tickets` | "Find my tickets" page — enter email to receive links |

---

## 1. Landing Page (`/`)

Simple public page with:
- Product name + one-line description
- "Submit a Support Ticket" button → `/submit`
- "Find My Tickets" link → `/my-tickets`

No authentication prompt. No sidebar. Clean minimal layout.

---

## 2. Create Ticket (`/submit`)

### Form Fields

| Field | Required | Notes |
|-------|----------|-------|
| Full Name | Yes | Customer's name — stored on ticket |
| Email Address | Yes | Used for email notifications and ticket access |
| Subject | Yes | Max 200 characters |
| Description | Yes | Multi-line text. Min 10 characters. |
| Category | Yes | Select: Bug / Issue / Feature Request / Billing / General Query |
| Attachments | No | Up to 5 files — JPG, PNG, PDF, ZIP, TXT — max 10 MB each |

### Submission Flow

1. Customer fills in the form and clicks "Submit Ticket".
2. Client-side validation runs first.
3. Form data is submitted to `POST /api/tickets`.
4. API creates the ticket record and:
   - Generates `customerToken` (cuid2).
   - Enqueues a `ticket.created` email job.
5. Customer is redirected to a success page: `/submit/success?ticket={ticketNumber}`.

### Success Page

- Shows: "Your ticket #1042 has been submitted."
- Shows: "We've sent a confirmation email to jane@example.com with a link to track your ticket."
- Link to submit another ticket.
- No auto-redirect to the ticket detail (they must use the emailed link).

### Validation Rules

| Field | Rules |
|-------|-------|
| Name | Required, 2–100 characters |
| Email | Required, valid email format |
| Subject | Required, 5–200 characters |
| Description | Required, 10–5000 characters |
| Category | Required, must be one of the valid values |
| Attachments | Max 5 files, max 10 MB each, allowed types only |

See [file-uploads.md](./file-uploads.md) for attachment validation details.

---

## 3. Ticket Detail (`/ticket/{ticketId}?token={token}`)

### Access Control

- The `token` query parameter is required.
- Server looks up the ticket by `id` AND `customerToken`. If neither matches, return a 404 page.
- No session is created. Token is validated on each page load.
- If the ticket was **merged** into another (agent action — see [tickets.md § Merge, Split & Link](./tickets.md#merge-split--link)), a valid link redirects to the surviving ticket. Merges are same-customer only, so this never exposes another customer's ticket. Merged tickets are hidden from "My Tickets" and the sibling-ticket list.

### What Customers Can See

- Ticket number, subject, description, category, status, created date, updated date.
- Their name and email (as submitted).
- All **public** comments and replies (customer replies + agent replies).
- All **attachments** on the ticket and on comments.
- Ticket activity (simplified — status changes + new replies only, no internal note events).

### What Customers Cannot See

- Internal notes (`is_internal = true`) — completely hidden.
- The name of the assigned agent (optional — can be shown as "Support Team" only).
- Other customers' tickets.

### Actions Available to Customers

| Action | Condition |
|--------|-----------|
| Reply to ticket | Ticket is `open` or `in_progress` |
| Add attachments with reply | Same as above — up to 5 total on the ticket |
| Close ticket | Ticket is `open` or `in_progress` |
| Reopen ticket | Ticket is `closed` |

### Reply Form

- Rich text editor (Tiptap) with a small toolbar: bold, italic, underline, strike, inline code, bullet/numbered lists, code block, quote. Pasted URLs auto-link. See the **Rich Text (Replies)** convention in `CLAUDE.md`.
- Content is stored as Tiptap JSON and rendered read-only via Tiptap (never raw HTML).
- Optional file attachment (respects the global 5-file limit per ticket).
- Submit button: "Send Reply".
- After submit: the new comment appears inline without a full page reload.

### Close Ticket

- "Close this ticket" button shown when status is `open` or `in_progress`.
- Clicking shows a confirmation dialog: "Are you sure you want to close this ticket? You can reopen it at any time."
- On confirm: status changes to `closed`, activity logged, agent notified (optional — internal notification only, no email to agent).

### Reopen Ticket

- "Reopen ticket" button shown when status is `closed`.
- No confirmation dialog needed (low-risk action).
- Status changes to `open`, activity logged.

---

## 4. My Tickets (`/my-tickets`)

Since customers have no account, this page provides a convenient way to find all their tickets via email.

### Flow

1. Customer enters their email address.
2. Clicks "Send my tickets".
3. If any tickets exist for that email: system sends an email containing links to all non-closed tickets (with `customerToken` in each URL).
4. System always responds: `"If any tickets exist for this email, we've sent you a list."` — same message regardless of whether tickets exist (prevents email enumeration).

### Email Content

- Subject: "Your support tickets"
- Lists all tickets for that email: `#1042 — Login page not loading — Open`
- Each ticket is a clickable link to `/ticket/{ticketId}?token={token}`.
- If no tickets: a brief message saying no active tickets were found.

---

## 5. Error States

| Scenario | Page behavior |
|----------|---------------|
| Invalid or missing token | Show "Ticket not found" page with a link to `/my-tickets` |
| Ticket not found | Same as above |
| Server error on submit | Show inline error in the form — do not redirect |
| File too large | Client-side validation prevents submission, show error |
| Too many attachments | Client-side validation prevents adding more than 5 |

---

## 6. UI Notes

- Customer portal uses a clean, minimal layout — no sidebar, no dashboard chrome.
- Header shows only: product logo/name + "Submit a Ticket" + "Find My Tickets" links.
- No user avatar, no profile menu.
- Status badges use consistent colors (see [design-system.md](./design-system.md)).
- All forms use the `components/ui/*` primitives — never native HTML inputs.
- Mobile-responsive — customers often submit from mobile.

---

## 7. Security

- Customer token is embedded in the URL and stored hashed in the DB (considered a secret).
- Customer can only see their own ticket via the token — enumeration is not possible.
- All customer API responses strip `customerToken` before returning.
- Internal notes are filtered server-side — never client-side only.
- File upload validation is enforced both client-side and server-side.
