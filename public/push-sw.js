/* Dedicated push worker: does not intercept app fetches or cache user data. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || 'PRG UK Prep Bay Calendar', {
    body: data.body || 'You have a new calendar notification',
    icon: '/prg-prep-bay-192.png', badge: '/prg-prep-bay-192.png',
    tag: data.tag || 'prep-bay', data: {url: data.url || '/#/'},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of clientsList) {
      if (new URL(client.url).origin === target.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return clients.openWindow(target.href);
  })());
});
