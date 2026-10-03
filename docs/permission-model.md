# Permission Model

## Overview

Docket uses three roles. Customers are not users in the system — they are identified by email only and access tickets via tokens.

---

## Roles

| Role | Auth Required | How Assigned |
|------|---------------|--------------|
| Customer | No (token-gated) | Anyone submitting a ticket |
| Agent | Yes | Admin assigns via `/admin/users` |
| Admin | Yes | CLI (`pnpm make:admin`) or admin panel |

---

## Permission Matrix

| Action | Customer | Agent | Admin |
|--------|----------|-------|-------|
| Submit a ticket | Yes | — | — |
| View own tickets (via token) | Yes | — | — |
| Reply on own ticket | Yes | — | — |
| Close own ticket | Yes | — | — |
| Reopen own ticket | Yes | — | — |
| View all tickets | No | Yes | Yes |
| Search & filter tickets | No | Yes | Yes |
| View ticket details (any) | No | Yes | Yes |
| Reply to any ticket (public) | No | Yes | Yes |
| Add internal note | No | Yes | Yes |
| Assign ticket to agent | No | Yes | Yes |
| Change ticket status | No | Yes | Yes |
| Close any ticket | No | Yes | Yes |
| Reopen any ticket | No | Yes | Yes |
| Merge / split / link tickets | No | Yes | Yes |
| Delete ticket (spam) | No | No | Yes |
| View all users | No | No | Yes |
| Assign user role | No | No | Yes |
| Deactivate / reactivate user | No | No | Yes |
| Delete user permanently | No | No | Yes |
| Access Orbit panel | No | No | Yes |
| Manage API keys (`/admin/api-keys`) | No | No | Yes |

---

## Customer Isolation Rules

These rules must be enforced server-side — never client-side only:

1. A customer can **only access tickets that match their `customerToken`** — never by ticket ID alone.
2. A customer can **never see another customer's tickets** — even if they know the ticket ID.
3. A customer can **never see internal notes** (`is_internal = true`) — stripped from all customer API responses.
4. The `customerToken` field is **never returned** in any agent-facing or customer-listing API response.
5. The "my tickets" email only sends links for the **requesting email address** — never cross-customer.

---

## API Enforcement

### Customer Routes

Customer-facing API routes do not use Better Auth sessions. They verify the `customerToken`:

```typescript
// All customer-mutating routes require token verification
const ticket = await db.query.tickets.findFirst({
  where: and(
    eq(tickets.id, params.ticketId),
    eq(tickets.customerToken, token)
  )
})
if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })
```

Return `404` (not `403`) when a token mismatch occurs — do not reveal that the ticket exists.

### Agent Routes

```typescript
const session = await auth.api.getSession({ headers: await headers() })
if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
if (!['agent', 'admin'].includes(session.user.role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### Admin-Only Routes

```typescript
if (session.user.role !== 'admin') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### Public API Routes (`app/api/v1/*`)

A fourth identity type, alongside the three above — an external caller
authenticated with an API key instead of a session or a customer token.
Managed by admins at `/admin/api-keys`; see `docs/api.md` for the API
itself. `requireApiKey()` (`lib/api-auth.ts`) verifies a hashed, non-revoked
key from the `Authorization: Bearer` header:

```typescript
const apiKey = await requireApiKey(request) // throws a 401 Response on failure
```

An active key can create tickets and read any ticket's status on this
instance — there's no per-key scoping (single-tenant, self-hosted: every
key belongs to the same instance owner). Revoking a key takes effect on
its very next request, no redeploy required.

---

## Middleware

A Next.js middleware at `middleware.ts` enforces route protection:

| Path pattern | Guard |
|-------------|-------|
| `/submit`, `/ticket/*`, `/my-tickets` | Public — no redirect |
| `/login` | Redirect to `/dashboard` if session exists |
| `/dashboard/*`, `/tickets/*` | Redirect to `/login` if no session or wrong role |
| `/admin/*` | Redirect to `/dashboard` if not admin |
| `/orbit/*` | Redirect to `/dashboard` if not admin |

Middleware only handles redirects — it does not enforce data access. All data-level checks are in the API routes.

---

## Data Visibility Summary

| Data | Customer (own) | Customer (other) | Agent | Admin |
|------|---------------|-----------------|-------|-------|
| Ticket details | Visible | Never | Visible | Visible |
| Public comments | Visible | Never | Visible | Visible |
| Internal notes | Never | Never | Visible | Visible |
| Customer token | Never via API | Never | Never | Never |
| Customer email | Their own only | Never | Visible | Visible |
| Agent name | "Support Team" | — | Visible | Visible |
| Activity history | Simplified | Never | Full | Full |
