<div align="center">

# Docket

**Customer support software you host yourself.**

People write to you when something goes wrong. Docket puts every one of those messages in
one place, so nothing slips through and your whole team can see what is happening. It runs
on your own server, which means your customers' messages stay with you.

[![CI](https://github.com/stack256org/docket/actions/workflows/ci.yml/badge.svg)](https://github.com/stack256org/docket/actions/workflows/ci.yml)
[![Release](https://github.com/stack256org/docket/actions/workflows/release.yml/badge.svg)](https://github.com/stack256org/docket/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Quick Start](#quick-start) · [Running it](#running-it-with-docker) · [Public API](#public-api) · [Docs](docs/)

</div>

---

## Screenshots

**The queue.** Search, filter and sort every request. The reply timer stops while you are
waiting on the customer, so their delay is not counted against you.

![The list of customer requests in Docket](docs/images/agent-tickets.png)

**A conversation.** The customer's messages and your team's private notes in one thread.
Notes are amber, clearly marked, and never sent to the customer.

![A request with a private note visible only to the team](docs/images/agent-ticket-detail.png)

<table>
<tr>
<td width="50%" valign="top">

**How busy things are right now**

<img src="docs/images/agent-dashboard.png" alt="Docket's overview screen">

</td>
<td width="50%" valign="top">

**What the customer fills in. No account needed.**

<img src="docs/images/customer-submit.png" alt="The form a customer uses to send a request">

</td>
</tr>
</table>

**Settings.** Name the stages, categories and priorities to match how you work. Changes
apply straight away, with no rebuild.

![The screen for editing stages and categories](docs/images/admin-ticket-config.png)

<sub>Team screens shown in dark mode. The customer side is light only, by design. Both
palettes and six colour presets are switchable in `/admin/appearance`.</sub>

---

## Contents

- [What you get](#what-you-get)
- [Two ways to use it](#two-ways-to-use-it)
- [Built with](#built-with)
- [Quick start](#quick-start)
- [Settings](#settings)
- [Running it with Docker](#running-it-with-docker)
- [Deploying somewhere else](#deploying-somewhere-else)
- [Public API](#public-api)
- [Health checks](#health-checks)
- [Backups](#backups)
- [Roles](#roles)
- [Moving from Zammad](#moving-from-zammad)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Licence](#licence)

---

## What you get

**For your customers**

- **No account and no password.** They send a request with their name and email, and get a
  private link by email to read replies, add files, or say it is sorted. Nothing to sign up
  for is the single biggest reason people give up on support portals.
- **Formatted replies and attachments.** JPG, PNG, PDF, ZIP and TXT up to 10 MB, five per
  request.
- **Their own history**, reachable from the same emailed link.

**For your team**

- **A queue** you can search, filter, sort and act on in bulk.
- **Private notes** that sit in the conversation but never reach the customer.
- **Saved replies** for the answers you send twenty times a week.
- **Assignment**, plus stages, priorities, categories and tags you name yourself.
- **An overview screen** with open, in progress and closed counts and average waiting time.
- **A notification bell** out of the box. Optionally, notifications that reach you even
  with the app closed, and lists that update without a refresh.

**For whoever runs it**

- **User management.** Invite people, set roles, suspend and remove accounts.
- **Reply targets** per priority, with the clock pausing while you wait on the customer.
- **Reports.** Who answered what, how long it took, and what people ask about most, with
  a spreadsheet download.
- **A record of every change**, both an admin audit log and a per-request history.
- **A REST API** so you can take requests from a form on your own website. See
  [Public API](#public-api).
- **Outgoing notifications** to your other systems when something happens.
- **Email that keeps trying** rather than quietly dropping a message when your mail
  provider has a bad day.
- **Files on your own server**, or in S3 or Cloudflare R2. One setting.
- **An importer** for moving in from Zammad.
- **A first-run setup wizard**, sensible defaults, and rate limiting on the public form
  that survives a restart.

---

## Two ways to use it

There are two ways to get requests into Docket, and they are not mutually exclusive — use
either one, or both.

1. **Docket's own form.** Send customers to `/` on your install. No integration work: they
   fill it in, submit, and get a private link by email to follow the reply. This is what
   you get the moment you deploy Docket, described in [What you get](#what-you-get) above.
2. **Your own website, through the API.** Keep your existing "Contact support" page and
   have it call Docket's REST API instead of Docket's form. Docket still creates the
   request, sends the emails, and hosts the customer's reply page — your site just sends
   the initial request and, optionally, reads status back. See [Public API](#public-api).

Either way, requests land in the same queue and your team replies the same way.

---

## Built with

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| Database access | Drizzle ORM |
| Sign-in | Better Auth (password, magic link, Google) |
| Styling | Tailwind CSS v4, daisyUI, and Headless UI |
| Email | Nodemailer over SMTP |
| Background jobs | pg-boss |
| File storage | Local disk, S3, or Cloudflare R2 |

---

## Quick start

### Run it

**You need:** Docker, and nothing else. No Node.js, no PostgreSQL, no build step. The
image is prebuilt and PostgreSQL comes with it.

Check you have a recent Docker with `docker compose version`. The commands below use
`docker compose` (a space), which is Compose v2. If your machine only has the older
`docker-compose` (a hyphen), update Docker first.

**1. Get the two files.**

```bash
curl -O https://raw.githubusercontent.com/stack256org/docket/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/stack256org/docket/main/.env.docker.example
```

**2. Open `.env` and set two things.** Everything else has a working default.

| Setting | What to put |
|---------|-------------|
| `APP_SECRET` | 32 or more random characters. `openssl rand -base64 36` generates one. |
| `NEXT_PUBLIC_APP_URL` | The web address people will use, for example `https://support.yourco.com`. Keep `http://localhost:3000` while trying it out. |

**3. Start it.**

```bash
docker compose up -d
```

This downloads `ghcr.io/stack256org/docket` from
[GitHub Packages](https://github.com/stack256org/docket/pkgs/container/docket), then starts
PostgreSQL, prepares the database, and leaves the app and the worker running. The first
run takes a minute or two while the image downloads.

Port 3000 already taken? Use `HOST_PORT=8080 docker compose up -d`. Use `HOST_PORT`, never
`PORT`, for the reason explained under [Updating](#updating).

**4. Open your app's URL** — `http://localhost:3000` by default, or
`http://localhost:8080` (or whatever port you chose) if you set `HOST_PORT` above. With
no admin account yet, this lands you on the setup wizard automatically — it walks you
through creating your login and, optionally, email and storage integrations. Your
customers' form is at `/`, and you sign in afterward at `/login`.

Prefer the command line, or scripting the install? Skip the wizard's account step with:

```bash
docker compose run --rm app \
  pnpm create:admin you@example.com "Your Name" "a-strong-password"
```

That is the whole install. Useful next commands:

```bash
docker compose logs -f worker   # watch email being sent
docker compose pull             # get the newest version
docker compose down             # stop it. Your data stays.
```

No email server configured yet? Every outgoing message, including sign-in links and the
links customers use to follow their request, is written to the worker log instead of
sent. That is enough to try the whole product before setting up SMTP.

### Work on it

For local development without Docker.

**You will need:** Node.js 22 or newer, pnpm 11 or newer, and PostgreSQL 16 or newer. If
you would rather not install Postgres, `pnpm db:local` starts a bundled one.

```bash
git clone https://github.com/stack256org/docket
cd docket
pnpm install
cp .env.example .env
```

Set `APP_SECRET` (32 or more characters) and `NEXT_PUBLIC_APP_URL` in `.env`. SMTP is
optional. `DATABASE_URL` is already filled in to match the bundled Postgres, so leave it
alone unless you are pointing at your own.

```bash
pnpm db:local                 # optional: start the bundled Postgres on :5432
pnpm setup                    # create the tables and add default stages and categories
pnpm dev                      # runs the app and the background worker together
```

Open your app's URL, for example `http://localhost:3000` — with no admin account yet,
this lands you on the setup wizard automatically to create your login.

Prefer the command line?

```bash
pnpm create:admin you@example.com "Your Name" "a-strong-password"
```

The password lets you sign in straight away with no email set up. Leave it off to create
a magic-link-only account instead.

> **While developing,** every outgoing email is printed to the worker console, so you can
> click sign-in and customer links without configuring SMTP.

---

## Settings

Only three settings are environment variables — everything else (email, sign-in,
notifications, file storage) can be set from inside the app instead: the setup wizard's
skippable "Integrations" step, or **Admin → Integrations** afterward. Prefer env vars
anyway (CI, a secrets manager, Kubernetes)? Every one below still works exactly as
before — a value saved in Integrations just takes priority over its matching env var.
The full annotated list is in [`.env.example`](.env.example) and
[`.env.docker.example`](.env.docker.example).

**Required**

| Variable | What it is |
|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_SECRET` | Random secret used to sign sessions. 32 characters minimum. |
| `NEXT_PUBLIC_APP_URL` | The public web address of your install, for example `https://support.yourco.com`. Every email link is built from it. |

**Email (optional)**

| Variable | What it is |
|----------|------------|
| `SMTP_HOST` | Mail server hostname. Leave it out and emails are written to the log instead of sent. |
| `SMTP_PORT` | Mail server port. Defaults to 587. |
| `SMTP_USER` / `SMTP_PASS` | Mail server credentials |
| `EMAIL_FROM` | The address outgoing email comes from |
| `EMAIL_WEBHOOK_SECRET` | Shared secret, if your mail provider reports delivery results back |

**Sign-in (optional)**

| Variable | What it is |
|----------|------------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Turns on the "Continue with Google" button. Saved from Integrations instead? It needs an app restart (`docker compose restart app`) before sign-in picks it up — every other setting on this page applies immediately. |

**Notifications (optional)**

| Variable | What it is |
|----------|------------|
| `PUSH_PROVIDER` | Which service sends notifications that reach your team even with the app closed: `pusher` (default) or `webpush`. Easier to pick from Admin → Integrations → Push Notifications. |
| `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` | Keys for `webpush`, the browser's built-in push. Needs no outside account; Integrations can generate the keys for you. |
| `NEXT_PUBLIC_PUSHER_BEAMS_INSTANCE_ID`, `PUSHER_BEAMS_SECRET_KEY` | Credentials for `pusher`, which sends through Pusher Beams |
| `PUSHER_APP_ID`, `NEXT_PUBLIC_PUSHER_KEY`, `PUSHER_SECRET`, `NEXT_PUBLIC_PUSHER_CLUSTER` | Lists and open requests that update without a refresh. A different Pusher product from the one above, so create a separate app for it. |

Without any of these, your team still gets the in-app notification bell and the pages
still work normally. See [docs/in-app-notifications.md](docs/in-app-notifications.md) and
[docs/realtime-updates.md](docs/realtime-updates.md).

> Set these from Integrations and they apply immediately — no rebuild, works with the
> plain downloaded image. The three `NEXT_PUBLIC_*` env vars above are the one case that
> still needs a rebuild to change: they're compiled into the browser code when the image
> is built, and the published image ships with them empty (baking one operator's keys
> into a public image would hand them to everyone who downloads it). Only relevant if you
> specifically want env-based config instead of Integrations.

**File storage (optional)**

| Variable | What it is |
|----------|------------|
| `STORAGE_DRIVER` | `local` (default), `s3`, or `r2` |
| `S3_BUCKET`, `S3_REGION` | Required when `STORAGE_DRIVER=s3`. Credentials come from Integrations, or fall back to the normal AWS chain: environment variables, an IAM role, or a shared profile. |
| `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Required when `STORAGE_DRIVER=r2` |
| `STORAGE_PUBLIC_BASE_URL` | Only needed if some other tool reads your bucket directly. Docket never needs it. |

> **On the default `local` setting,** attachments go to `./uploads`. In Docker that has to
> be a permanent volume or every update wipes them. The supplied compose files already set
> one up. S3 and R2 need no volume. Settings for whichever option you pick are checked the
> first time storage is actually used rather than at startup. See
> [docs/file-uploads.md](docs/file-uploads.md).

---

## Running it with Docker

Three compose files. Pick **one**. They are alternatives, never used together.

| File | Use it when | Where the image comes from |
|------|-------------|----------------------------|
| `docker-compose.yml` | **Almost everyone.** PostgreSQL included. | Downloaded, prebuilt |
| `docker-compose.external-db.yml` | You already have PostgreSQL, such as Neon, Supabase or RDS. | Downloaded, prebuilt |
| `docker-compose.build.yml` | You changed the code. | Compiled on your machine |

All three run the same three parts, chosen by the command each is given: the **app**, the
**worker** that sends email and runs background jobs (nothing sends without it), and a
one-off **migrate** step that prepares the database before the other two start.

### The normal way

```bash
curl -O https://raw.githubusercontent.com/stack256org/docket/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/stack256org/docket/main/.env.docker.example
# Set APP_SECRET and NEXT_PUBLIC_APP_URL. DATABASE_URL is already filled in.
docker compose up -d
```

<!-- BEGIN GENERATED: image-tags -->
Pin a version in production, because `latest` moves with every release:

```bash
IMAGE_TAG=0.5.0 docker compose up -d
```

Available tags are `latest`, the `0` / `0.5` / `0.5.0` ladder, `main` (rebuilt on
every change, expect rough edges), and a fixed `sha-<short>` per build. Each carries builds
for both Intel and ARM machines:

```bash
docker pull ghcr.io/stack256org/docket:0.5.0
```
<!-- END GENERATED: image-tags -->

<sub>The block above is generated from the `version` in `package.json` by
`scripts/sync-readme.mjs`, and CI fails if it drifts. Run `pnpm docs:sync` after a version
bump rather than editing it by hand.</sub>

Images come from [GitHub Packages](https://github.com/stack256org/docket/pkgs/container/docket).
No account is needed to download them, and there are no rate limits.

### With your own database

Same as above but with no bundled PostgreSQL, so you point it at yours.

```bash
curl -O https://raw.githubusercontent.com/stack256org/docket/main/docker-compose.external-db.yml
curl -o .env https://raw.githubusercontent.com/stack256org/docket/main/.env.docker.example
# Replace DATABASE_URL with your own connection string.
docker compose -f docker-compose.external-db.yml up -d
```

### Building it yourself

Only if you changed the code, or you need the optional Pusher features, whose settings
are compiled into the browser code and so cannot come from a shared prebuilt image. This
compiles the whole app, which on a small server is slow.

```bash
git clone https://github.com/stack256org/docket && cd docket
cp .env.docker.example .env
# Set APP_SECRET and NEXT_PUBLIC_APP_URL.
docker compose -f docker-compose.build.yml up -d
```

If you used one of the other two files, add the same `-f <file>` to every `docker compose`
command from here on. For example `docker compose -f docker-compose.external-db.yml logs -f app`.

### Day-to-day

```bash
docker compose logs -f app worker     # watch what it is doing
docker compose down                   # stop it. Your data stays.
```

Opening the app creates your first login through the `/setup` wizard, same as in
[Quick start](#quick-start). Prefer doing it as a separate, deliberate step so you see
whether it worked instead of it failing quietly inside a background service? Use the CLI
instead:

```bash
docker compose run --rm app pnpm create:admin you@example.com "Your Name" "a-strong-password"
```

Leave the password off to create a magic-link-only account, which needs email set up.

**Turning on the optional Pusher features** means building from source. Put every
`PUSHER_*` value in `.env` and run `docker compose -f docker-compose.build.yml build`
then `docker compose -f docker-compose.build.yml up -d`. The compose file passes them
through automatically. Because those values are compiled in, changing one later needs the same
build step again. Restarting is not enough.

### Where your data lives

Two things hold state, and both sit on named Docker volumes:

| Volume | Mounted at | Holds |
|--------|-----------|-------|
| `docket_pgdata` | `/var/lib/postgresql/data` | Everything: requests, replies, people, sessions, API keys, settings, the audit log, and the job queue |
| `docket_uploads` | `/app/uploads` | Attachments, on the default `local` storage setting only |

Nothing else on disk matters. Attachments are written through
[`lib/storage.ts`](lib/storage.ts); everything else in the container is part of the image
and is replaced when you update. On S3 or R2 the uploads volume is unnecessary, because
attachments live in your bucket.

These volumes **survive** `down`, `pull`, `build`, `up -d` and replacing the image.
Container filesystems are thrown away on all of those; the volumes are not. Only
`docker compose down -v`, or removing the volume by hand, destroys them.

Two details make that reliable rather than lucky:

- **The volume names are fixed literally**, instead of being derived from the compose
  project name. Some deployment tools do not keep that name stable, which quietly creates
  a new empty volume and leaves the old one orphaned. The data is not deleted, just
  invisible to the new container.
- **`PGDATA` is set explicitly.** The official Postgres image changed its default data
  directory in version 18. Left to the default, a future version bump would mount the
  volume at the wrong path and the database would start up empty.

### Updating

```bash
docker compose pull
docker compose up -d
```

The `migrate` step applies any database changes before the app and worker come back. It
is safe to run repeatedly: on an existing database it applies only what is new rather
than duplicating anything. Your data carries over untouched.

Back up first anyway, and check [CHANGELOG.md](CHANGELOG.md) for anything needing manual
work. [docs/backup-and-restore.md](docs/backup-and-restore.md) has the commands.

> **To change the port,** use `HOST_PORT=8080`, not `PORT`. Compose passes every value in
> `.env` into the container, and the app reads `PORT`, so setting that would move the port
> inside the container too and break both the mapping and the health check. The compose
> files fix the internal port at 3000 to prevent it.

---

## Deploying somewhere else

### Anything that runs a container

Coolify, Dokploy, CapRover, Portainer, Kubernetes, Docker Swarm, ECS. Point them at
`ghcr.io/stack256org/docket` and run three services from the same image:

| Service | Command | Notes |
|---------|---------|-------|
| app | `pnpm start` | Serves on port 3000. Probe `GET /api/health`. |
| worker | `pnpm worker:start` | No web port. **Email does not send without it.** |
| migrate | `pnpm setup` | Run once, to completion, before the other two on each deploy. |

On the default `local` storage setting, mount a permanent volume at `/app/uploads`. S3
and R2 need none.

### Railway, Render, Fly.io

1. Fork this repository.
2. Create a project pointing at your fork.
3. Set the required settings.
4. Add a PostgreSQL add-on.
5. Deploy.

The same caveat applies as for any container platform: you need the **worker** as a second
service and a one-off **migrate** step, not just the web process.

### A plain server

1. Install Node.js 22, PostgreSQL 16 and pnpm.
2. Clone the repository, run `pnpm install`, and set up `.env`.
3. Build and prepare it:
   ```bash
   pnpm build
   pnpm setup
   pnpm create:admin you@example.com "Your Name" "a-strong-password"
   ```
4. Keep **two** processes running, with systemd, PM2 or similar:
   ```bash
   pnpm start            # the app on :3000
   pnpm worker:start     # the background worker for email and jobs
   ```
5. Put Nginx or Caddy in front for HTTPS, forwarding to `:3000`.

---

## Public API

Rather than sending customers to Docket's own form, your website can create and read
requests directly. You build the "Contact support" form on your own site, and Docket
handles the request, the emails and the customer's reply page behind the scenes.

1. Create a key at `/admin/api-keys`. Admin only, and it is shown once, so copy it there
   and then.
2. Call the API from **your server, not the browser**. A key used in browser code is
   visible to anyone who opens developer tools.

```bash
curl -X POST https://support.yourco.com/api/v1/tickets \
  -H "Authorization: Bearer dk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "subject": "Cannot log in",
    "description": "I get an error when I try to sign in.",
    "category": "bug"
  }'
```

The reply includes a `portalUrl`. The customer is emailed the same link, so they can
follow the request without any extra work on your side.

Also available: `GET /api/v1/config` for the valid category, priority and custom field
names, `GET /api/v1/tickets/:id` to check a status, `GET /api/v1/tickets/:id/comments`
for the conversation, and `GET /api/v1/tickets?email=` for one customer's history. That
is enough to build both a "send a request" and a "my requests" page on your own site. The
limit is 100 requests a minute per key.

There is a browsable API reference with a built-in test client at `/admin/api-keys/docs`,
and a downloadable OpenAPI file at `GET /api/admin/api-keys/openapi` for Postman and
similar. Full details and current limits are in [docs/api.md](docs/api.md).

---

## Health checks

`GET /api/health` needs no authentication and reports whether the app can reach its
database:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"ok","version":"1.0.0"}
```

It returns `503` with `"database":"unreachable"` when the database is down, so load
balancers and uptime monitors can use it directly. The reason for a failure goes to the
server log, never into the response. `version` tells you which build a container is
running, or `dev` for a local build.

The Docker image uses this as its own health check, so `docker compose ps` reports real
health without you configuring anything. The worker turns it off, since it is a job runner
rather than a web server.

---

## Backups

Backups are not automatic. You need to set them up.

Always back up the **Postgres database**. Also back up the **`docket_uploads`
volume** if you are using local file storage, which you do not need on S3 or R2.
[docs/backup-and-restore.md](docs/backup-and-restore.md) has the commands, a scheduled
example, and full recovery steps.

---

## Roles

| Role | How someone gets it |
|------|---------------------|
| Customer | No account needed. They use the public form. |
| Agent | An admin assigns it in the admin area. |
| Admin | Promoted by another admin, or from the command line. |

To promote someone from the command line:

```bash
# Docker
docker compose run --rm app pnpm make:admin them@example.com

# Running from source
pnpm make:admin them@example.com
```

---

## Moving from Zammad

Two one-off scripts. Both are safe to run more than once: already-imported data is skipped
rather than duplicated. Run the people first, so replies and assignments connect to a real
account by email address.

```bash
# 1) People. Creates an account for every Zammad agent and admin.
MIGRATION_USER_PASSWORD="$(openssl rand -base64 24)" \
ZAMMAD_BASE_URL=... ZAMMAD_API_TOKEN=... pnpm migrate:zammad:users

# 2) Requests, replies, attachments, tags, and who each one is assigned to.
ZAMMAD_BASE_URL=... ZAMMAD_API_TOKEN=... pnpm migrate:zammad
```

`MIGRATION_USER_PASSWORD` is required and has no default. Every account the script creates
shares it until each person changes it, so it has to be something you generate. Tell the
team to change it after their first sign-in.

Ran them the other way round? Run the people script again afterwards. It re-checks
everything already imported and fills in what is still missing, which is the fix if
imported requests show up as unassigned.

Both accept `MIGRATION_DRY_RUN=1` to preview without writing anything, and
`MIGRATION_LIMIT` to work through it in batches.

The commands above assume you are running from source. On Docker, put them through the
app container so they reach your database and your attachments volume:

```bash
docker compose run --rm \
  -e MIGRATION_USER_PASSWORD="$(openssl rand -base64 24)" \
  -e ZAMMAD_BASE_URL=... -e ZAMMAD_API_TOKEN=... \
  app pnpm migrate:zammad:users
```

See [docs/commands.md](docs/commands.md) and
[docs/deployment-and-zammad-migration.md](docs/deployment-and-zammad-migration.md).

---

## Documentation

| Topic | Document |
|-------|----------|
| Sign-in | [docs/authentication.md](docs/authentication.md) |
| Customer side | [docs/customer-portal.md](docs/customer-portal.md) |
| Team side | [docs/agent-portal.md](docs/agent-portal.md) |
| Admin area | [docs/admin-portal.md](docs/admin-portal.md) |
| Requests | [docs/tickets.md](docs/tickets.md) |
| Public API | [docs/api.md](docs/api.md) |
| Notifying other systems | [docs/webhooks.md](docs/webhooks.md) |
| File uploads | [docs/file-uploads.md](docs/file-uploads.md) |
| Email | [docs/email-notifications.md](docs/email-notifications.md) |
| In-app notifications | [docs/in-app-notifications.md](docs/in-app-notifications.md) |
| Live updates | [docs/realtime-updates.md](docs/realtime-updates.md) |
| Who can see what | [docs/permission-model.md](docs/permission-model.md) |
| Overview screen | [docs/dashboard.md](docs/dashboard.md) |
| Database tables | [docs/database-schema.md](docs/database-schema.md) |
| Design system | [docs/design-system.md](docs/design-system.md) |
| Backups | [docs/backup-and-restore.md](docs/backup-and-restore.md) |
| Command reference | [docs/commands.md](docs/commands.md) |
| Releasing | [docs/releasing.md](docs/releasing.md) |
| Deploying and moving from Zammad | [docs/deployment-and-zammad-migration.md](docs/deployment-and-zammad-migration.md) |

---

## Roadmap

Docket does what it set out to do. The customer side, the team side, the admin area, the
API, outgoing notifications, reply targets, reports and the audit log all work today.
Known gaps, roughly in the order people ask for them:

- **Replying by email.** Customers answering the notification email and having it land on
  the request. Considered and deliberately left for later; the private link is the
  supported way to reply today.
- **Satisfaction ratings** after a request is closed.
- **A spreadsheet export of the request list itself.** Reports already export; the raw
  list does not.
- **One-click deploy buttons** for Railway, Render and Fly.
- **Attachments and outgoing notifications in the public API.** See the limits section in
  [docs/api.md](docs/api.md).
- **More polish on small screens** for the two-column request view.

Want one of these, or something not listed?
[Open an issue](https://github.com/stack256org/docket/issues/new/choose) describing the
problem you are trying to solve. That is what decides priority.

---

## Contributing

Contributions are welcome. Please open an issue before starting anything large.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the project layout, the conventions, and getting
a development environment running. Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

Found a security problem? Please do not open a public issue. See [SECURITY.md](SECURITY.md).

---

## Licence

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Stack256.
