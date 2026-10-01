# In-App Notifications (Agents)

Agents are notified **inside the app** — not by email — when something needs their
attention. Notifications appear in the bell menu in the top bar, with an unread count.

## Events

| Event | Type | Recipients |
|-------|------|------------|
| New ticket submitted | `ticket_created` | All active (non-deactivated) agents and admins — a brand-new ticket has no assigned agent yet |
| Customer replied to a ticket | `customer_replied` | Assigned agent if the ticket is assigned; otherwise all active (non-deactivated) agents and admins |

> This zero-config routing means a solo self-hoster always gets the reply, teams only
> ping the owner of an assigned ticket, and unowned tickets reach everyone.

## Data model

`notifications` table (`db/schema/notifications.ts`):

| Column | Notes |
|--------|-------|
| `id` | Primary key |
| `userId` | Recipient — FK `user.id`, `ON DELETE CASCADE` |
| `type` | Event type, e.g. `customer_replied` |
| `ticketId` | Related ticket — FK `tickets.id`, `ON DELETE CASCADE` (nullable) |
| `ticketNumber` | Denormalised for display |
| `title` / `body` | Display text (body is a short preview) |
| `isRead` | Unread by default |
| `createdAt` | Timestamp |

Indexed on `userId` and `(userId, isRead)` for fast unread lookups.

## API

All routes are agent/admin only (enforced by `proxy.ts`; identity read from the
`x-user-id` header it injects).

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/notifications` | Recent notifications + `unreadCount` for the current agent |
| `POST` | `/api/notifications/read` | Body `{ id }` marks one read; empty body marks all read |

Helpers live in `lib/notifications.ts` (`createNotifications`, `listNotifications`,
`getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`).

## UI

`components/agent/notification-bell.tsx`, mounted in the agent/admin top bar
(`components/agent/topbar.tsx`):

- Bell icon with an unread badge.
- Polls `GET /api/notifications` every 30s for the unread count (and refreshes on open).
- Clicking a notification marks it read and navigates to `/tickets/{ticketNumber}`.
- "Mark all read" clears the badge.

A lightweight poll keeps the in-app bell simple and reliable for self-hosters. For
true OS-level delivery (even when the app is closed), enable push notifications below.

## Browser / OS push — optional (Pusher Beams **or** Web Push)

When configured, agents also get **OS-level push notifications** (desktop/mobile) for
every event in the table above, even when the app or tab is closed. Recipients are the
same as for the bell. If push isn't configured, everything falls back to the in-app bell
with zero setup.

The admin picks **one provider** under **Admin → Integrations → Push Notifications** (also
in the setup wizard's Integrations step). The card shows only the selected provider's
fields, and pressing **Save** both stores them and switches the provider. It applies live,
with no restart or rebuild. Agents' browsers move to the new provider on their next page load.

| | **Pusher Beams** (`pusher`, default) | **Web Push** (`webpush`) |
|---|---|---|
| Third-party account | Pusher Beams instance | None. Uses the browser's built-in push service (FCM / Mozilla / Apple) directly |
| Credentials | Instance ID + secret key | VAPID key pair (the **Generate keys** button creates one) |
| Env fallback | `NEXT_PUBLIC_PUSHER_BEAMS_INSTANCE_ID`, `PUSHER_BEAMS_SECRET_KEY` | `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` |
| Device registry | On Pusher's side ("Authenticated Users" mode) | `push_subscriptions` table |
| Test connection | Publishes to a reserved user ID | Validates the key pair offline. If the keys are the saved ones, it also sends a real test push to the admin's own browsers |

The provider resolves as DB `integration_settings.push_provider` → `PUSH_PROVIDER` env →
`pusher`, so installs that predate the switch keep using Beams unchanged. A DB-saved value
wins over env per field, as for every integration (see `lib/integration-settings.ts`).
VAPID keys resolve **as a pair**: the DB keys are used only when both halves are saved
there, so a DB public key never gets mixed with an env private key. The VAPID subject
(the contact push services may use) isn't configurable: it is `NEXT_PUBLIC_APP_URL` when
that URL is https, otherwise `mailto:admin@<host>`.

**How it works:**

| Piece | File |
|-------|------|
| Provider dispatch | `lib/push.ts` → `publishPushToUsers()` sends via Beams or `sendWebPushToUsers()` depending on `getPushProvider()`. Call sites never know which one is used |
| Web Push send / keys | `lib/web-push.ts` contains `sendWebPushToUsers` (prunes 404/410 subscriptions), `generateVapidKeys`, `testWebPushKeys` (format + pair check), and `save`/`deleteWebPushSubscription` |
| Beams token auth | `app/api/notifications/beams-auth/route.ts` issues a Beams device token, only for the signed-in agent's own id |
| Web Push subscribe | `POST`/`DELETE /api/notifications/web-push/subscriptions` store or remove the signed-in agent's own subscription. Requests are rejected unless `webpush` is selected |
| Admin endpoints | `/api/admin/integration-settings/web-push/generate-keys` (returns a pair and saves nothing) and `/web-push/test` |
| Public config | `GET /api/config/client` returns `pushProvider` plus either `beamsInstanceId` or `vapidPublicKey`, whichever the selected provider needs |
| Service worker | `public/service-worker.js` serves **both** providers. It imports the Beams SW (which only handles payloads with `data.pusher`) and adds its own `push`/`notificationclick` handlers for Web Push |
| Client registration | `components/agent/push-init.tsx` is mounted in the agent/admin layouts. It asks for permission and registers with the selected provider |
| Triggers | `lib/tickets/create-ticket.ts` (new ticket), `app/api/tickets/[id]/comments` and `app/api/v1/tickets/[id]/comments` (customer reply) each call `publishPushToUsers(...)` right after `createNotifications(...)`, tagged `ticket-<number>` so a newer alert for the same ticket replaces the older one |

**Switching providers.** A browser holds a single push subscription per service-worker
scope. When Web Push is selected, `push-init.tsx` drops any subscription created under a
different key (Beams, or a rotated VAPID pair) before subscribing. When Beams is selected
again, it unsubscribes the Web Push subscription it created earlier, tracked in
`localStorage` as `docket_webpush_endpoint`, so that Beams can subscribe.

**Rotating VAPID keys.** Saving a different public key deletes every `push_subscriptions`
row, because each subscription is bound to the key it was created with. Agents
re-subscribe automatically on their next page load. The UI asks for confirmation before
it generates replacement keys.

- The publish is best-effort and a **no-op when the selected provider isn't configured**.
  It never blocks saving a ticket or reply.
- Push requires a **secure context** (HTTPS in production; `localhost` is exempt). On iOS,
  Web Push works only after the app is added to the Home Screen (iOS 16.4+).
- Signing in as a different agent on the same browser reassigns the device automatically.
  Beams calls `setUserId` again, and Web Push upserts the subscription by `endpoint`.

## Creating a notification

```ts
import { createNotifications } from "@/lib/notifications";

await createNotifications(recipientUserIds, {
  type: "customer_replied",
  title: `${customerName} replied to #${ticketNumber}`,
  body: replyText.slice(0, 200),
  ticketId,
  ticketNumber,
});
```

Notification creation is best-effort — failures are logged, never thrown, so they
don't block the underlying action (e.g. saving the customer's reply).
