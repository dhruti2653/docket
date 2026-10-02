# Docket v2 — Shortlisted Features

A short list taken from `v2-roadmap.md`. Each item has a one- or two-line summary.
Effort: **S** ≈ days, **M** ≈ 1–2 weeks, **L** ≈ 3+ weeks.

---

### 1. Business hours + SLA — `M`
SLA code already exists but was switched off because it counts every minute, including nights and weekends.
Adding a `business_hours` table (timezone, weekly hours, holidays) lets us turn SLA back on so deadlines only count working time.

### 2. Satisfaction ratings (CSAT) — `S–M`
When a ticket closes, the customer gets an email asking them to rate it (👍/👎 or 1–5) with an optional comment, using a token link so no login is needed.
Ratings appear on the ticket, in a new report, and as a score for each agent. This is our first measure of whether support actually helped.

### 3. Merge / split / link tickets — `M`
**Merge** combines duplicate tickets into one, and the old portal link still works. **Split** turns one comment into its own ticket. **Link** connects related tickets (duplicate-of, related-to, blocks).
Most important once inbound email ships, since email is where most duplicates come from.

### 4. Snooze / follow-up reminders — `S`
Agents can hide a ticket until a set date ("snooze until Tuesday") or get a reminder if the customer hasn't replied in N days.
It needs only a timestamp column, a queue filter and a pg-boss recurring job. It's cheap and agents would use it every day.

### 5. Full-text search — `M`
Search today only does substring matching on a few columns. A Postgres `tsvector` column with a GIN index over subject, description and comments makes search fast and relevant.
Comments are stored as Tiptap JSON, so they need converting to plain text first (`richTextToPlainText()` or a stored plain-text column).

### 6. Saved views — `S–M`
Named filter sets that can be shared, such as "My team's unassigned high-priority". This is the screen agents would work from all day.
Works best together with full-text search and teams.

### 7. Customer organizations — `M`
Group customers into companies automatically by email domain (`@acme.com` → Acme), with ticket history per organization and org-level fields like plan tier.
An optional shared org inbox must be opt-in for each organization, because it changes who can see which tickets.

### 8. GDPR export / data retention — `M`
Add "export everything about this customer" and "delete this customer and all their tickets", plus retention rules for closed tickets and the audit log.
EU-facing teams often ask about this before they buy.

### 9. Internationalization (i18n) — `L`
There's no i18n layer today, so every string is hard-coded in English. That stops non-English teams from adopting Docket.
Do it in stages: translate the customer-facing parts first (submit form, portal, emails), then the agent UI.

---

## Summary

| # | Feature | Effort | Why it matters |
|---|---------|--------|----------------|
| 1 | Business hours + SLA | M | Turns back on SLA code we already wrote |
| 2 | CSAT | S–M | The only measure of outcome, not just volume |
| 3 | Merge / split / link | M | Handles duplicate tickets |
| 4 | Snooze / reminders | S | Cheapest daily-use improvement |
| 5 | Full-text search | M | Search is substring-only today |
| 6 | Saved views | S–M | Agents' everyday working screen |
| 7 | Customer organizations | M | Needed for any B2B use |
| 8 | GDPR export / retention | M | Comes up when EU teams evaluate Docket |
| 9 | Internationalization | L | Blocks every non-English team |
