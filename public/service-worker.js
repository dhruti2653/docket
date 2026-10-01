// Push service worker for agent/admin OS notifications — serves BOTH
// providers selectable in Admin → Integrations → Push Notifications. One file,
// because a scope can only have one service worker (and one push subscription).
//
// 1. Pusher Beams: its SW handles payloads carrying `data.pusher` and ignores
//    everything else. Wrapped in try/catch so a blocked/offline CDN doesn't
//    abort SW install and take Web Push down with it.
try {
  importScripts("https://js.pusher.com/beams/service-worker.js");
} catch (err) {
  console.warn("[sw] Pusher Beams service worker unavailable:", err);
}

// 2. Standard Web Push (VAPID) — payload shape from lib/web-push.ts:
//    { title, body, url?, tag? }. Skips Beams payloads, handled above.
self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Docket", body: event.data.text() };
  }
  if (payload?.data?.pusher) {
    return;
  }

  const title = payload.title || "Docket";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag,
      // Re-alert when a newer notification replaces one with the same tag
      // (e.g. a second reply on the same ticket).
      renotify: Boolean(payload.tag),
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data;
  if (!data || data.pusher) {
    return; // Beams notification — its own handler opens the deep link.
  }
  event.notification.close();

  const target = new URL(data.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Reuse an open app tab rather than piling up new ones.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(target).catch(() => undefined);
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

// Activate updated versions of this file immediately so switching providers
// doesn't wait for every tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
);
