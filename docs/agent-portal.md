# Agent Portal

## Overview

The agent portal is where support agents manage tickets. Agents must be authenticated (magic link or Google OAuth). Access is restricted to users with `role: agent` or `role: admin`.

All routes under `/(agent)/` require a valid session.

---

## Routes

| Route | Description |
|-------|-------------|
| `/dashboard` | Stats overview |
| `/tickets` | All tickets list |
| `/tickets/{ticketNumber}` | Ticket detail + management |

---

## 1. Ticket List (`/tickets`)

The main workspace for agents. Shows all tickets across all customers.

### Default View

- Sorted by `updatedAt` descending (most recently active first).
- Paginated — 25 tickets per page.
- Each ticket row shows: ticket number, subject, category badge, status badge, customer name, assigned agent avatar (or "Unassigned"), created date, last updated date.

### Search

- Search input at the top of the list.
- Searches across: ticket number (`#1042`), subject, customer name, customer email.
- Real-time search as the agent types (debounced — 300ms).

### Filters

Agents can filter the list by:

| Filter | Options |
|--------|---------|
| Status | All / Open / In Progress / Closed |
| Category | All / Bug / Issue / Feature Request / Billing / General Query |
| Assigned To | All / Unassigned / Me / [Specific agent] |
| Date Range | Created in last 7 / 30 / 90 days / Custom |

Filters are combinable. Active filters are shown as removable chips above the list.

### Bulk Actions (Admin only)

- Select multiple tickets with checkboxes.
- Bulk assign to an agent.
- Bulk change status.
- Bulk change priority.
- Bulk add a tag (search the shared tag pool or create a new one — same freeform pool as the ticket detail page's tag picker).
- Bulk delete (spam — admin only).

---

## 2. Ticket Detail (`/tickets/{ticketNumber}`)

The full ticket view for agents. Split into two panels:

**Left / Main panel:**
- Ticket subject and description (from customer).
- Full comment thread (all public replies + internal notes — agents see everything).
- Reply form at the bottom.

### Previous / Next Navigation

- ← Previous and Next → buttons in the sticky header let an agent step through tickets one by one without going back to the list — built for queue-processing (e.g. clearing all open, unassigned tickets).
- They move within the **same filtered/sorted result set** the agent opened the ticket from (search, status/category/priority/assignee filters, date range, sort column/order) — not all tickets, and not limited to the current page; the queue continues seamlessly across pagination boundaries.
- The list's filter/sort/page state travels with the ticket link as a query string, so opening a ticket from a filtered list and clicking Next repeatedly keeps applying the same filters. The "All Tickets" breadcrumb link also returns to that same filtered page.
- A button is disabled (not rendered as a link) when there is no previous/next ticket in that result set — e.g. at either end of the queue.
- Implemented as a cheap keyset ("seek") lookup — two single-row queries against `(sortKey, ticketNumber)` — rather than loading the whole filtered list, so it stays fast regardless of how many tickets match. See `lib/tickets-list-query.ts`.

**Right / Sidebar:**
- Ticket information (ID, status, category, created, updated, closed date).
- Customer information (name, email).
- Assigned agent (with "Assign to me" shortcut).
- Activity history (full audit trail).

### Ticket Information Sidebar

| Item | Editable |
|------|----------|
| Ticket # | No |
| Subject | No |
| Category | Yes (agent can change) |
| Status | Yes |
| Assigned Agent | Yes |
| Customer Name | No |
| Customer Email | No |
| Created Date | No |
| Updated Date | No |
| Closed Date | No (auto-set on close) |

### Changing Status

- Dropdown or button group in the sidebar: Open / In Progress / Closed.
- Changing to "Closed" asks for confirmation: "Close this ticket? The customer will be notified."
- Status change logs to activity history and triggers an email notification to the customer (if closing).

### Assigning an Agent

- Dropdown: shows all users with `role: agent` or `role: admin`.
- "Assign to me" shortcut button.
- Assigning logs to activity history.
- Unassign: select "Unassigned" from the dropdown.

### Reply Form (Public Reply)

- Agent composes a message to the customer.
- Rich text editor (Tiptap) — same shared editor and toolbar as the customer reply form. Content is stored as Tiptap JSON and rendered read-only via Tiptap. See the **Rich Text (Replies)** convention in `CLAUDE.md`.
- Can attach files (up to 5 total per ticket).
- Submit button: "Send Reply".
- After submit: appears in the thread, customer receives an email notification (email/notification previews use a plain-text flattening of the reply).

### Reply Drafts

- The composer auto-saves the agent's unsent reply ~1s after they stop typing (and immediately when they leave the page or move to Previous/Next), to `ticket_reply_drafts` via `PUT /api/tickets/{id}/draft`.
- Drafts are **per agent, per ticket** — never visible to other agents or the customer — and follow the agent across browsers/devices. The internal-note mode is saved with the text.
- On returning to the ticket, the draft is restored into the composer. The action bar shows "Saving draft…" / "Draft saved · {time}" / "Couldn't save draft", plus a trash button that discards it (with a confirmation dialog; `DELETE /api/tickets/{id}/draft`).
- Sending the reply deletes the draft server-side (in the comments route). Clearing the composer also deletes it.
- Attachments are not drafted — unsent files only live in the browser tab.
- `/tickets` shows a pencil icon (browser tooltip "Draft — unsent reply saved" on hover) next to the subject of every ticket where the current agent has a saved draft.

### Internal Note

- Toggled via a tab or toggle above the reply form: "Reply" / "Internal Note".
- Internal notes have a visually distinct style (e.g. amber/yellow background, lock icon).
- Never visible to the customer.
- Other agents can see and reply within the internal thread.
- Logged in activity as `internal_note_added`.

### Attachments

- Agents can attach files to their replies (public or internal).
- Existing attachments on the ticket and comments are listed with: filename, size, download link.
- Agents (and admins) can delete any attachment on the ticket.

### Close Ticket

- "Close Ticket" button in the sidebar.
- Confirmation dialog required.
- On confirm: status → `closed`, `closedAt` set, customer notified by email.

### Reopen Ticket

- "Reopen" button shown when status is `closed`.
- No confirmation dialog needed.
- Status → `open`, activity logged.

### Merge & Link

- **Merge into another ticket** (sidebar button) — dialog lists the same customer's other
  open tickets; picking one merges this ticket into it and navigates there. Irreversible.
- **Linked Tickets** (sidebar card) — add a `related_to` / `duplicate_of` / `blocks` link by
  ticket number, or remove one.
- Opening `/tickets/{n}` for a merged ticket redirects to the ticket it was merged into.

Full rules: [tickets.md § Merge & Link](./tickets.md#merge--link).

---

## 3. Activity History

Shown in the sidebar on the ticket detail page (collapsible section at the bottom).

Each event shows:
- Actor name + role
- Action description
- Timestamp

Events visible to agents:
- All events including internal note additions.

Events visible to customers (on the customer portal):
- Status changes, replies only — no internal events.

---

## 4. UI Notes

- Agent portal uses a full sidebar navigation layout.
- Sidebar links: Dashboard, All Tickets, (Admin only: Users).
- Top bar shows: agent name + avatar + sign-out.
- Ticket list uses a table layout on desktop, card layout on mobile.
- Status badges and category badges use consistent colors (see [design-system.md](./design-system.md)).
- All interactive elements use the `components/ui/*` primitives.

---

## 5. Business Rules

1. Agents can see all tickets from all customers.
2. Agents cannot see `customerToken` — it is stripped from all agent-facing API responses.
3. Agents can change status, assign, reply, add internal notes, and close/reopen.
4. Agents cannot delete tickets (admin-only).
5. Agents cannot manage users (admin-only).
6. An agent can assign a ticket to themselves or to any other agent/admin.
7. Sending a reply automatically bumps `ticket.updatedAt`.
8. Closing a ticket triggers a customer email notification.
