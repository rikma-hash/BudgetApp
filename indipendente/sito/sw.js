// Tiene in cache la "scocca" dell'app così si apre anche quando il Mac non è raggiungibile.
// Strategia "prima la copia": la pagina e i suoi file arrivano SUBITO dalla copia salvata (anche a Mac spento,
// e senza attese che su iPhone, aprendo l'icona della Home, lasciano lo schermo vuoto); in sottofondo si scarica
// la versione dal Mac e si aggiorna la copia. Quando esce una versione nuova di questo file l'app si ricarica da sola.
const CACHE = "spese-indip-b142fd5e";
const SHELL = ["/", "/i18n.js?v=44", "/app.js?v=44", "/style.css?v=44", "/extra.css?v=b142fd5e", "/config.js?v=b142fd5e", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-512.png", "/keywords.json", "/vendor/supabase.min.js", "/vendor/xlsx.full.min.js", "/store.js?v=b142fd5e", "/server.js?v=b142fd5e", "/excel.js?v=b142fd5e", "/importer.js?v=b142fd5e", "/login.js?v=b142fd5e"];

// "scatola nera": ultimi eventi, letti dall'app e mandati al Mac quando torna raggiungibile (/api/diag)
let diagQueue = Promise.resolve();
function diag(m) {
  diagQueue = diagQueue.then(() => caches.open("diag").then((c) => c.match("/__diag")
    .then((r) => (r ? r.json() : [])).catch(() => [])
    .then((a) => { a.push({ t: Date.now(), m }); return c.put("/__diag", new Response(JSON.stringify(a.slice(-60)))); })))
    .catch(() => {});
  return diagQueue;
}

self.addEventListener("install", (e) => {
  // cache: "reload" = sempre dal Mac, mai dalla cache di Safari (che poteva rimettere una versione vecchia)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => diag("sw installato " + CACHE))
    .then(() => self.skipWaiting()).catch((err) => diag("sw installazione fallita: " + err)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("spese-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()).then(() => diag("sw attivo " + CACHE)));
});

/** Copia salvata: prima quella esatta, poi qualunque versione dello stesso file. */
async function fromCache(key) {
  return (await caches.match(key)) || (await caches.match(key, { ignoreSearch: true })) || null;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname === "/sw.js" || url.origin !== location.origin) return;
  const page = req.mode === "navigate";
  const key = page ? "/" : req;
  const update = fetch(req, { cache: "no-cache" }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  });
  e.respondWith(fromCache(key).then((hit) => {
    if (hit) { if (page) diag(`${url.pathname}: dalla copia`); return hit; }
    diag(`${url.pathname + url.search}: nessuna copia, provo la rete`);
    return update;
  }));
  e.waitUntil(update.catch(() => {}));
});
