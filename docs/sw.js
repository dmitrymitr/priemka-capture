const CACHE='priemka-shell-v2';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./style.css','./app.js','./zip.js','./native.js','./capacitor-core.js','./icon.svg','./manifest.webmanifest'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin)return;event.respondWith(caches.match(event.request).then(c=>c||fetch(event.request)));});
