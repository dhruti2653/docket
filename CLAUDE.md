# Docket — Claude Code Context

## What this project is

Docket is an open-source, self-hosted customer support ticketing system. Teams deploy it to handle support tickets from customers. Inspired by tools like Freshdesk and Crisp — but fully self-hosted.

Full feature specs live in `docs/`. Read the relevant doc before implementing any feature.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Auth | Better Auth (Admin Plugin + Email/Password + Magic Link + Google OAuth) |
| Styling | Tailwind CSS v4 + daisyUI |
| UI Components | daisyUI component classes (appearance) + Headless UI (behavior) + Floating UI (controlled/collision-aware positioning) + `lib/slot.tsx` (asChild) |
| Icons | Phosphor Icons (`@phosphor-icons/react`) |
| IDs | cuid2 (`@paralleldrive/cuid2`) |
| State | SWR (server) — no Zustand needed |
| Background Jobs | pg-boss |
| Email | Nodemailer (SMTP) via pg-boss queue + react-email templates |
| File Storage | `lib/storage.ts` — `local` (default, needs a Docker volume) / `s3` / `r2` via `STORAGE_DRIVER` |

---

## Project Structure

```
app/
├── (auth)/                ← login for agents/admins (unauthenticated layout)
├── (orbit)/               ← platform admin panel (Better Auth Orbit)
├── (customer)/            ← customer portal (no login — token-gated)
├── (agent)/               ← agent + admin portal (authenticated)
├── (admin)/               ← admin-only pages (authenticated, admin role)
└── api/                   ← API route handlers
components/
├── ui/                    ← UI primitives (daisyUI classes + Headless UI behavior)
└── common/                ← shared app components
config/
├── platform.ts            ← PRODUCT_NAME and other platform constants
db/
├── schema/                ← Drizzle table definitions (one file per domain)
└── migrations/            ← generated SQL migrations
docs/                      ← feature specs (read before implementing)
lib/
├── auth.ts                ← Better Auth server instance
├── auth-client.ts         ← Better Auth client
├── db.ts                  ← Drizzle client singleton
├── storage.ts             ← storage adapter (local / s3 / r2 via STORAGE_DRIVER)
├── email/                 ← email templates + enqueue helper
├── worker/                ← pg-boss queue handlers
└── utils.ts               ← shared utilities
scripts/
├── make-admin.ts          ← promote a user to admin
└── worker.ts              ← worker entry point
```

---

## Key Decisions & Conventions

### Auth — Two Separate Flows

There are two completely separate auth flows in this app:

1. **Agents and Admins** — full Better Auth session via email/password, magic link, or Google OAuth (if configured). Each method is admin-toggleable at runtime (`/admin/appearance`, `platform_settings` table) and enforced server-side in `lib/auth.ts`'s `hooks.before`. Access `/login`. Role stored in `user.role`.
2. **Customers** — no account required. They submit a ticket with name + email. Access their tickets via a secure link emailed to them. No session, no password.

Never redirect customers to the agent login page and vice versa.

### Color System

The entire UI uses 4 brand colors (`bark`, `sand`, `stone`, `cream`) as Tailwind v4 utility classes. They are runtime-overridable via `ThemeProvider` — **do not hardcode hex values anywhere**.

**How it works:**

```css
/* app/globals.css */
@theme inline {
  --color-cream: var(--brand-cream);  /* Tailwind utility points to runtime var */
  --color-sand:  var(--brand-sand);
  --color-stone: var(--brand-stone);
  --color-bark:  var(--brand-bark);
}

:root {
  --brand-cream: #BDDDFC;  /* default palette — ThemeProvider overwrites these */
  --brand-sand:  #88BDF2;
  --brand-stone: #6A89A7;
  --brand-bark:  #384959;
}
```

- `bark` on white = ~8:1 contrast (AAA) — use for all primary text and labels.
- `stone` on cream = ~3:1 — use only for captions and timestamps (never body text or labels).
- Never use semantic colors (red, amber, blue) for layout — only for status badges and errors.

#### Dark mode: use daisyUI-native tokens in the agent/admin UI

Dark mode applies **only to the agent + admin portals** (the customer portal has no `ThemeProvider` and is always light). The raw brand utilities (`bg-cream`, `text-bark`, `bg-white`, `bg-bark`) are **static — they do NOT flip in dark mode**. So in the agent/admin UI (and any shared component used there), build surfaces from **daisyUI-native theme tokens**, which are defined for both modes and equal the brand colors in light:

| Instead of (static) | Use (adapts to dark) |
|---|---|
| `bg-white` | `bg-base-100` (elevated surface — card/popover/modal/menu) |
| `bg-cream` | `bg-base-300` (hover-fill / muted tier) |
| `text-bark` | `text-base-content` |
| `text-stone` | `text-base-content-muted` |
| `border-sand` | `border-base-300` |
| `bg-bark` / `text-cream` (buttons, avatars) | `bg-primary` / `text-primary-content` |
| `ring-bark` | `ring-primary` |
| sidebar chrome | `bg-sidebar`, `text-sidebar-content`, `bg-sidebar-accent`, `border-sidebar-border`, `border-sidebar-primary` |

`base-100`/`base-200`/`base-300` are **neutral across every preset** (default/ocean/forest/sunset/indigo/slate) — brand color lives in `primary`/`secondary`/sidebar, not in the base surface/border tiers, matching how every stock daisyUI theme works. So switching presets recolors buttons, links, the sidebar, and focus rings, but borders and hover-fill backgrounds stay a fixed neutral gray-blue regardless of preset.

- The **customer portal** (`app/(customer)/`) still uses the brand utilities directly — it's light-only, so that's fine.
- **Dark palette** lives in the `.dark` block of `app/globals.css` (`--base-100` elevated < `--base-200` page/body < `--sidebar` darkest; brand accent kept in `--primary`, not grayscaled). Per-preset primary/sidebar overrides live in `DARK_THEME_VARS` in `theme-provider.tsx`.
- `components/ui/*` primitives style from these tokens internally — most call sites never touch token classes directly, only the `variant`/`size` props.

### Theme System

Admins can change the platform color theme and appearance mode (light/dark/auto) from `/admin/appearance`. The selection is persisted to the `platform_settings` DB table and applied at runtime — no CSS recompilation needed.

- **`components/theme/theme-provider.tsx`** — `ThemeProvider` context wraps both `(agent)` and `(admin)` layouts. On mount it reads `localStorage` for instant hydration, then the server-rendered initial props take over. `applyThemeToDOM()` writes `--brand-*` vars + semantic theme tokens (`--primary`, `--sidebar`, etc.) to `document.documentElement.style`.
- **`lib/settings.ts`** — `getPlatformSettings()` reads the single `platform_settings` row (id `"default"`).
- **`app/api/admin/settings/route.ts`** — `GET` (any agent/admin) + `PATCH` (admin only) for theme + appearanceMode.
- **6 presets:** `default`, `ocean`, `forest`, `sunset`, `indigo`, `slate` — each defines both light and dark variant CSS vars.
- **localStorage keys:** `docket_theme`, `docket_appearance` — cached for instant re-hydration without a DB round-trip.
- **Pattern for new themes:** add a new preset object to `LIGHT_THEME_VARS` and `DARK_THEME_VARS` in `theme-provider.tsx`, then add it to the swatch list in `appearance-settings-form.tsx`.

### UI Components

- **Always use the `components/ui/*` primitives** — never reach for radix-ui or shadcn (removed from the project); never build a one-off custom primitive when one of these already covers it.
- Each `components/ui/*` file is hand-maintained (not code-genned). **daisyUI component classes are the primary styling system** — 17 of the 20 primitives carry one (`btn`, `badge`, `card`, `modal-box`, `menu`, `input`, `textarea`, `select`, `table`, `checkbox`, `toggle`, `skeleton`, `divider`, …) and Tailwind is limited to layout plus brand details daisyUI has no opinion about. When touching a primitive, reach for the daisyUI class first, accept its native appearance, and justify any override in a comment.
- Headless UI (`@headlessui/react`) supplies **behavior only** for components that need it (`Dialog`, `Menu`, `Listbox`) — focus trap, roving tabindex, typeahead, ARIA. It is paired *with* daisyUI, not instead of it: menus/listboxes render as real `<ul><li>` trees (`as="ul"`/`as="li"`) so `menu`'s rules apply, and Headless UI's `focus`/`selected` render-prop state is mapped onto daisyUI's own `menu-focus`/`menu-active`/`menu-disabled` classes, because its roving tabindex means `:focus-visible` never fires.
- `Checkbox`/`Switch` use a native `<input type="checkbox">` styled with daisyUI's `checkbox`/`toggle`. Components needing controlled open state Headless UI doesn't support (`Popover`, and `Tooltip`, which Headless UI doesn't ship at all) are built on `@floating-ui/react` with daisyUI-compatible styling. Everywhere else, Headless UI's own `anchor` prop handles positioning.
- `asChild` (Button/Badge/*Trigger wrapping a `Link` or other single child) is backed by the dependency-free `lib/slot.tsx`, not a UI-library Slot.
- Custom components are only acceptable for app-specific composite UI that has no `components/ui/*` equivalent.
- **Icons:** use `@phosphor-icons/react` — not Lucide, not Heroicons.

### Rich Text (Descriptions & Replies)

Ticket **descriptions** (submit form) and **replies** (both customer and agent) use a shared **Tiptap** editor — not a plain `Textarea`.

- **Compose:** `components/common/rich-text-editor.tsx` — editable editor + brand-themed toolbar (bold, italic, underline, strike, inline code, bullet/numbered lists, code block, quote). Pass `tone="warning"` for agent internal notes. Pasted URLs auto-link.
- **Display:** `components/common/rich-text-content.tsx` — renders content **read-only through Tiptap** (`editable: false`). Never render description/reply content as raw HTML — this keeps it XSS-safe by construction, so no sanitizer is needed.
- **Shared config:** `components/common/rich-text-extensions.ts` — one extension set for both, so compose and display always match.
- **Storage:** `tickets.description` and reply `content` (`ticketComments.content`) are both stored as **Tiptap JSON**. Legacy rows may be plain text — every reader tolerates both.
- **Previews/emails/notifications/push:** never send raw JSON to a text context. Flatten with `richTextToPlainText()` from `lib/rich-text.ts`; validate emptiness with `isRichTextEmpty()`.
- **Styling:** rendered rich text uses the scoped `.tiptap-content` styles in `app/globals.css` (brand-aligned) — there is no `@tailwindcss/typography` plugin.
- **Public API:** `POST /api/v1/tickets` accepts `description` as plain text (default) or HTML (`descriptionFormat: "html"`), converted server-side to Tiptap JSON via `textToRichTextJson()`/`htmlToRichTextJson()` in `lib/rich-text.ts` — external callers never need to speak Tiptap's JSON shape directly.

### IDs

- All entity IDs use **cuid2** via `createId()` from `@paralleldrive/cuid2`.
- Never use `crypto.randomUUID()` or `Math.random()`.

### Confirmation Dialogs

- **Never use `window.confirm()`** — always use the `Dialog` from `components/ui/dialog.tsx` with Cancel + destructive action buttons.
- Standard layout: centered icon in a colored circle, bold title, muted description, full-width Cancel + action buttons.

### UI Consistency

- **Border radius:** daisyUI components carry their own (`--radius-box` for cards/modals/skeletons, `--radius-field` for buttons/inputs/selects/menu rows, `--radius-selector` for checkboxes/toggles/badges) — don't re-declare it. For non-primitive containers use daisyUI's `rounded-box`/`rounded-field` utilities so a preset rescales them too.
- **Spacing:** Consistent `p-6` inside cards. Section gaps use `space-y-6`.
- Before shipping UI, verify every interactive element has correct border radius, hover states, and focus rings.

### File Storage

- File storage is via the driver-switched adapter in `lib/storage.ts`,
  selected by `STORAGE_DRIVER`: `local` (default, local disk), `s3`, or `r2`
  (both via [files-sdk](https://files-sdk.dev), dynamically imported only
  when selected). See `docs/file-uploads.md` for required env vars per
  driver — validated at boot in `lib/env.ts`, not on first upload.
- **`storage.url(key)` always returns `/api/files/{key}`, regardless of
  driver** — never a direct/signed cloud URL. Deliberate: keeps it
  synchronous (callers build it inline in `.map()`, not awaited per
  attachment) and keeps ticket-attachment access control in Docket's
  own route. `/api/files/[...key]` calls `storage.download()`,
  which works identically for every driver.
- **`local` driver in Docker:** `./uploads` MUST be a persistent volume or
  every redeploy wipes all files (container filesystem resets from the
  image each time). The compose files pin it to a literal volume name
  (`docket_uploads`), not Compose's default project-derived name —
  some deploy tools (observed with Dokploy) don't keep the compose project
  name stable across redeploys, which silently creates a new empty volume
  and orphans the old one. Cloud drivers (`s3`/`r2`) don't need a volume
  at all. See `docs/file-uploads.md`.
- DB stores the **storage key** (e.g. `tickets/{ticketId}/{uuid}/{filename}`) — never a full URL.
- Always delete the storage file before deleting the DB record.
- Generate serving URLs on demand via `storage.url(key)` — never persist URLs.

### Integration Settings (SMTP, Google OAuth, Pusher, Storage)

- Only `DATABASE_URL`, `APP_SECRET`, and `NEXT_PUBLIC_APP_URL` are true env-only
  requirements. Everything else optional in `lib/env.ts` (SMTP, Google OAuth,
  Pusher Beams/Channels, S3/R2 storage) can instead be set from the setup
  wizard's skippable "Integrations" step or **Admin → Integrations**, backed by
  the single-row `integration_settings` table (`db/schema/integration-settings.ts`).
- **Resolution rule:** `lib/integration-settings.ts` exports one getter per
  integration (`getSmtpSettings()`, `getGoogleOAuthSettings()`,
  `getPusherBeamsSettings()`, `getPushProvider()`, `getWebPushSettings()`,
  `getPusherChannelsSettings()`,
  `getStorageSettings()`, plus `getPusherClientConfig()` for public-only
  browser values). Each: DB value wins per field, env var is the fallback —
  so a value saved via Integrations overrides `.env`, and an install that only
  ever used `.env` sees zero behavior change (its DB row is empty).
- **Secrets** (`smtpPassEncrypted`, `googleClientSecretEncrypted`, etc.) are
  AES-256-GCM encrypted at rest via `lib/crypto.ts` (key derived from
  `APP_SECRET`), decrypted only server-side. `GET /api/admin/integration-settings`
  never returns plaintext secrets — only `has<Field>: boolean`.
- **Applies live (no restart), per-call DB read:** SMTP (`lib/smtp/client.ts`),
  Pusher Channels/Beams server-side (`lib/realtime.ts`, `lib/push.ts` —
  deliberately no permanent client singleton), the push provider switch and
  Web Push VAPID keys (`lib/push.ts` → `lib/web-push.ts`), storage driver
  (`lib/storage.ts`).
- **Push provider:** OS push goes through `publishPushToUsers()` in `lib/push.ts`,
  which dispatches to Pusher Beams or standard Web Push per the admin's choice
  (`integration_settings.push_provider`). Never call Beams or `web-push`
  directly from a route. Both share `public/service-worker.js` (one SW / one
  push subscription per scope). See `docs/in-app-notifications.md`.
- **Google OAuth is the one exception:** `lib/auth.ts` builds `betterAuth()`
  once, synchronously, at module evaluation (`socialProviders` is baked into
  the singleton via a top-level `await getGoogleOAuthSettings()`) — changing
  Google credentials needs an app restart (`docker compose restart app`) to
  take effect, unlike everything else here. See `docs/authentication.md`.
- **`NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER` /
  `NEXT_PUBLIC_PUSHER_BEAMS_INSTANCE_ID`** are the only values that were ever
  genuinely build-time (Next.js inlines `NEXT_PUBLIC_*` into the browser bundle).
  Client code (`lib/pusher-browser.ts`, `components/agent/push-init.tsx`) now
  fetches them at runtime from unauthenticated `GET /api/config/client` instead
  of reading `process.env.NEXT_PUBLIC_*` directly — so Integrations-configured
  Pusher works with the plain published Docker image, no rebuild. `.env`-based
  config for these two still goes through the old build-arg path if you build
  from source (`docker-compose.build.yml`).

### Database

- Drizzle ORM. Schema files in `db/schema/`, migrations in `db/migrations/`.
- All IDs are cuid2 strings.
- All tables have `createdAt` and `updatedAt`.
- Hard deletes are immediate (no soft deletes in MVP).

### API

- REST API under `/api/`.
- Always return `{ error: string }` on failure with the correct HTTP status.
- Never expose internal error messages to the client.
- All agent/admin API routes check session first, return 401 if missing.
- Customer-facing API routes verify ticket access tokens instead of sessions.

### Routing

- Customer portal: `/(customer)/` — no auth guard, token-based ticket access
- Agent portal: `/(agent)/` — requires session with `role: agent` or `role: admin`
- Admin pages: `/(admin)/` — requires session with `role: admin`

---

## Feature Docs (read before implementing)

| Feature | Doc |
|---------|-----|
| Authentication | `docs/authentication.md` |
| Customer Portal | `docs/customer-portal.md` |
| Agent Portal | `docs/agent-portal.md` |
| Admin Portal | `docs/admin-portal.md` |
| Tickets | `docs/tickets.md` |
| Public API | `docs/api.md` |
| Webhooks (outbound) | `docs/webhooks.md` |
| File Uploads | `docs/file-uploads.md` |
| Email Notifications | `docs/email-notifications.md` |
| Permission Model | `docs/permission-model.md` |
| Dashboard | `docs/dashboard.md` |
| Database Schema | `docs/database-schema.md` |
| Design System | `docs/design-system.md` |
| Commands | `docs/commands.md` |
| Backup & Restore | `docs/backup-and-restore.md` |
| In-App Notifications | `docs/in-app-notifications.md` |
| Real-Time Updates | `docs/realtime-updates.md` |
| Deployment & Zammad Migration | `docs/deployment-and-zammad-migration.md` |

---

## Project Status

The product is feature-complete for its intended scope. The phased build plan
(`docs/development-plan.md`) and the internal per-feature plans (`docs/plans/`) were
removed when the repo went public — they were build-time artifacts describing work that
is now done, and 91 unchecked checkboxes read as "nothing is built" to anyone arriving
fresh. Known remaining gaps live in the **Roadmap** section of `README.md`.

For new work: read the relevant `docs/` spec above before implementing, and update it in
the same PR if behavior changes.

---

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`: `pnpm docs:check`,
`pnpm typecheck`, `pnpm lint`, `pnpm build`, plus a job that applies migrations against a
real Postgres and fails if `db/schema/` changed without a generated migration. Run all of
them locally before pushing.

`pnpm docs:check` runs first, before `pnpm install`, because it is dependency-free and a
stale README should not wait behind a full Next build. The `README.md` region between
`<!-- BEGIN GENERATED: image-tags -->` and its `END` marker is generated from the `version`
in `package.json` by `scripts/sync-readme.mjs` — **do not edit it by hand**; bump the
version and run `pnpm docs:sync`. It exists because the README advertised a `1` / `1.4` /
`1.4.2` tag ladder while 0.1.0 was the only release that had ever shipped.

`.github/workflows/release.yml` runs **after `ci.yml` succeeds on `main`** (a `workflow_run`
trigger, not `push`), so the two never run concurrently and a red CI publishes nothing. It
builds and pushes multi-arch images to GitHub Packages (`ghcr.io/<owner>/docket`), and when
the `version` in `package.json` has no matching git tag yet, it also creates the tag and the
GitHub Release with notes taken from `CHANGELOG.md`. GitHub is the only service involved;
`GITHUB_TOKEN` is the only credential. Releasing is therefore: bump the version, add the
changelog section, push. It deliberately
does **not** pass `NEXT_PUBLIC_PUSHER_*` build args — those inline into the browser bundle,
so baking them into a public image would leak them to every user.

Two traps when editing `release.yml`, both documented in `docs/releasing.md`: bare
`github.sha` is wrong under `workflow_run` (use `github.event.workflow_run.head_sha`), and
the image name must be lowercased before use — `github.repository` keeps the org's original
casing and registries reject capitals.
