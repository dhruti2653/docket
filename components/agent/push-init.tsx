"use client";

import { useEffect } from "react";
import type { PusherClientConfig } from "@/lib/integration-settings";

const SERVICE_WORKER_URL = "/service-worker.js";
// Endpoint of the Web Push subscription this browser last registered, so that
// switching the provider back to Pusher can tear down exactly that one.
const WEB_PUSH_ENDPOINT_KEY = "docket_webpush_endpoint";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) {
    return false;
  }
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
}

/** Standard Web Push: subscribe with the server's VAPID public key and hand the
 * subscription to the server. A browser holds one push subscription per SW
 * scope, so one created under a different key (Beams, or a since-rotated VAPID
 * pair) is dropped first — subscribe() would otherwise reject. */
async function registerWebPush(
  vapidPublicKey: string,
  isCancelled: () => boolean
) {
  if (Notification.permission === "denied") {
    return;
  }
  const registration =
    await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  await navigator.serviceWorker.ready;
  if (isCancelled()) {
    return;
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted" || isCancelled()) {
      return;
    }
  }

  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (
    subscription &&
    !sameKey(subscription.options.applicationServerKey, applicationServerKey)
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  // Always (re)sent, even for an existing subscription: it binds the device to
  // whoever is signed in now, and restores the row if the server pruned it.
  const res = await fetch("/api/notifications/web-push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!res.ok) {
    throw new Error(`subscription save failed (${res.status})`);
  }
  localStorage.setItem(WEB_PUSH_ENDPOINT_KEY, subscription.endpoint);
}

/** Undo registerWebPush() after the admin switched the provider away from Web
 * Push, freeing the browser's single push slot for Beams. */
async function teardownWebPush() {
  const endpoint = localStorage.getItem(WEB_PUSH_ENDPOINT_KEY);
  if (!endpoint) {
    return;
  }
  const registration =
    await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription?.endpoint === endpoint) {
    await subscription.unsubscribe();
  }
  await fetch("/api/notifications/web-push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
  localStorage.removeItem(WEB_PUSH_ENDPOINT_KEY);
}

async function registerBeams(
  beamsInstanceId: string,
  userId: string,
  isCancelled: () => boolean
) {
  const PusherPushNotifications = await import(
    "@pusher/push-notifications-web"
  );
  const beamsClient = new PusherPushNotifications.Client({
    instanceId: beamsInstanceId,
  });
  const tokenProvider = new PusherPushNotifications.TokenProvider({
    url: "/api/notifications/beams-auth",
  });

  await beamsClient.start();
  if (isCancelled()) {
    return;
  }
  // Associate this device with the signed-in agent. Re-running with a
  // different user reassigns the device, so sign-out/in "just works".
  await beamsClient.setUserId(userId, tokenProvider);
}

/** Registers the agent's browser for OS-level push via whichever provider the
 * admin selected in Admin → Integrations (Pusher Beams or Web Push). Config is
 * fetched at runtime from /api/config/client rather than read off NEXT_PUBLIC_*
 * (see lib/pusher-browser.ts). Renders nothing; no-op when unconfigured or
 * unsupported. */
export function PushInit({ userId }: { userId: string }) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    (async () => {
      try {
        const config = (await fetch("/api/config/client").then((res) =>
          res.json()
        )) as PusherClientConfig;
        if (cancelled) {
          return;
        }

        if (config.pushProvider === "webpush") {
          if (config.vapidPublicKey) {
            await registerWebPush(config.vapidPublicKey, isCancelled);
          }
          return;
        }

        await teardownWebPush();
        if (config.beamsInstanceId && !cancelled) {
          await registerBeams(config.beamsInstanceId, userId, isCancelled);
        }
      } catch (err) {
        // Permission denied / unsupported browser / token endpoint unavailable —
        // all non-fatal (OS push simply won't work; in-app + email still do).
        console.warn(
          "[push] registration skipped:",
          err instanceof Error ? err.message : err
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}
