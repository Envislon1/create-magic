// Service worker for Mind Buddy — handles native notifications
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for messages from the page to show notifications
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SHOW_SOS_NOTIFICATION") {
    self.registration.showNotification("🚨 SOS Alert", {
      body: data.body || "Emergency triggered from your Mind Buddy device.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "sos-" + (data.id || Date.now()),
      requireInteraction: true,
      vibrate: [400, 200, 400, 200, 400],
      data: { url: "/" }
    });
  } else if (data.type === "SHOW_CHAT_NOTIFICATION") {
    self.registration.showNotification(data.title || "New message", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "chat-" + (data.id || Date.now()),
      vibrate: [120, 60, 120],
      data: { url: data.url || "/" }
    });
  } else if (data.type === "SHOW_MEDICATION_NOTIFICATION") {
    self.registration.showNotification("💊 Medication reminder", {
      body: data.body || "Time for your medication.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "medication",
      requireInteraction: true,
      // Gentle, distinct from the SOS siren pattern.
      vibrate: [200, 150, 200, 150, 200],
      data: { url: "/" }
    });
  } else if (data.type === "SHOW_NOTIFICATION") {
    self.registration.showNotification(data.title || "Mind Buddy", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "info",
      requireInteraction: true,
      vibrate: [600, 300, 600, 300, 600],
      data: { url: "/" }
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});