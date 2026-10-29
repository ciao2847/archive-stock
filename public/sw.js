/* Push only: never cache authenticated pages or API responses. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* Show a safe fallback. */ }
  const path = typeof payload.url === "string" && /^\/(notifications\/[0-9a-f-]+|settings)$/.test(payload.url) ? payload.url : "/";
  event.waitUntil(self.registration.showNotification(payload.title || "庫藏｜有新的訂購", {
    body: payload.body || "開啟庫藏查看最新訂購紀錄。",
    icon: "/brand/archive-favicon-v3-192.png?v=3",
    badge: "/brand/archive-favicon-v3-192.png?v=3",
    tag: payload.tag || "archive-order-notification",
    renotify: false,
    data: { url: path },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const candidate = event.notification.data && event.notification.data.url;
  const url = new URL(typeof candidate === "string" ? candidate : "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === url.origin && "navigate" in client) {
        await client.navigate(url.href);await client.focus();return;
      }
    }
    await self.clients.openWindow(url.href);
  })());
});
