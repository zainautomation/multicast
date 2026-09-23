// Multicast service worker: shows reminder / go-live / failure push notifications.
self.addEventListener("push", (event) => {
  let data = { title: "Multicast", body: "", url: "/schedule" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* plain text payloads */
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, data: { url: data.url }, tag: data.url }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/schedule";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w && w.url.includes(self.location.origin)) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
