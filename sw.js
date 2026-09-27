const CACHE='temple-reception-v01';
const LOCAL=['./','./index.html','./app.js','./temple-data.js','./roles-data.js','./manifest.webmanifest'];
const XLSX='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(LOCAL);try{const r=await fetch(XLSX,{mode:'no-cors'});await c.put(XLSX,r)}catch(_){}})()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>e.respondWith((async()=>{const cached=await caches.match(e.request);if(cached)return cached;try{const r=await fetch(e.request);if(r && (r.ok||r.type==='opaque')){const c=await caches.open(CACHE);c.put(e.request,r.clone())}return r}catch(err){return cached||Response.error()}})()));