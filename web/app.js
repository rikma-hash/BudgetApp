"use strict";

const APP_VERSION = (document.currentScript?.src.match(/[?&]v=(\d+)/) || [])[1] || null;  // versione di questa copia

// ================= utilità =================

const $ = (id) => document.getElementById(id);
const eur = (n) => (n ?? 0).toLocaleString(LOCALE, { style: "currency", currency: "EUR" });
const eur0 = (n) => (n ?? 0).toLocaleString(LOCALE, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const MONTHS = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (n) => (n < -0.004 ? "neg" : n > 0.004 ? "pos" : "");
const parseAmount = (s) => {
  let t = String(s ?? "").replace(/\s|€/g, "");
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "") : t.replace(/,/g, "");
  return parseFloat(t.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
};
const DEC = LANG === "en" ? "." : ",";  // separatore dei decimali nei campi
const numIn = (n) => (n ? String(Math.round(n * 100) / 100).replace(".", DEC) : "");
const amountIn = (n) => (n ? n.toFixed(2).replace(".", DEC) : "");
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => isoDay(new Date());
const yesterday = () => isoDay(new Date(Date.now() - 864e5));
const fmtDay = (d) => (!d ? "" : d === today() ? tr("Oggi") : d === yesterday() ? tr("Ieri")
  : new Date(d).toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" }));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const EMOJI = [
  ["trasporto principale", "🚆"], ["alloggio", "🛏️"], ["cibo spesa", "🛒"], ["cibo", "🍝"], ["intratten", "🎟️"],
  ["attivit", "🎟️"], ["shopping", "🛍️"], ["imprevist", "⚠️"],
  ["affitto", "🏠"], ["spesa", "🛒"], ["mensa", "🍽️"], ["lavatric", "🧺"], ["abbigliamento", "👕"], ["abbonament", "🔁"],
  ["viagg", "✈️"], ["svago", "🎉"], ["varie", "📦"], ["trasport", "🚌"], ["cura", "💊"], ["casa", "🛋️"], ["fast food", "🍔"],
  ["ristorant", "🍔"], ["regal", "🎁"], ["commission", "🏦"], ["piccole", "🪙"], ["sport", "🏋️"], ["salute", "💊"],
];
const emoji = (cat) => (EMOJI.find(([k]) => String(cat || "").toLowerCase().includes(k)) || [, "💶"])[1];

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2800);
}

// ---------- copia locale delle risposte (per vedere i dati con il Mac spento) ----------
// Ogni lettura riuscita (GET) viene salvata nel telefono; se il Mac non risponde si mostra l'ultima copia.
const OFF_MAX = 60;
const offKey = (path) => "api:" + path.replace(/([?&])day=[^&]*&?/, "$1").replace(/[?&]$/, "");
let staleSince = null;  // ora della copia più vecchia mostrata mentre il Mac non risponde
function offSave(path, value) {
  try {
    const idx = store.get("api-index", []).filter((k) => k !== offKey(path));
    idx.push(offKey(path));
    while (idx.length > OFF_MAX) localStorage.removeItem(idx.shift());
    localStorage.setItem(offKey(path), JSON.stringify({ t: Date.now(), v: value }));
    store.set("api-index", idx);
  } catch { /* telefono pieno: pazienza, si resta senza copia */ }
}
function offLoad(path) {
  const c = store.get(offKey(path), null);
  if (!c) return null;
  staleSince = Math.min(staleSince || Infinity, c.t);
  return c.v;
}

async function api(path, opts = {}) {
  const read = !opts.method || opts.method === "GET";
  // con il Mac spento la richiesta può restare appesa a lungo: dopo un po' si rinuncia (letture: copia salvata, spese: coda)
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || (read ? (online ? 8000 : 1500) : path.startsWith("/api/import") || path.startsWith("/api/advice") ? 120000 : online ? 12000 : 4000));
  let res;
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts, signal: ctl.signal,
      body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (err) {
    clearTimeout(timer);
    err.network = true;  // solo questi errori vogliono dire "il Mac non risponde"
    const cached = read ? offLoad(path) : null;
    if (cached) { if (online) setOnline(false); return cached; }
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) { const e = new Error((await res.json().catch(() => ({}))).detail || res.statusText); e.status = res.status; throw e; }
  const value = await res.json();
  if (read) { offSave(path, value); if (!online || staleSince) { staleSince = null; setOnline(true); } }
  return value;
}

let online = true;
function setOnline(v) { online = v; renderStatus(); }
function failMsg(err) {
  if (err.network) { setOnline(false); return "Il Mac non è raggiungibile"; }
  if (err.status) return err.message;
  // errore dell'app (non della rete): finisce nella scatola nera con il dettaglio
  window.__diag?.("errore interno: " + String(err && (err.stack || err)).slice(0, 500));
  return "Qualcosa non ha funzionato: riprova";
}

// ================= stato generale =================

let data = store.get("state", null);
let view = "home";

const queue = () => store.get("queue", []);
const setQueue = (q) => store.set("queue", q);

async function refresh() {
  try {
    data = await api("/api/state?day=" + today());
    store.set("state", data);
  } catch (e) { if (e.network) setOnline(false); else failMsg(e); }
  renderStatus();
  if (view === "home") renderHome();
}

function renderStatus() {
  const msgs = [];
  if (data?.problem) msgs.push(["", "⚠️ " + data.problem]);
  if (!online) msgs.push(["", "📡 Il Mac non è raggiungibile: le nuove spese restano sul telefono e partono dopo. Se il Mac è acceso, controlla che Tailscale sia attivo sul telefono."]);
  if (!online && staleSince) msgs.push(["warn", `🕘 Stai vedendo i dati del ${new Date(staleSince).toLocaleString(LOCALE, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}: si possono solo guardare.`]);
  if (data?.excel_open) msgs.push(["warn", "📗 Il file è aperto in Excel sul Mac: le spese verranno scritte quando lo chiudi."]);
  const q = queue().length + (data?.pending || 0);
  if (q) msgs.push(["info", `⏳ ${q} ${q === 1 ? "spesa in attesa" : "spese in attesa"} di essere scritte`]);
  $("status").hidden = !msgs.length;
  $("status").innerHTML = msgs.map(([c, m]) => `<div class="${c}">${esc(m)}</div>`).join("");
}

const knownCats = () => (data?.summary?.categories || []).map((c) => c.category);

// ================= navigazione =================

function go(name, opts = {}) {
  if (name === "savings") { name = "budget"; budgetMode = "sav"; }
  view = ["home", "history", "trips", "budget", "import", "settings"].includes(name) ? name : "home";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  document.querySelectorAll("#tabs [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === ({ import: "history", settings: "home" }[view] || view)));
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  window.scrollTo(0, 0);
  if (view === "home") { renderHome(); refresh(); }
  else { refresh(); ({ history: () => loadHistory(opts), trips: () => loadTrips(opts), budget: loadBudgetView, import: loadImport, settings: renderSettings }[view])(); }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) go(b.dataset.go);
});
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h && h !== view) go(h); });

// ================= ESCLUSIONI =================

const EXCL = [["affitto", "🏠 Senza affitto"], ["viaggi", "✈️ Senza viaggi"]];
let excluded = new Set(store.get("excluded", []));

function exclHtml() {
  return EXCL.map(([k, label]) => `<button type="button" data-excl="${k}" class="${excluded.has(k) ? "on" : ""}">${label}</button>`).join("");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-excl]"); if (!b) return;
  const k = b.dataset.excl;
  excluded.has(k) ? excluded.delete(k) : excluded.add(k);
  store.set("excluded", [...excluded]);
  if (view === "home") renderHome();
  if (view === "history" && monthData) renderMonth();
});
const isExcluded = (cat) => excluded.has(String(cat || "").toLowerCase());

/** Totali di un riepilogo mese togliendo le categorie escluse. */
function adjusted(s) {
  const cats = s.categories.filter((c) => !isExcluded(c.category));
  const out = cats.reduce((a, c) => ({ total: a.total + c.total, budget: a.budget + c.budget }), { total: 0, budget: 0 });
  out.cats = cats;
  out.label = [...excluded].length ? " (" + EXCL.filter(([k]) => excluded.has(k)).map(([, l]) => l.split(" ").slice(1).join(" ").toLowerCase()).join(", ") + ")" : "";
  return out;
}

// ================= HOME =================

function renderHome() {
  const now = new Date();
  const wk = Math.min(5, Math.floor((now.getDate() - 1) / 7) + 1);
  $("home-month").textContent = now.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric" }) + ` · settimana ${wk}`;
  $("home-title").textContent = data?.summary?.sheet || MONTHS[now.getMonth()];

  const s0 = data?.summary;
  if (!s0) { $("hero").innerHTML = `<p class="big-label">Caricamento…</p>`; return; }
  const s = { ...s0, ...adjusted(s0) };
  const left = s.budget - s.total;
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const weekTot = s.cats.reduce((a, c) => a + (c.weeks[wk - 1] || 0), 0);
  const todayTot = (data.recent || []).filter((t) => t.date === today() && !isExcluded(t.category)).reduce((a, t) => a + t.amount, 0)
    + queue().filter((t) => t.date === today() && !t.trip && !isExcluded(t.category)).reduce((a, t) => a + t.amount, 0);
  $("home-excl").innerHTML = exclHtml();

  $("hero").innerHTML = (s.budget > 0 ? `
      <p class="big-label">${left >= 0 ? "Ti restano questo mese" : "Hai superato il budget di"}${s.label}</p>
      <div class="big-num ${left < 0 ? "neg" : ""}">${eur(Math.abs(left))}</div>
      <div class="progress"><i class="${left < 0 ? "over" : ""}" style="width:${Math.min(100, (s.total / s.budget) * 100)}%"></i></div>
      <div class="meta"><span>Speso ${eur(s.total)} di ${eur0(s.budget)}</span><span>${daysLeft} giorni alla fine del mese</span></div>`
    : `
      <p class="big-label">Hai speso questo mese${s.label}</p>
      <div class="big-num">${eur(s.total)}</div>
      <div class="meta"><span>Non hai ancora impostato il budget del mese.</span></div>
      <button class="primary cta" data-go="budget">Imposta il budget</button>`)
    + `<div class="week-box"><div><span>Oggi</span><b>${eur(todayTot)}</b></div><div><span>Questa settimana</span><b>${eur(weekTot)}</b></div></div>`;

  renderAlerts(s0.categories);
  const cats = s0.categories.filter((c) => c.total > 0 || c.budget > 0).sort((a, b) => b.total - a.total);
  $("home-cats").innerHTML = cats.length ? cats.map(catRow).join("") : `<li class="empty" style="display:block">Ancora nessuna spesa.</li>`;

  const rows = [...queue().map((e) => ({ ...e, queued: true })), ...(data.recent || [])].slice(0, 5);
  homeRows = rows;
  $("home-recent").innerHTML = rows.length ? rows.map((t, i) => txRow(t, i)).join("") : `<li class="empty" style="display:block">Tocca + per aggiungere la prima spesa.</li>`;
  $("home-recent").onclick = (e) => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    const t = rows[+li.dataset.i];
    if (t.queued) return toast("Questa spesa è ancora in attesa: la puoi modificare quando arriva sul Mac.");
    if (t.trip) return go("trips", { trip: t.trip });
    openEdit(t, knownCats(), true, refresh);
  };
}

// avviso nella Home: categorie oltre l'80% del budget (o sforate). Affitto, abbonamenti e viaggi si pagano
// in un colpo solo, quindi compaiono solo se sforano.
const LUMPY = ["affitto", "abbonament", "viagg"];
function renderAlerts(categories) {
  const list = categories.filter((c) => c.budget > 0 && c.total / c.budget >= 0.8)
    .filter((c) => c.total > c.budget || !LUMPY.some((k) => c.category.toLowerCase().includes(k)))
    .sort((a, b) => b.total / b.budget - a.total / a.budget).slice(0, 4);
  $("home-alerts").hidden = !list.length;
  $("home-alerts").innerHTML = list.map((c) => {
    const over = c.total > c.budget;
    return `<button type="button" class="alert-row ${over ? "over" : ""}" data-cat="${esc(c.category)}">
      <span class="emoji">${over ? "🔴" : "⚠️"}</span>
      <span><b>${esc(c.category)}</b><small>${over ? `sforato di ${eur(c.total - c.budget)}` : `usato il ${Math.round((c.total / c.budget) * 100)}% · restano ${eur(c.budget - c.total)}`}</small></span>
      <i>›</i></button>`;
  }).join("");
}
$("home-alerts").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]"); if (!b) return;
  go("history", { category: b.dataset.cat });
});

// ---------- scorri verso sinistra per eliminare (Home, Storico, viaggio) ----------
let homeRows = [], monthFlat = [];
const SWIPE = 92;  // larghezza del pulsante rosso

async function deleteTx(t, trip, after) {
  if (!online) return toast("Per modificare o eliminare una spesa serve il Mac acceso.");
  if (!(await askConfirm("Eliminare la spesa?", `${t.description} · ${eur(t.amount)}`))) return;
  try {
    const expect = { description: t.description, amount: t.amount };
    if (trip) await api("/api/trips/delete-expense", { method: "POST", body: { trip, row: t.row, expect } });
    else await api("/api/expenses/delete", { method: "POST", body: { sheet: t.sheet, row: t.row, expect } });
    toast("Spesa eliminata");
    after?.();
  } catch (err) { toast(failMsg(err)); }
}

/** getItem(li) → { t, trip, after } se la riga si può eliminare, altrimenti null. */
function enableSwipe(container, getItem, onDelete = (it) => deleteTx(it.t, it.trip, it.after)) {
  let li = null, start = null, dx = 0, horizontal = null;
  const closeAll = (except) => container.querySelectorAll("li.swiped").forEach((x) => {
    if (x !== except) { x.classList.remove("swiped"); x.style.transform = ""; }
  });
  container.addEventListener("touchstart", (e) => {
    if (e.target.closest(".swipe-del")) return;
    li = e.target.closest("li[data-i]");
    if (!li || !getItem(li)) { li = null; return; }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, open: li.classList.contains("swiped") };
    dx = start.open ? -SWIPE : 0;
    horizontal = null;
    li.style.transition = "none";
  }, { passive: true });
  container.addEventListener("touchmove", (e) => {
    if (!li) return;
    const mx = e.touches[0].clientX - start.x, my = e.touches[0].clientY - start.y;
    if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my);
    if (!horizontal) return;
    e.preventDefault();  // mentre scorri di lato la pagina non si muove
    // il pulsante rosso c'è già mentre scorri: segue il dito ed entra da destra
    if (!li.querySelector(".swipe-del")) li.insertAdjacentHTML("beforeend", `<button type="button" class="swipe-del">Elimina</button>`);
    dx = Math.min(0, Math.max(-SWIPE * 1.6, mx + (start.open ? -SWIPE : 0)));
    li.style.transform = `translateX(${dx}px)`;
    li.style.setProperty("--pull", Math.max(SWIPE, -dx) + "px");  // oltre la larghezza il rosso si allunga
  }, { passive: false });
  container.addEventListener("touchend", () => {
    if (!li) return;
    li.style.transition = "";
    if (horizontal) {
      const open = dx < -SWIPE / 2;
      li.style.removeProperty("--pull");
      li.classList.toggle("swiped", open);
      li.style.transform = open ? `translateX(-${SWIPE}px)` : "";
      if (open) closeAll(li);
      li.dataset.swipedAt = Date.now();
    }
    li = null;
  });
  // il tocco su "Elimina", o subito dopo aver scorso, non deve aprire la modifica
  container.addEventListener("click", (e) => {
    const row = e.target.closest("li[data-i]"); if (!row) return;
    const del = e.target.closest(".swipe-del");
    if (del || row.classList.contains("swiped") || Date.now() - (+row.dataset.swipedAt || 0) < 400) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (del) { const it = getItem(row); if (it) onDelete(it); }
      row.classList.remove("swiped"); row.style.transform = "";
    }
  }, true);
}

function catRow(c) {
  const pct = c.budget > 0 ? Math.min(100, (c.total / c.budget) * 100) : (c.total > 0 ? 100 : 0);
  const over = c.budget > 0 && c.total > c.budget;
  const leftTxt = c.budget > 0 ? (over ? `sforato di ${eur(c.total - c.budget)}` : `restano ${eur(c.budget - c.total)}`) : "nessun budget";
  return `<li data-cat="${esc(c.category)}"><span class="emoji">${emoji(c.category)}</span>
    <div><div class="line"><span>${esc(c.category)}</span><span>${eur(c.total)}${c.budget ? " / " + eur0(c.budget) : ""}</span></div>
    <div class="bar"><i class="${over ? "over" : !c.budget ? "none" : ""}" style="width:${pct}%"></i></div>
    <div class="left ${over ? "neg" : ""}">${leftTxt}</div></div></li>`;
}

function txRow(t, i) {
  const link = t.trip && t.sheet;  // riga "✈️ Viaggio: …" in un mese
  const sub = link ? "Totale del viaggio · tocca per aprirlo" : `${esc(t.category || "—")} · ${fmtDay(t.date)}${t.queued ? " · in attesa" : ""}${t.note ? " · " + esc(t.note) : ""}`;
  return `<li data-i="${i}" class="${t.queued ? "queued" : ""}"><span class="emoji">${link ? "✈️" : emoji(t.category)}</span>
    <div class="what"><b>${esc(t.description)}</b><span>${sub}</span></div>
    <span class="amt">${eur(t.amount)}</span></li>`;
}

$("home-cats").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-cat]"); if (!li) return;
  go("history", { category: li.dataset.cat });
});

// ================= FOGLIO AGGIUNGI / MODIFICA =================

let sheet = { mode: "add", cats: [], editable: true, tx: null, onDone: null, trip: null };
let tripsCache = store.get("trips", []);
let suggestions = [];
let selected = null;        // {category, new}
let manualPick = false;
let newCatOpen = false;
let suggestSeq = 0;
let dayChoice = "0";

async function openAdd(opts = {}) {
  sheet = { mode: "add", cats: knownCats(), editable: true, tx: null, onDone: opts.onDone || null, trip: null };
  newCatOpen = false;
  $("sheet-title").textContent = "Nuova spesa";
  $("sheet-delete").hidden = true;
  $("amount").value = ""; $("desc").value = ""; $("note").value = "";
  suggestions = []; selected = null; manualPick = false; $("hint").textContent = "";
  setDay("0", today());
  setDayEnabled(true);
  setSplit(1);
  renderWhere();
  setWhere(opts.trip || null);
  showSheet();
  $("amount").focus();  // subito, dentro il tocco: così su iPhone si apre la tastiera numerica
}

/** Pillole "Spesa normale / ✈ viaggio": i viaggi più recenti per primi. */
function renderWhere() {
  const names = tripsCache.map((t) => t.name).slice(0, 6);
  $("where").hidden = sheet.mode === "edit" || !names.length;
  $("where-pills").innerHTML = `<button type="button" data-where="">📅 Spesa del mese</button>` +
    names.map((n) => `<button type="button" data-where="${esc(n)}">✈️ ${esc(n)}</button>`).join("");
}

function setWhere(trip) {
  sheet.trip = trip;
  document.querySelectorAll("#where-pills button").forEach((b) => b.classList.toggle("on", (b.dataset.where || null) === trip));
  const t = trip && tripsCache.find((x) => x.name === trip);
  sheet.cats = t ? t.categories.filter((c) => !c.virtual).map((c) => c.category) : knownCats();
  $("sheet-title").textContent = sheet.mode === "edit" ? "Modifica spesa" : trip ? `${LANG === "en" ? "Expense" : "Spesa"} · ${trip}` : "Nuova spesa";
  $("split-box").hidden = sheet.mode === "edit" || !!trip;
  $("frequent").hidden = !!trip || sheet.mode === "edit" || !!$("desc").value.trim() || !quickItems.length;
  if (!manualPick || (selected && !sheet.cats.some((c) => c.toLowerCase() === selected.category.toLowerCase()))) {
    selected = null; manualPick = false;
  }
  if (trip) suggestions = [];
  renderCats();
}

$("where-pills").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-where]"); if (!b) return;
  setWhere(b.dataset.where || null);
  if (!sheet.trip && $("desc").value.trim()) fetchSuggest($("desc").value.trim(), false);
});

function openEdit(t, cats, editable, onDone, trip = null) {
  if (!online) return toast("Per modificare o eliminare una spesa serve il Mac acceso.");
  sheet = { mode: "edit", cats, editable, tx: t, onDone, trip };
  newCatOpen = false;
  $("sheet-title").textContent = "Modifica spesa";
  $("sheet-delete").hidden = false;
  $("amount").value = amountIn(t.amount);
  $("desc").value = t.description;
  $("note").value = t.note || "";
  suggestions = []; manualPick = true; $("hint").textContent = "";
  const canon = cats.find((c) => c.toLowerCase() === (t.category || "").toLowerCase());
  selected = { category: canon || t.category, new: false };
  if (!canon && t.category) sheet.cats = [t.category, ...cats];
  $("frequent").hidden = true;
  setDay(t.date === today() ? "0" : t.date === yesterday() ? "1" : "other", t.date);
  setDayEnabled(editable);
  $("where").hidden = true;
  $("split-box").hidden = true;
  renderCats();
  showSheet();
}

let scrollBefore = 0;
function showSheet() {
  scrollBefore = window.scrollY;
  $("sheet").hidden = false;
  $("sheet").scrollTop = 0;
  document.body.classList.add("sheet-open");
}
function closeSheet() {
  document.activeElement?.blur();
  $("sheet").hidden = true;
  document.body.classList.remove("sheet-open");
  window.scrollTo(0, scrollBefore);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
$("sheet-close").addEventListener("click", closeSheet);
// sul Mac la schermata è una finestra al centro: un clic sullo sfondo scuro la chiude
document.addEventListener("click", (e) => { if (!$("sheet").hidden && e.target === document.body) closeSheet(); });
$("fab").addEventListener("click", () => openAdd(view === "trips" && currentTrip ? { trip: currentTrip, onDone: () => showTrip(currentTrip) } : {}));

// ---------- data ----------

function setDay(choice, date) {
  dayChoice = choice;
  document.querySelectorAll("#day-seg button").forEach((b) => b.classList.toggle("on", b.dataset.day === choice));
  $("date").hidden = choice !== "other";
  $("date").value = date || today();
}
function setDayEnabled(on) {
  document.querySelectorAll("#day-seg button").forEach((b) => (b.disabled = !on));
  $("date").disabled = !on;
}
function chosenDate() {
  return dayChoice === "0" ? today() : dayChoice === "1" ? yesterday() : ($("date").value || today());
}
$("date").addEventListener("change", () => { if (splitCustom) renderSplitCustom(); updateSave(); });
$("day-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-day]"); if (!b || b.disabled) return;
  setDay(b.dataset.day, b.dataset.day === "other" ? ($("date").value || today()) : null);
  if (b.dataset.day === "other") $("date").showPicker?.();
});

// ---------- categorie ----------

function renderCats() {
  const cats = sheet.cats;
  if (!manualPick) {
    const top = suggestions[0];
    selected = top ? { category: top.category, new: !!top.new } : null;
  }
  // in cima le categorie suggerite (anche quelle nuove), poi tutte le altre nell'ordine di sempre
  const lc = (x) => x.toLowerCase();
  const sugg = [];
  suggestions.slice(0, 3).forEach((s, i) => {
    if (!sugg.some((x) => lc(x.category) === lc(s.category))) sugg.push({ ...s, tag: s.new ? "nuova" : i === 0 ? "consigliata" : "" });
  });
  if (selected?.new && !sugg.some((x) => lc(x.category) === lc(selected.category))) sugg.push({ ...selected, tag: "nuova" });
  // in modifica la categoria di partenza sta sempre in cima, così si vede subito
  if (sheet.mode === "edit" && sheet.tx?.category) {
    const orig = cats.find((c) => lc(c) === lc(sheet.tx.category)) || sheet.tx.category;
    if (!sugg.some((x) => lc(x.category) === lc(orig))) sugg.unshift({ category: orig, new: false, tag: "attuale" });
  }
  const rest = cats.filter((c) => !sugg.some((x) => lc(x.category) === lc(c)));

  $("cat-grid").innerHTML =
    (sugg.length ? `<li class="sep">${sheet.mode === "edit" ? "Attuale" : "Suggerite"}</li>` + sugg.map((x) => catItem(x.category, x.new, x.tag)).join("") +
      `<li class="sep">Tutte le categorie</li>` : "") +
    rest.map((c) => catItem(c, false, "")).join("") +
    (newCatOpen
      ? `<li class="new-cat-row"><input id="newcat-name" placeholder="Nome (es. Trasporti)" autocapitalize="sentences">
           <button type="button" class="primary" id="newcat-ok">Usa</button></li>`
      : `<li><button type="button" class="pick other" data-other="1"><span class="emoji">＋</span><span class="name">Nuova categoria…</span></button></li>`);
  updateSave();
}

function catItem(cat, isNew, tag) {
  const on = selected && selected.category.toLowerCase() === cat.toLowerCase();
  return `<li><button type="button" class="pick ${isNew ? "new" : ""} ${on ? "on" : ""}" data-cat="${esc(cat)}" data-new="${isNew ? 1 : 0}">
    <span class="emoji">${emoji(cat)}</span><span class="name">${esc(cat)}${tag ? `<small class="tag">${tag}</small>` : ""}</span>
    <span class="radio"></span></button></li>`;
}

$("cat-grid").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.other) {
    newCatOpen = true;
    renderCats();
    $("newcat-name").focus();
    return;
  }
  if (b.id === "newcat-ok") {
    const name = $("newcat-name").value.trim();
    if (!name) return $("newcat-name").focus();
    const existing = sheet.cats.find((c) => c.toLowerCase() === name.toLowerCase());
    selected = { category: existing || name.charAt(0).toUpperCase() + name.slice(1), new: !existing };
    newCatOpen = false;
  } else {
    selected = { category: b.dataset.cat, new: b.dataset.new === "1" };
  }
  manualPick = true;
  renderCats();
});

$("cat-grid").addEventListener("keydown", (e) => {
  if (e.target.id === "newcat-name" && e.key === "Enter") { e.preventDefault(); $("newcat-ok").click(); }
});



// ---------- suggerimenti ----------

let debounce;
$("desc").addEventListener("input", () => {
  $("frequent").hidden = sheet.mode !== "add" || !!$("desc").value.trim() || !quickItems.length;
  if (sheet.mode === "edit" || sheet.trip) return updateSave();
  manualPick = false;
  clearTimeout(debounce);
  const text = $("desc").value.trim();
  if (!text) { suggestions = []; $("hint").textContent = ""; renderCats(); return; }
  debounce = setTimeout(() => fetchSuggest(text, false), 180);
});

async function fetchSuggest(text, ai) {
  const seq = ++suggestSeq;
  try {
    if (ai) $("hint").textContent = "· chiedo a Claude…";
    const r = await api("/api/suggest", { method: "POST", body: { description: text, ai, date: chosenDate() } });
    if (seq !== suggestSeq || $("desc").value.trim() !== text) return;
    setOnline(true);
    suggestions = r.suggestions;
    $("hint").textContent = ai && r.ai_used ? "· suggerita da Claude" : "";
    if (ai && r.ai_used) manualPick = false;
    renderCats();
    const best = suggestions[0]?.score || 0;
    if (!ai && best < 0.8 && data?.ai?.available) {
      clearTimeout(fetchSuggest.t);
      fetchSuggest.t = setTimeout(() => { if ($("desc").value.trim() === text && !manualPick) fetchSuggest(text, true); }, 1200);
    }
  } catch (e) {
    if (e.network) setOnline(false);
    if (ai) { $("hint").textContent = ""; return; }
    if (e.network && seq === suggestSeq) {  // Mac spento: suggerisco io dal pacchetto salvato nel telefono
      suggestions = localSuggest(text, sheet.cats);
      $("hint").textContent = suggestions.length ? "· suggerita sul telefono" : "";
      renderCats();
    }
  }
}

// ---------- versione: se il Mac ne ha una più nuova di questa copia, butto la copia e ricarico ----------
async function checkVersion() {
  try {
    const r = await fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout?.(5000) });
    const { version } = await r.json();
    if (!version || !APP_VERSION || version === APP_VERSION) return;
    const flag = "reloaded-for-" + version;
    if (sessionStorage.getItem(flag)) return window.__diag?.(`versione ancora vecchia dopo il ricaricamento: ${APP_VERSION} invece di ${version}`);
    sessionStorage.setItem(flag, "1");
    window.__diag?.(`copia vecchia ${APP_VERSION}, sul Mac ${version}: aggiorno`);
    await resetAppCopy(false);
  } catch {}
}

/** Cancella la copia dell'app (non i dati, la coda o le impostazioni) e ricarica dal Mac. */
async function resetAppCopy(unregister = true) {
  try {
    if (unregister) for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister();
    else (await navigator.serviceWorker?.getRegistration?.())?.update?.();
    for (const k of await caches.keys()) if (k.startsWith("spese-")) await caches.delete(k);
  } catch {}
  location.reload();
}

// ---------- scatola nera: quando il Mac risponde, gli mando cosa è successo agli avvii precedenti ----------
async function sendDiag() {
  try {
    const app = JSON.parse(localStorage.getItem("diag-app") || "[]");
    const c = await caches?.open("diag");
    const r = c && await c.match("/__diag");
    const sw = r ? await r.json() : [];
    if (!app.length && !sw.length) return;
    const res = await fetch("/api/diag", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app, sw, ua: navigator.userAgent, standalone: !!navigator.standalone }), signal: AbortSignal.timeout?.(8000) });
    if (res.ok) { localStorage.removeItem("diag-app"); await c?.delete("/__diag"); }
  } catch {}
}

// ---------- suggerimento offline (copia leggera di suggest.py) ----------
const normDesc = (t) => String(t || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^\p{L}\p{N}& ]+/gu, " ").replace(/\s+/g, " ").trim();
async function loadOfflinePack() {
  const last = store.get("pack-time", 0);
  if (Date.now() - last < 12 * 3600e3 && store.get("offline-pack", null)) return;
  try {
    const r = await fetch("/api/offline-pack", { signal: AbortSignal.timeout?.(8000) });
    if (r.ok) { store.set("offline-pack", await r.json()); store.set("pack-time", Date.now()); }
  } catch {}
}

// La copia per il Mac spento si fa solo delle pagine aperte: con il Mac raggiungibile scarico in sottofondo anche
// Storico (ultimi mesi e anno), Budget, Risparmi e viaggi, così a Mac spento si vede tutto (stessi percorsi delle pagine).
async function warmOffline() {
  if (!online || warmOffline.busy || Date.now() - store.get("warm-time", 0) < 10 * 60e3) return;
  warmOffline.busy = true;
  const get = (path) => api(path).catch(() => null);
  try {
    const m = await api("/api/months");
    for (const x of m.months.filter((x) => !x.future).slice(-6)) await get("/api/month?sheet=" + encodeURIComponent(x.sheet));
    await get("/api/year");
    await get("/api/insights");
    await get("/api/profile");
    const idx = m.months.findIndex((x) => x.sheet === m.current);
    const target = m.months.find((x, i) => x.editable && (idx < 0 || i >= idx));
    if (target) {
      const q = "?sheet=" + encodeURIComponent(target.sheet);
      await get("/api/budget/proposal?" + new URLSearchParams({ save_rate: 0, sheet: target.sheet }));
      await get("/api/categories" + q);
      await get("/api/subscriptions" + q);
    }
    for (const t of ((await get("/api/trips"))?.trips || []).slice(0, 10)) await get("/api/trip?name=" + encodeURIComponent(t.name));
    if (online) store.set("warm-time", Date.now());
  } catch {} finally { warmOffline.busy = false; }
}
function localSuggest(text, known) {
  const pack = store.get("offline-pack", null);
  const key = normDesc(text);
  if (!pack || !key) return [];
  const scores = {};
  const add = (cat, sc) => { if (cat && sc > (scores[cat] || 0)) scores[cat] = sc; };
  add(pack.learned[key], 1);
  add(pack.history[key], 0.95);
  for (const [d, cat] of Object.entries(pack.history)) {
    if (d.length >= 3 && key.length >= 3 && (key.includes(d) || d.includes(key))) add(cat, 0.7);
  }
  const padded = ` ${key} `;
  for (const [cat, words] of Object.entries(pack.keywords)) {
    for (const w of words) {
      const ww = w.toLowerCase().trim();
      if (padded.includes(` ${ww} `) || (ww.length > 4 && key.includes(ww))) add(cat, ww.length > 3 ? 0.75 : 0.6);
    }
  }
  const lc = (x) => x.toLowerCase();
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat, score]) => {
    const canon = known.find((k) => lc(k) === lc(cat));
    return { category: canon || cat, score, new: !canon };
  });
}

// ---------- spese frequenti ----------

let quickItems = [];
async function loadQuick() {
  try { quickItems = (await api("/api/quick")).items; } catch { quickItems = []; }
  $("freq-pills").innerHTML = quickItems.map((q, i) =>
    `<button type="button" data-q="${i}">${emoji(q.category)} ${esc(q.description)}<small>${eur(q.amount)}</small></button>`).join("");
}
$("freq-pills").addEventListener("click", (e) => {
  const b = e.target.closest("[data-q]"); if (!b) return;
  const q = quickItems[+b.dataset.q];
  $("amount").value = amountIn(q.amount);
  $("desc").value = q.description;
  $("frequent").hidden = true;
  selected = { category: q.category, new: !sheet.cats.some((c) => c.toLowerCase() === (q.category || "").toLowerCase()) };
  manualPick = true;
  renderCats();
});

// ---------- salvataggio ----------

function updateSave() {
  const amount = parseAmount($("amount").value);
  const ok = amount > 0 && $("desc").value.trim() && selected?.category;
  const n = splitActive() ? splitN : 1;
  $("save").disabled = !ok;
  $("save").textContent = sheet.mode === "edit" ? "Salva modifiche" : amount > 0 ? `Salva ${eur(amount)}${n > 1 ? ` in ${n} rate` : ""}` : "Salva";
  $("split-hint").textContent = n > 1 && amount > 0 ? splitText(amount, n) : n > 1 ? `Una rata al mese per ${n} mesi, a partire dalla data scelta.` : "";
}

// ---------- spesa divisa su più mesi ----------

let splitN = 1;
let splitCustom = false;  // "Scegli…": numero di mesi libero o "fino a <mese>"
const SPLIT_MAX = 24;
const splitActive = () => sheet.mode === "add" && !sheet.trip && splitN > 1;
function setSplit(n, custom = false) {
  splitN = Math.max(1, Math.min(SPLIT_MAX, Math.round(n) || 1));
  splitCustom = custom;
  document.querySelectorAll("#split-pills button").forEach((b) =>
    b.classList.toggle("on", custom ? b.dataset.n === "custom" : +b.dataset.n === splitN));
  $("split-custom").hidden = !custom;
  if (custom) renderSplitCustom();
  updateSave();
}
const splitMonth = (k) => { const d = new Date(chosenDate()); return new Date(d.getFullYear(), d.getMonth() + k, 1); };
function renderSplitCustom() {
  $("split-n").value = splitN;
  // "fino a": dal mese dopo quello della spesa fino a 24 mesi
  $("split-until").innerHTML = Array.from({ length: SPLIT_MAX - 1 }, (_, i) => {
    const n = i + 2;
    const label = splitMonth(n - 1).toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
    return `<option value="${n}" ${n === splitN ? "selected" : ""}>${label}</option>`;
  }).join("");
}
function splitText(amount, n) {
  const m = (k) => splitMonth(k).toLocaleDateString(LOCALE, { month: "short", year: splitMonth(0).getFullYear() !== splitMonth(n - 1).getFullYear() ? "2-digit" : undefined });
  return `${n} rate da ${eur(Math.round((amount / n) * 100) / 100)} · da ${m(0)} a ${m(n - 1)}, una per mese`;
}
$("split-pills").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-n]"); if (!b) return;
  if (b.dataset.n === "custom") setSplit(Math.max(2, splitN), true);
  else setSplit(+b.dataset.n);
});
$("split-minus").addEventListener("click", () => setSplit(Math.max(2, splitN - 1), true));
$("split-plus").addEventListener("click", () => setSplit(splitN + 1, true));
$("split-n").addEventListener("change", () => setSplit(Math.max(2, parseInt($("split-n").value, 10) || 2), true));
$("split-until").addEventListener("change", () => setSplit(+$("split-until").value, true));
$("amount").addEventListener("input", updateSave);

async function send(exp) {
  const r = await api(exp.trip ? "/api/trips/expense" : "/api/expenses", { method: "POST", body: exp });
  setOnline(true);
  return r;
}

async function flushQueue() {
  const q = queue();
  if (!q.length) return;
  const left = [];
  for (const e of q) {
    try { await send(e); }
    catch (err) {
      if (err.network) { left.push(e); setOnline(false); }
      else if (err.status) toast(`"${e.description}" non salvata: ${err.message}`);
      else { left.push(e); failMsg(err); }  // errore dell'app: la spesa resta in coda
    }
  }
  setQueue(left);
  const sent = q.length - left.length;
  if (sent) {
    toast(`${sent} ${sent === 1 ? "spesa inviata" : "spese inviate"} al Mac`);
    refresh();
    if (view === "history") loadHistory();  // quello che si vede era la copia di prima
  }
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const amount = parseAmount($("amount").value);
  if (!(amount > 0) || !selected) return;
  const base = { date: chosenDate(), description: $("desc").value.trim(), amount, category: selected.category,
    note: $("note").value.trim() || null };

  if (sheet.mode === "edit") {
    const t = sheet.tx;
    const expect = { description: t.description, amount: t.amount };
    try {
      const r = sheet.trip
        ? await api("/api/trips/edit", { method: "POST", body: { ...base, trip: sheet.trip, row: t.row, expect } })
        : await api("/api/expenses/edit", { method: "POST", body: { ...base, sheet: t.sheet, row: t.row,
            date: sheet.editable ? base.date : null, expect } });
      toast(r.moved ? `Spostata in ${r.sheet}` : "Modifica salvata");
      closeSheet();
      sheet.onDone?.();
    } catch (err) { toast(failMsg(err)); }
    return;
  }

  const exp = { id: uid(), ...base };
  if (sheet.trip) exp.trip = sheet.trip;
  else if (splitActive()) exp.split = splitN;
  if (selected.new) {
    const budget = await askNewCategory(selected.category, sheet.trip);
    if (budget === null) return;
    exp.new_category_budget = budget;
  }
  $("save").disabled = true;
  try {
    const r = await send(exp);
    toast(r.status === "queued" ? r.reason : r.trip ? `✓ Salvata nel viaggio ${r.trip}` : r.split > 1 ? `✓ Divisa in ${r.split} rate in ${r.category}` : `✓ Salvata in ${r.category}${r.created_sheet ? " · nuovo mese creato" : ""}`);
  } catch (err) {
    if (!err.network) { toast(failMsg(err)); updateSave(); return; }
    setQueue([...queue(), exp]);
    setOnline(false);
    toast("Salvata sul telefono: la invio appena il Mac è raggiungibile");
  }
  closeSheet();
  refresh();
  if (view === "history") loadHistory();
  if (view === "trips") currentTrip ? showTrip(currentTrip) : loadTrips();
  else if (exp.trip) loadTripsCache();
});

$("sheet-delete").addEventListener("click", async () => {
  const t = sheet.tx;
  if (!t || !(await askConfirm("Eliminare la spesa?", `${t.description} · ${eur(t.amount)}`))) return;
  try {
    const expect = { description: t.description, amount: t.amount };
    if (sheet.trip) await api("/api/trips/delete-expense", { method: "POST", body: { trip: sheet.trip, row: t.row, expect } });
    else await api("/api/expenses/delete", { method: "POST", body: { sheet: t.sheet, row: t.row, expect } });
    toast("Spesa eliminata");
    closeSheet();
    sheet.onDone?.();
  } catch (err) { toast(failMsg(err)); }
});

function askConfirm(title, text) {
  return new Promise((resolve) => {
    const dlg = $("confirm");
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    dlg.onclose = () => resolve(dlg.returnValue === "ok");
    dlg.returnValue = "";
    dlg.showModal();
  });
}

function askNewCategory(name, trip = null) {
  return new Promise((resolve) => {
    const dlg = $("newcat");
    $("nc-name").textContent = name;
    $("nc-text").textContent = trip ? `La aggiungo al viaggio ${trip}, anche in Excel.` : "La trovi da questo mese in poi, anche in Excel.";
    $("nc-label").textContent = trip ? "Budget per il viaggio (€)" : "Budget al mese (€)";
    $("nc-budget").value = "0";
    dlg.onclose = () => resolve(dlg.returnValue === "ok" ? (parseAmount($("nc-budget").value) || 0) : null);
    dlg.showModal();
  });
}

// ================= STORICO =================

let histMode = "month";
let monthsInfo = null;
let monthData = null;
let catFilter = null;

async function loadHistory(opts = {}) {
  if (opts.category) { catFilter = opts.category; histMode = "month"; }
  if (opts.month) { store.set("month", opts.month); histMode = "month"; }
  setHistMode(histMode);
  try {
    monthsInfo = await api("/api/months");
    if (histMode === "year") return loadYear();
    const sheets = monthsInfo.months.map((m) => m.sheet);
    let cur = store.get("month", null);
    if (!sheets.includes(cur)) cur = monthsInfo.current || sheets.at(-1);
    if (opts.category && monthsInfo.current) cur = monthsInfo.current;
    await showMonth(cur, !!opts.category);
  } catch (err) { $("month-list").innerHTML = `<p class="empty">${esc(failMsg(err))}</p>`; }
}

function setHistMode(mode) {
  histMode = mode;
  document.querySelectorAll("#history-seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("hist-month").hidden = mode !== "month";
  $("hist-year").hidden = mode !== "year";
}
$("history-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]"); if (!b) return;
  setHistMode(b.dataset.mode);
  if (b.dataset.mode === "year") loadYear(); else loadHistory();
});

async function showMonth(sheetName, keepFilter) {
  store.set("month", sheetName);
  if (!keepFilter) catFilter = null;
  const ordered = [...monthsInfo.months.filter((m) => !m.future).reverse(), ...monthsInfo.months.filter((m) => m.future)];
  $("month-pills").innerHTML = ordered.map((m) =>
    `<button data-sheet="${esc(m.sheet)}" class="${m.sheet === sheetName ? "on" : ""} ${m.future ? "future" : ""}">${esc(m.sheet)}</button>`).join("");
  monthData = await api("/api/month?sheet=" + encodeURIComponent(sheetName));
  renderMonth();
}

$("month-pills").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sheet]"); if (!b) return;
  showMonth(b.dataset.sheet).catch((err) => toast(failMsg(err)));
});

function weekRange(w, sheetName) {
  const tx = monthData.transactions.find((t) => t.date);
  if (!monthData.summary.editable || !tx) return "";
  const d = new Date(tx.date);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const from = 7 * (w - 1) + 1, to = w === 5 ? last : Math.min(7 * w, last);
  const m = d.toLocaleDateString(LOCALE, { month: "short" });
  return ` · ${from}–${to} ${m}`;
}

function renderMonth() {
  const { summary: s0, transactions: txs } = monthData;
  const s = { ...s0, ...adjusted(s0) };
  const left = s.budget - s.total;
  $("month-excl").innerHTML = exclHtml();
  $("month-summary").innerHTML = `<div><span>Speso${s.label ? " *" : ""}</span><b>${eur(s.total)}</b></div>
    <div><span>Budget</span><b>${s.budget ? eur0(s.budget) : "—"}</b></div>
    <div><span>${!s.budget ? "Rimasto" : left >= 0 ? "Avanzo" : "Sforato"}</span><b class="${s.budget ? sign(left) : ""}">${s.budget ? eur(Math.abs(left)) : "—"}</b></div>`;

  const withBudget = s.categories.filter((c) => c.total > 0 || c.budget > 0).sort((a, b) => b.total - a.total);
  $("month-cats").innerHTML = withBudget.length ? withBudget.map(catRow).join("") : `<li class="empty" style="display:block">Nessuna spesa né budget.</li>`;

  const withSpend = s.categories.filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  $("cat-pills").innerHTML = `<button data-cat="" class="${!catFilter ? "on" : ""}">Tutte</button>` +
    withSpend.map((c) => `<button data-cat="${esc(c.category)}" class="${catFilter && catFilter.toLowerCase() === c.category.toLowerCase() ? "on" : ""}">
      ${emoji(c.category)} ${esc(c.category)}<small>${eur0(c.total)}</small></button>`).join("");

  const canon = (c) => monthData.categories.find((x) => x.toLowerCase() === String(c || "").toLowerCase()) || c;
  const list = txs.map((t) => ({ ...t, category: canon(t.category) }))
    .filter((t) => !catFilter || (t.category || "").toLowerCase() === catFilter.toLowerCase());
  const byWeek = {};
  list.forEach((t) => (byWeek[t.week || 0] ||= []).push(t));
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
  let idx = 0;
  const flat = [];
  monthFlat = flat;
  $("month-list").innerHTML = weeks.length ? weeks.map((w) => {
    const items = byWeek[w];
    const tot = items.reduce((a, t) => a + t.amount, 0);
    return `<div class="group-head"><span>${w ? "Settimana " + w + weekRange(w) : "Senza data"}</span><span>${eur(tot)}</span></div>
      <div class="card group"><ul class="tx-list">${items.map((t) => { flat.push(t); return txRow(t, idx++); }).join("")}</ul></div>`;
  }).join("") : `<p class="empty">Nessuna spesa${catFilter ? " in questa categoria" : ""}.</p>`;
  $("month-list").onclick = (e) => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    const t = flat[+li.dataset.i];
    if (t.trip) return go("trips", { trip: t.trip });
    openEdit(t, monthData.categories, s.editable, () => showMonth(s.sheet, true));
  };
}

$("month-cats").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-cat]"); if (!li) return;
  catFilter = li.dataset.cat;
  renderMonth();
  $("month-list").scrollIntoView({ behavior: "smooth" });
});

$("cat-pills").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cat]"); if (!b) return;
  catFilter = b.dataset.cat || null;
  renderMonth();
});

async function loadYear() {
  try {
    const y = await api("/api/year");
    const t = y.total;
    $("year-stats").innerHTML = `<div><span>Budget</span><b>${eur0(t.budget)}</b></div>
      <div><span>Speso</span><b>${eur0(t.spent)}</b></div>
      <div><span>${t.surplus >= 0 ? "Surplus" : "Deficit"}</span><b class="${sign(t.surplus)}">${eur(t.surplus)}</b></div>`;
    const past = y.months.filter((m) => !m.future).reverse();
    const next = y.months.filter((m) => m.future);
    const ordered = [...past, ...(next.length ? [{ heading: "Prossimi mesi" }] : []), ...next];
    $("year-list").innerHTML = ordered.map((m) => {
      if (m.heading) return `<div class="group-head"><span>${m.heading}</span></div>`;
      const now = m.current;
      if (m.future) {
        return `<div class="month-card future" data-sheet="${esc(m.sheet || "")}">
          <div class="top"><b>${esc(m.month)}</b><span class="badge none">da iniziare</span></div>
          <div class="meta">Budget ${m.budget ? eur0(m.budget) : "non ancora impostato"}</div></div>`;
      }
      const pct = m.budget > 0 ? Math.min(100, (m.spent / m.budget) * 100) : 100;
      const badge = m.budget > 0
        ? `<span class="badge ${sign(m.surplus)}">${m.surplus >= 0 ? "+" : "−"}${eur(Math.abs(m.surplus))}</span>`
        : `<span class="badge none">senza budget</span>`;
      const saved = now ? `finora restano ${eur(m.saved)}` : `${m.saved >= 0 ? "risparmiati" : "in rosso di"} ${eur(Math.abs(m.saved))}`;
      return `<div class="month-card" data-sheet="${esc(m.sheet || "")}">
        <div class="top"><b>${esc(m.month)}${now ? " <span class='hint'>· in corso</span>" : ""}</b>${badge}</div>
        <div class="progress"><i class="${!m.budget ? "none" : m.spent > m.budget ? "over" : ""}" style="width:${pct}%"></i></div>
        <div class="meta">Speso ${eur(m.spent)} su budget ${m.budget ? eur0(m.budget) : "non impostato"}</div>
        <div class="meta">Entrate ${eur0(m.income)} · ${saved}</div>
      </div>`;
    }).join("");
  } catch (err) { $("year-list").innerHTML = `<p class="empty">${esc(failMsg(err))}</p>`; }
}

$("year-list").addEventListener("click", (e) => {
  const c = e.target.closest(".month-card[data-sheet]"); if (!c || !c.dataset.sheet) return;
  loadHistory({ month: c.dataset.sheet });
});

// ---------- Excel ----------

let excelInfo = null;
document.addEventListener("click", async (e) => {
  if (!e.target.closest(".excel-btn")) return;
  try { excelInfo ||= await api("/api/excel"); } catch (err) { return toast(failMsg(err)); }
  if (excelInfo.on_mac) {
    try { await api("/api/excel/open", { method: "POST" }); toast("Apro il file in Excel"); } catch (err) { toast(failMsg(err)); }
  } else {
    toast("Apro Excel: il file è tra i recenti. Le modifiche fatte lì arrivano qui da sole.");
    location.href = "ms-excel:";
  }
});

// ================= BUDGET =================

let budgetMode = "plan";

function setBudgetMode(mode) {
  budgetMode = mode;
  document.querySelectorAll("#budget-seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("bud-plan").hidden = mode !== "plan";
  $("bud-cats").hidden = mode !== "cats";
  $("bud-sav").hidden = mode !== "sav";
  $("budget-pills").hidden = mode === "sav";
}

async function loadBudgetView() {
  setBudgetMode(budgetMode);
  if (budgetMode === "sav") return loadSavings();
  await loadBudget();
}

$("budget-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]"); if (!b) return;
  setBudgetMode(b.dataset.mode);
  loadBudgetView();
});

let budgetTarget = null;
let proposalData = null;
let saveRate = 10;          // % delle entrate di base
let saveFixed = null;       // importo scritto a mano (al posto della %)
let useCarry = false;
let propEdits = {};         // cifre cambiate a mano: restano anche se cambi entrate o risparmio
let propExtra = [];         // categorie aggiunte dal piano (es. "Altro"), create al salvataggio
let profile = {};

// Quiz: ogni risposta moltiplica la media storica delle categorie che contengono la parola chiave.
// Il totale resta quello che puoi spendere: il quiz sposta i soldi tra le categorie variabili.
const QUIZ = [
  { id: "cucina", q: "Quanto cucini a casa?", opts: [
    ["Quasi sempre", { spesa: 1.1, mensa: 0.8, "fast food": 0.7, ristor: 0.7 }], ["A volte", {}],
    ["Raramente", { spesa: 0.85, mensa: 1.2, "fast food": 1.25, ristor: 1.25 }]] },
  { id: "uscite", q: "Quanto esci (bar, serate, svago)?", opts: [
    ["Poco", { svago: 0.75 }], ["Normale", {}], ["Spesso", { svago: 1.3 }]] },
  { id: "acquisti", q: "Hai acquisti grandi in vista (vestiti, tecnologia)?", opts: [
    ["No", { abbigliamento: 0.7, varie: 0.85 }], ["Qualcosa", {}], ["Sì", { abbigliamento: 1.3, varie: 1.2 }]] },
  { id: "viaggi", q: "Hai viaggi in programma?", opts: [
    ["No", { viaggi: 0.3 }], ["Uno piccolo", {}], ["Sì, importanti", { viaggi: 1.6 }]] },
  { id: "obiettivo", q: "Cosa conta di più per te?", opts: [
    ["Risparmiare", {}, 15], ["Equilibrio", {}, 10], ["Stare tranquillo", {}, 5]] },
];

function quizFactor(category) {
  const c = category.toLowerCase();
  let f = 1;
  for (const q of QUIZ) {
    const a = profile.quiz?.[q.id];
    if (a == null) continue;
    for (const [k, m] of Object.entries(q.opts[a][1])) if (c.includes(k)) f *= m;
  }
  return f;
}

function renderQuiz() {
  const answers = profile.quiz || {};
  const n = QUIZ.filter((q) => answers[q.id] != null).length;
  $("quiz-state").textContent = n === QUIZ.length ? "Fatto · la proposta tiene conto delle tue risposte"
    : n ? `${n} di ${QUIZ.length} risposte` : `${QUIZ.length} domande veloci`;
  $("quiz-list").innerHTML = QUIZ.map((q) => `<div class="quiz-q"><p>${esc(q.q)}</p>
    <div class="pills">${q.opts.map((o, i) => `<button type="button" data-q="${q.id}" data-a="${i}" class="${answers[q.id] === i ? "on" : ""}">${esc(o[0])}</button>`).join("")}</div></div>`).join("")
    + (n ? `<button type="button" class="text-btn" id="quiz-reset">Cancella le risposte</button>` : "");
}

$("quiz-list").addEventListener("click", (e) => {
  if (e.target.id === "quiz-reset") { profile.quiz = {}; }
  else {
    const b = e.target.closest("button[data-q]"); if (!b) return;
    profile.quiz = { ...profile.quiz, [b.dataset.q]: +b.dataset.a };
    const q = QUIZ.find((x) => x.id === b.dataset.q);
    if (q.opts[+b.dataset.a][2] != null) { setSave(q.opts[+b.dataset.a][2], null); rememberPlan(); }
  }
  api("/api/profile", { method: "PUT", body: profile }).catch(() => {});
  renderQuiz();
  renderProposal();
});

async function loadBudget() {
  try {
    const m = await api("/api/months");
    // mesi pianificabili: da quello in corso in poi (+ il prossimo se non esiste ancora)
    const idx = m.months.findIndex((x) => x.sheet === m.current);
    const opts = m.months.filter((x, i) => x.editable && (idx < 0 || i >= idx)).map((x) => ({ label: x.sheet, sheet: x.sheet }));
    // file nuovo: il mese in corso non esiste ancora, lo propongo per primo (si crea al salvataggio)
    if (!m.current && m.this && !opts.some((o) => o.label === m.this.label)) opts.unshift({ label: m.this.label, sheet: null, date: m.this.date });
    if (!m.next.sheet) opts.push({ label: m.next.label, sheet: null, date: m.next.date });
    loadBudget.opts = opts;
    if (!budgetTarget || !opts.some((o) => o.label === budgetTarget.label)) budgetTarget = opts[0];
    $("budget-pills").innerHTML = opts.map((o, i) =>
      `<button data-i="${i}" class="${o.label === budgetTarget.label ? "on" : ""}">${esc(o.label)}</button>`).join("");
    if (budgetMode === "cats") return loadCatManage();
    try { profile = await api("/api/profile"); } catch { profile = {}; }
    if (profile.quiz?.obiettivo != null && saveFixed == null && !loadBudget.saveSet) setSave(QUIZ[4].opts[profile.quiz.obiettivo][2], null);
    renderQuiz();
    await fetchProposal();
  } catch (err) { $("prop-notes").innerHTML = `<li>${esc(failMsg(err))}</li>`; }
}

$("budget-pills").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  budgetTarget = loadBudget.opts[+b.dataset.i];
  document.querySelectorAll("#budget-pills button").forEach((x) => x.classList.toggle("on", x === b));
  budgetMode === "cats" ? loadCatManage() : fetchProposal();
});

function setSave(rate, fixed) {
  saveRate = rate; saveFixed = fixed;
  document.querySelectorAll("#save-pills button").forEach((x) => x.classList.toggle("on", fixed == null && +x.dataset.rate === rate));
}
const saveEuro = () => saveFixed != null ? saveFixed : Math.round(typedBase() * saveRate / 100);

// Scelte del piano per ogni mese (quanto mettere da parte, se contare il surplus/deficit e quanto): nel profilo sul Mac,
// salvate appena le cambi, così rientrando nell'app (o da un altro dispositivo) restano. Il file cambia solo con Salva.
function rememberPlan() {
  if (!budgetTarget) return;
  profile.plan = { ...profile.plan, [budgetTarget.label]: { rate: saveRate, fixed: saveFixed, carry: useCarry, riporto: typedCarry() } };
  profile.plan_rate = saveRate;  // per i mesi mai toccati
  clearTimeout(rememberPlan.t);
  rememberPlan.t = setTimeout(() => api("/api/profile", { method: "PUT", body: { plan: profile.plan, plan_rate: profile.plan_rate } }).catch(() => {}), 600);
}

$("save-pills").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-rate]"); if (!b) return;
  loadBudget.saveSet = true;
  setSave(+b.dataset.rate, null);
  renderProposal();
  rememberPlan();
});
$("save-amount").addEventListener("input", () => {
  loadBudget.saveSet = true;
  const v = parseAmount($("save-amount").value);
  setSave(saveRate, Number.isFinite(v) ? Math.max(0, v) : null);
  renderProposal(true);
  rememberPlan();
});

$("carry-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-use]"); if (!b) return;
  setCarry(b.dataset.use === "1");
  renderProposal();
  rememberPlan();
});

function setCarry(on) {
  useCarry = on;
  document.querySelectorAll("#carry-seg button").forEach((x) => x.classList.toggle("on", (x.dataset.use === "1") === on));
}

async function fetchProposal() {
  const q = new URLSearchParams({ save_rate: 0 });
  if (budgetTarget.sheet) q.set("sheet", budgetTarget.sheet); else q.set("date", budgetTarget.date);
  try { proposalData = await api("/api/budget/proposal?" + q); }
  catch (err) { $("prop-notes").innerHTML = `<li>${esc(failMsg(err))}</li>`; return; }
  const p = proposalData;
  propEdits = {}; propExtra = [];
  // entrate a lista (modello vuoto): voci libere; nel file con borsa/personale/famiglia restano i campi fissi
  incItems = Array.isArray(p.income.items) ? p.income.items.map((i) => ({ ...i })) : null;
  $("inc-fixed").hidden = !!incItems;
  $("inc-free").hidden = !incItems;
  if (incItems) renderIncome();
  $("inc-borsa").value = numIn(p.income.borsa);
  $("inc-personale").value = numIn(p.income.personale);
  $("inc-famiglia").value = numIn(p.income.famiglia);
  $("inc-altro").value = numIn(p.income.altro);
  // riporto: quello già salvato nel mese, altrimenti il surplus/deficit dei mesi conclusi
  const carry = p.carry_included ? p.income.riporto : p.carry;
  $("inc-riporto").value = carry ? numIn(carry) : "";
  setCarry(!!p.carry_included);
  // scelte ricordate per questo mese; per un mese mai toccato vale l'ultima percentuale scelta
  const saved = profile.plan?.[budgetTarget.label];
  if (saved) {
    setSave(saved.rate ?? saveRate, saved.fixed ?? null);
    setCarry(!!saved.carry);
    if (saved.carry && saved.riporto) $("inc-riporto").value = numIn(saved.riporto);
  } else if (profile.plan_rate != null) setSave(profile.plan_rate, null);
  const month = budgetTarget.label;
  $("step1-title").textContent = `Quanto ti entra a ${month}?`;
  $("apply-following").checked = false;
  $("apply-following-text").textContent = `Usa lo stesso budget anche per i mesi dopo ${month}`;
  renderProposal();
}

const typedBase = () => incItems ? incItems.reduce((a, i) => a + (i.amount || 0), 0)
  : ["borsa", "personale", "famiglia", "altro"].reduce((a, k) => a + (parseAmount($("inc-" + k).value) || 0), 0);

let incItems = null;  // [{ name, amount }] quando le entrate sono a lista
function renderIncome() {
  $("inc-list").innerHTML = incItems.map((it, i) => `<li data-i="${i}" class="field"><span>💶 ${esc(it.name)}</span>
    <input data-inc="${i}" inputmode="decimal" placeholder="0" value="${numIn(it.amount)}" aria-label="${esc(it.name)}"></li>`).join("");
  $("inc-empty").hidden = incItems.length > 0;
  $("inc-tip").hidden = !incItems.length;
}
$("inc-list").addEventListener("input", (e) => {
  const inp = e.target.closest("input[data-inc]"); if (!inp) return;
  incItems[+inp.dataset.inc].amount = parseAmount(inp.value) || 0;
  renderProposal();
});
$("inc-add").addEventListener("click", async () => {
  const res = await askNumber("Nuova entrata", "Scrivi il nome e quanto ti entra al mese.", 0, true);
  if (!res?.name) return;
  if (incItems.some((i) => i.name.toLowerCase() === res.name.toLowerCase())) return toast(`${res.name} c'è già`);
  if (incItems.length >= 10) return toast("Puoi avere al massimo 10 entrate");
  incItems.push({ name: res.name, amount: res.value });
  renderIncome(); renderProposal();
  toast("Premi «Usa questo budget» per salvarla");
});
function removeIncome(it) {
  incItems = incItems.filter((x) => x !== it);
  renderIncome(); renderProposal();
  toast(`${it.name} tolta · premi «Usa questo budget» per salvare`);
}
enableSwipe($("inc-list"), (li) => incItems?.[+li.dataset.i], removeIncome);
// sul Mac (niente scorrimento col mouse): un clic sul nome chiede se toglierla
$("inc-list").addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-i]"); if (!li || e.target.closest("input")) return;
  const it = incItems?.[+li.dataset.i]; if (!it) return;
  if (await askConfirm(`Togliere ${it.name}?`, "Sparisce dalle entrate di questo mese.")) removeIncome(it);
});
const typedCarry = () => parseAmount($("inc-riporto").value) || 0;
const allRows = () => [...proposalData.rows, ...propExtra];

/** Cifre proposte per ogni riga (prima delle modifiche a mano). */
function proposedValues() {
  const p = proposalData;
  const target = typedBase() - saveEuro() + (useCarry ? typedCarry() : 0);
  const rows = allRows();
  const fixed = rows.filter((r) => r.kind !== "variabile").reduce((a, r) => a + (propEdits[r.category] ?? r.proposal), 0);
  // le variabili cambiate a mano restano ferme; le altre si dividono quello che avanza
  const free = rows.filter((r) => r.kind === "variabile" && propEdits[r.category] == null);
  const manual = rows.filter((r) => r.kind === "variabile" && propEdits[r.category] != null).reduce((a, r) => a + propEdits[r.category], 0);
  const raw = (r) => (r.raw || 0) * quizFactor(r.category);
  const rawSum = free.reduce((a, r) => a + raw(r), 0);
  const k = rawSum ? Math.max(0, target - fixed - manual) / rawSum : 0;
  const plainK = p.rows.filter((r) => r.kind === "variabile").reduce((a, r) => a + (r.raw || 0), 0);
  const vals = rows.map((r) => propEdits[r.category] ?? (r.kind === "variabile" ? Math.max(0, Math.round((raw(r) * k) / 5) * 5) : r.proposal));
  // l'arrotondamento a 5 € lascia qualche euro in più o in meno: va nella variabile più grande
  const freeIdx = rows.map((r, i) => i).filter((i) => free.includes(rows[i]));
  if (freeIdx.length && k > 0) {
    const big = freeIdx.reduce((a, i) => (vals[i] > vals[a] ? i : a), freeIdx[0]);
    vals[big] = Math.max(0, Math.round(vals[big] + target - vals.reduce((a, v) => a + v, 0)));
  }
  return { vals, k, rawSum, plainK };
}

function renderProposal(keepSaveInput = false) {
  const p = proposalData;
  if (!p) return;
  const base = typedBase();
  const carry = typedCarry();

  // riga surplus/deficit
  $("carry-label").textContent = carry < 0 ? "Deficit mesi scorsi" : "Surplus mesi scorsi";
  $("carry-yes").textContent = carry < 0 ? "Sottrai" : "Aggiungi";
  $("carry-hint").textContent = !carry ? "Nessun surplus o deficit dai mesi conclusi."
    : carry < 0 ? `Sei sotto di ${eur(-carry)}: se lo sottrai, questo mese spendi meno per recuperare. Puoi anche mettere una cifra più piccola.`
    : `Ti sono avanzati ${eur(carry)}: puoi aggiungerli a quello che spendi oppure lasciarli da parte.`;

  const save = saveEuro();
  if (!keepSaveInput) $("save-amount").value = saveFixed != null ? numIn(saveFixed) : numIn(Math.round(save));
  $("save-line").innerHTML = base > 0
    ? `<span>Metti da parte</span><b>${eur0(save)} al mese</b><small>${Math.round((save / base) * 100)}% delle entrate · in un anno ${eur0(save * 12)}</small>`
    : `<small>Inserisci prima le entrate al passo 1.</small>`;

  const { vals, k, rawSum } = proposedValues();
  const rows = allRows();
  const avgTot = p.avg_total;
  const spendable = base - save + (useCarry ? carry : 0);
  const notes = [];
  if (!p.history_used.length) notes.push("Non ci sono ancora mesi conclusi: parto dai budget attuali.");
  if (avgTot > spendable && spendable > 0) notes.push(`Di solito spendi ${eur0(avgTot)} al mese, più di quanto puoi spendere (${eur0(spendable)}).`);
  if (rawSum && k < 0.85) notes.push(`Per starci dentro, le spese variabili scendono del ${Math.round((1 - k) * 100)}% rispetto al solito.`);
  $("prop-notes").innerHTML = notes.map((n) => `<li>${esc(n)}</li>`).join("");

  $("prop-list").innerHTML = rows.map((r, i) => {
    const hintTxt = r.kind === "nuova" ? "nuova · si crea quando salvi" : r.kind === "fissa" ? "spesa fissa"
      : r.avg ? `di solito ${eur0(r.avg)}` : "nessuno storico";
    const tuned = r.kind === "variabile" && quizFactor(r.category) !== 1 ? " · 🎯" : "";
    return `<li><span class="emoji">${emoji(r.category)}</span>
      <div class="what"><b>${esc(r.category)}</b><span>${hintTxt}${r.months_over >= 2 ? " · spesso sforata" : ""}${tuned}</span></div>
      <input data-i="${i}" inputmode="decimal" value="${numIn(vals[i])}" aria-label="Budget ${esc(r.category)}"></li>`;
  }).join("");
  $("prop-add-new").hidden = rows.length >= 15;
  updatePropTotal();
}

function typedBudgets() {
  return [...document.querySelectorAll("#prop-list input")].map((inp) => parseAmount(inp.value) || 0);
}

function updatePropTotal() {
  const base = typedBase(), carry = useCarry ? typedCarry() : 0, save = saveEuro();
  const spendable = base - save + carry;
  const assigned = typedBudgets().reduce((a, b) => a + b, 0);
  const left = spendable - assigned;
  $("prop-total").innerHTML = `<span>Assegnato ${eur0(assigned)}</span>
    <span class="${left < -0.5 ? "neg" : ""}">${Math.abs(left) < 0.5 ? "✓ Tutto assegnato" : left > 0 ? `Da assegnare ${eur0(left)}` : `Troppo: ${eur0(-left)}`}</span>`;

  const month = budgetTarget?.label || "";
  const carryRow = !typedCarry() ? ""
    : `<li><span>${typedCarry() < 0 ? "Deficit mesi scorsi" : "Surplus mesi scorsi"}</span>
       <b class="${useCarry ? sign(typedCarry()) : "off"}">${useCarry ? (typedCarry() < 0 ? "−" : "+") + eur0(Math.abs(typedCarry())) : "non contato"}</b></li>`;
  const finalSave = save + (left > 0 ? left : 0);
  $("plan-ladder").innerHTML = `<p class="big-label">Piano di ${esc(month)}</p>
    <ul class="ladder-rows">
      <li><span>Entrate</span><b>${eur0(base)}</b></li>
      <li><span>Da mettere da parte</span><b>−${eur0(save)}</b></li>
      ${carryRow}
      <li class="total"><span>Puoi spendere</span><b class="${spendable < 0 ? "neg" : ""}">${eur0(spendable)}</b></li>
    </ul>
    <div class="ladder-foot ${left < -0.5 ? "neg" : ""}">${base <= 0 ? "Inizia scrivendo le entrate al passo 1."
      : Math.abs(left) < 0.5 ? `✓ Hai diviso tutto tra le categorie. Risparmi ${eur0(save)}.`
      : left > 0 ? `Ti restano ${eur0(left)} da dividere tra le categorie. Se li lasci così, risparmi ${eur0(finalSave)}.`
      : `Le categorie superano di ${eur0(-left)} quello che puoi spendere.`}</div>`;
}

$("prop-list").addEventListener("input", (e) => {
  const inp = e.target.closest("input[data-i]"); if (!inp) return;
  propEdits[allRows()[+inp.dataset.i].category] = parseAmount(inp.value) || 0;
  updatePropTotal();
});
// finito di scrivere: le categorie non toccate si ridividono quello che resta
$("prop-list").addEventListener("change", () => renderProposal());
["inc-borsa", "inc-personale", "inc-famiglia", "inc-altro", "inc-riporto"].forEach((id) => $(id).addEventListener("input", () => renderProposal()));
$("inc-riporto").addEventListener("input", rememberPlan);

function addPlanCategory(name, value) {
  name = name.trim();
  if (!name) return;
  if (allRows().some((r) => r.category.toLowerCase() === name.toLowerCase())) return toast(`${name} c'è già`);
  propExtra.push({ category: name, kind: "nuova", proposal: value || 0, avg: 0, months_over: 0 });
  propEdits[name] = value || 0;
  renderProposal();
}
$("prop-add-new").addEventListener("click", async () => {
  const res = await askNumber("Nuova categoria", "Scrivi il nome e quanto vuoi spendere al mese.", 0, true);
  if (res?.name) addPlanCategory(res.name, res.value);
});

$("apply-budget").addEventListener("click", async () => {
  if (!proposalData) return;
  const budgets = {};
  const vals = typedBudgets();
  allRows().forEach((r, i) => { budgets[r.category] = vals[i]; });
  const income = incItems ? { items: incItems, riporto: useCarry ? typedCarry() : null }
    : { borsa: parseAmount($("inc-borsa").value) || 0, personale: parseAmount($("inc-personale").value) || 0,
      famiglia: parseAmount($("inc-famiglia").value) || 0, altro: parseAmount($("inc-altro").value) || 0, riporto: useCarry ? typedCarry() : null };
  const following = $("apply-following").checked;
  try {
    const r = await api("/api/budgets", { method: "PUT", body: { sheet: budgetTarget.sheet, date: budgetTarget.date, budgets, income, apply_following: following } });
    toast(r.months > 1 ? `✓ Budget salvato in ${r.months} mesi (da ${r.sheet})` : `✓ Budget di ${r.sheet} salvato`);
    budgetTarget = { ...budgetTarget, sheet: r.sheet };
    refresh();
    fetchProposal();
  } catch (err) { toast(failMsg(err)); }
});

// ================= RISPARMI =================

async function loadSavings() {
  try { renderSavings(await api("/api/insights")); }
  catch (err) { $("sav-hero").innerHTML = `<p class="big-label">${esc(failMsg(err))}</p>`; }
  $("ask-advice").hidden = !data?.ai?.available;
}

let insightsData = null;

/** Scheda che si apre con la freccia ›: titolo e riga sotto sempre visibili, dettagli dentro. */
const fold = (icon, title, sub, body, attrs = "") => `<details class="fold" ${attrs}>
  <summary><span class="emoji">${icon}</span><span class="f-text"><b>${title}</b><small>${sub}</small></span><i>›</i></summary>
  <div class="f-body">${body}</div></details>`;

/** Barrette orizzontali piccole (mese → importo). */
const miniBars = (rows, cls = "") => {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<ul class="mini-bars">${rows.map((r) => `<li><span>${esc(r.label)}</span>
    <div class="bar"><i class="${r.cls || cls}" style="width:${(r.value / max) * 100}%"></i></div><b>${r.text ?? eur0(r.value)}</b></li>`).join("")}</ul>`;
};

function renderSavings(i) {
  insightsData = i;
  $("sav-hero").innerHTML = `<p class="big-label">${i.saved_closed >= 0 ? "Hai risparmiato finora" : "Finora sei in rosso di"}</p>
    <div class="big-num ${i.saved_closed < 0 ? "neg" : ""}">${eur(Math.abs(i.saved_closed))}</div>
    <div class="meta"><span>Media ${eur(i.avg_saved)} al mese</span><span>${Math.round(i.saving_rate * 100)}% delle entrate</span></div>
    <p class="hint">Contano solo i mesi conclusi.</p>`;

  renderPace(i.pace);
  renderBudgetTips(i.budget_tips || [], i.pace);

  // dove risparmiare
  $("tips").innerHTML = i.tips.map((t) => {
    const sub = t.saving ? `${eur0(t.monthly)}/mese · <span class="save">puoi risparmiare ${eur0(t.saving)}/mese</span>` : `${eur(t.monthly)}/mese`;
    const months = (t.months || []).length > 1 ? `<p class="f-label">Mese per mese</p>${miniBars(t.months.map((m) => ({ label: m.sheet, value: m.total })))}` : "";
    const items = (t.items || []).length ? `<p class="f-label">${t.items_label ? "Le voci" : "Le spese che pesano di più"}</p>
      <ul class="f-items">${t.items.map((x) => `<li><span>${esc(x.name)}</span><small>${t.items_label ? t.items_label : x.count > 1 ? x.count + " volte" : "1 volta"}</small><b>${eur(x.total)}</b></li>`).join("")}</ul>` : "";
    const year = t.saving ? `<p class="f-goal">Con il 30% in meno: <b>${eur0(t.saving)} al mese</b>, cioè <b>${eur0(t.saving * 12)} in un anno</b>.</p>` : "";
    return fold(emoji(t.title), esc(t.title), sub, `${t.how ? `<p>${esc(t.how)}</p>` : `<p>${esc(t.text)}</p>`}${year}${months}${items}`);
  }).join("") || `<p class="empty">Servono almeno un paio di mesi di spese per i consigli.</p>`;

  // mese per mese (si apre e carica le categorie di quel mese)
  const all = i.months.filter((m) => !m.future);
  $("sav-months").innerHTML = [...all].reverse().map((m) => {
    const now = m.month === i.current_month;
    // barra: speso rispetto alle entrate; la parte oltre le entrate è rossa
    const ref = m.income || m.budget;
    const max = Math.max(1, ref, m.spent);
    const okW = (Math.min(m.spent, ref || m.spent) / max) * 100, overW = ref && m.spent > ref ? ((m.spent - ref) / max) * 100 : 0;
    const bar = `<span class="m-bar ${now ? "now" : ""}"><i style="width:${okW}%"></i><i class="over" style="width:${overW}%"></i>${ref ? `<em style="left:${(ref / max) * 100}%"></em>` : ""}</span>`;
    const sub = `Entrate ${eur0(m.income)} − speso ${eur0(m.spent)}${bar}`;
    const head = `<span>${esc(m.month)}${now ? " <span class='hint'>· in corso</span>" : ""}</span>`
      + (now ? `<span class="f-right hint">finora</span>` : `<span class="f-right ${sign(m.saved)}">${m.saved >= 0 ? "+" : "−"}${eur0(Math.abs(m.saved))}</span>`);
    return m.sheet ? fold(now ? "⏳" : m.saved >= 0 ? "✅" : "🔻", head, sub, `<p class="hint">Carico…</p>`, `data-sheet="${esc(m.sheet)}"`)
      : `<div class="fold-static">${head}</div>`;
  }).join("");

  // su cosa spendi di più
  $("themes").innerHTML = i.themes.map((t) => fold(emoji(t.theme), esc(t.theme), `${eur0(t.monthly)}/mese · ${t.per_month_count.toLocaleString(LOCALE)} spese al mese`,
    `<ul class="f-items">${(t.items || []).map((x) => `<li><span>${esc(x.name)}</span><small>${x.count > 1 ? x.count + " volte" : "1 volta"}</small><b>${eur(x.total)}</b></li>`).join("")}</ul>
     ${(t.months || []).length > 1 ? miniBars(t.months.map((m) => ({ label: m.sheet, value: m.total }))) : ""}`)).join("");
}

function renderPace(p) {
  if (!p) { $("pace").innerHTML = `<p class="empty">Nessun mese in corso.</p>`; return; }
  $("pace-title").textContent = `📅 ${p.sheet} · giorno ${p.day} di ${p.days}`;
  const withBudget = p.categories.filter((c) => c.budget > 0);
  const daysLeft = p.days - p.day + 1;
  // quanto puoi spendere al giorno nelle spese di tutti i giorni (non affitto/abbonamenti/viaggi)
  const daily = withBudget.filter((c) => !c.lumpy);
  const dailyLeft = daily.reduce((a, c) => a + Math.max(0, c.budget - c.total), 0);
  const risky = withBudget.map((c) => {
    const over = c.total > c.budget;
    const willOver = p.reliable && !c.lumpy && c.projected > c.budget * 1.05;
    return { ...c, over, willOver, warn: over || willOver || c.used >= 0.8 };
  }).filter((c) => c.warn).sort((a, b) => b.used - a.used);

  const head = `<div class="pace-head"><span>Per la vita di tutti i giorni puoi spendere</span>
    <b>${eur0(dailyLeft / daysLeft)} al giorno</b><small>${eur0(dailyLeft)} rimasti in ${daysLeft} giorni (senza affitto, abbonamenti e viaggi)</small></div>`;
  const detail = fold("📊", "Al giorno, categoria per categoria", `${daily.length} categorie`,
    miniBars(daily.map((c) => ({ label: c.category, value: c.per_day, text: `${eur(c.per_day)}/g` }))));
  const alerts = risky.length ? risky.map((c) => {
    const sub = c.over ? `<span class="neg">sforato di ${eur(c.total - c.budget)}</span>`
      : c.willOver ? `<span class="warn">al ritmo attuale arrivi a ${eur0(c.projected)}</span>`
      : `<span class="warn">usato il ${Math.round(c.used * 100)}%</span>`;
    const body = `<ul class="f-items">
      <li><span>Speso finora</span><b>${eur(c.total)}</b></li>
      <li><span>Budget</span><b>${eur0(c.budget)}</b></li>
      ${!c.lumpy && p.reliable ? `<li><span>A fine mese, a questo ritmo</span><b class="${c.projected > c.budget ? "neg" : ""}">${eur0(c.projected)}</b></li>` : ""}
      <li><span>Puoi ancora spendere</span><b>${c.per_day > 0 ? `${eur(c.per_day)} al giorno` : "niente"}</b></li></ul>
      <p class="hint">${c.over ? "Per recuperare, togli la stessa cifra da un'altra categoria nel Piano." : "Rallenta un po' per restare nel budget."}</p>`;
    return fold(emoji(c.category), esc(c.category), sub, body);
  }).join("") : `<p class="ok-line">✓ Tutto sotto controllo: nessuna categoria vicina al limite.</p>`;
  $("pace").innerHTML = head + alerts + detail
    + (!p.reliable ? `<p class="hint">Dal giorno 7 ti dico anche dove arrivi a fine mese al ritmo attuale.</p>` : "");
}

function renderBudgetTips(list, pace) {
  $("btips-card").hidden = !list.length;
  $("btips").innerHTML = list.map((b, idx) => {
    const n = b.months.length;
    const sub = b.kind === "alza"
      ? `<span class="neg">sforata in ${b.months_over} mesi su ${n}</span> · consiglio ${eur0(b.suggest)}`
      : `<span class="save">avanza sempre</span> · basta ${eur0(b.suggest)}`;
    const text = b.kind === "alza"
      ? `In media hai messo ${eur0(b.avg_budget)} ma ne spendi ${eur0(b.avg_spent)}. Un budget di ${eur0(b.suggest)} è più realistico: toglili da una categoria che avanza.`
      : `In media hai messo ${eur0(b.avg_budget)} ma ne spendi ${eur0(b.avg_spent)}. Con ${eur0(b.suggest)} liberi ${eur0(b.avg_budget - b.suggest)} per altro o per il risparmio.`;
    // una riga per mese: barra dello speso con la tacca del budget
    const max = Math.max(1, ...b.months.map((m) => Math.max(m.total, m.budget)));
    const bars = `<ul class="mini-bars">${b.months.map((m) => `<li><span>${esc(m.sheet)}</span>
      <div class="bar"><i class="${m.total > m.budget ? "over" : ""}" style="width:${(m.total / max) * 100}%"></i><em style="left:${(m.budget / max) * 100}%"></em></div>
      <b>${eur0(m.total)} <small>/ ${eur0(m.budget)}</small></b></li>`).join("")}</ul><p class="hint">La tacca è il budget, la barra quanto hai speso.</p>`;
    const now = pace?.categories.find((c) => c.category.toLowerCase() === b.category.toLowerCase());
    const done = now && (b.kind === "alza" ? now.budget >= b.suggest - 0.5 : now.budget <= b.suggest + 0.5);
    const btn = !pace ? "" : done
      ? `<p class="ok-line">✓ A ${esc(pace.sheet)} hai già messo ${eur0(now.budget)}</p>`
      : `<button type="button" class="secondary" data-btip="${idx}">Usa ${eur0(b.suggest)} a ${esc(pace.sheet)}${now ? ` (ora ${eur0(now.budget)})` : ""}</button>`;
    return fold(emoji(b.category), esc(b.category), sub, `<p>${esc(text)}</p>${bars}${btn}`);
  }).join("");
}

$("btips").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-btip]"); if (!btn) return;
  const b = insightsData.budget_tips[+btn.dataset.btip];
  try {
    await api("/api/budgets", { method: "PUT", body: { sheet: insightsData.pace.sheet, budgets: { [b.category]: b.suggest } } });
    toast(`✓ ${b.category}: ${eur0(b.suggest)} a ${insightsData.pace.sheet}. Controlla il Piano per il totale.`);
    refresh();
    loadSavings();
  } catch (err) { toast(failMsg(err)); }
});

// "Mese per mese": all'apertura carico le categorie del mese
$("sav-months").addEventListener("toggle", async (e) => {
  const d = e.target;
  if (!d.open || !d.dataset.sheet || d.dataset.loaded) return;
  d.dataset.loaded = "1";
  try {
    const m = await api("/api/month?sheet=" + encodeURIComponent(d.dataset.sheet));
    const cats = m.summary.categories.filter((c) => c.budget > 0 || c.total > 0)
      .map((c) => ({ ...c, diff: c.budget - c.total })).sort((a, b) => a.diff - b.diff);
    d.querySelector(".f-body").innerHTML = cats.length ? `<ul class="f-items">${cats.map((c) => `<li><span>${emoji(c.category)} ${esc(c.category)}</span>
      <small>${eur0(c.total)} / ${c.budget ? eur0(c.budget) : "—"}</small>
      <b class="${c.budget ? sign(c.diff) : ""}">${c.budget ? (c.diff >= 0 ? "+" : "−") + eur0(Math.abs(c.diff)) : ""}</b></li>`).join("")}</ul>
      <button type="button" class="text-btn" data-open="${esc(d.dataset.sheet)}">Vedi le spese →</button>` : `<p class="hint">Nessuna spesa.</p>`;
  } catch (err) { d.querySelector(".f-body").innerHTML = `<p class="hint">${esc(failMsg(err))}</p>`; delete d.dataset.loaded; }
}, true);
$("sav-months").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-open]"); if (!b) return;
  go("history", { month: b.dataset.open });
});

$("ask-advice").addEventListener("click", async () => {
  const box = $("advice"); box.hidden = false; box.textContent = "Claude sta guardando le tue spese…";
  try { box.textContent = (await api("/api/advice?lang=" + LANG, { method: "POST" })).text; }
  catch (err) { box.textContent = failMsg(err); }
});

// ================= IMPORTA ESTRATTO CONTO =================

let imp = null;  // { items, categories, income }

function loadImport() {
  if (!imp) { $("imp-start").hidden = false; $("imp-review").hidden = true; }
}

$("imp-file").addEventListener("change", async () => {
  const f = $("imp-file").files[0];
  if (!f) return;
  $("imp-status").textContent = `Leggo ${f.name}…`;
  try {
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Non riesco ad aprire il file"));
      r.readAsDataURL(f);
    });
    const res = await api("/api/import/parse", { method: "POST", body: { filename: f.name, data } });
    if (!res.items.length) {
      $("imp-status").textContent = "Non ho trovato spese in questo file. Prova con il CSV, se la banca lo permette.";
      return;
    }
    // di partenza: selezionate tutte tranne quelle già presenti o non importabili
    res.items.forEach((it) => { it.on = !it.duplicate && !it.blocked; });
    imp = res;
    $("imp-status").textContent = "";
    $("imp-start").hidden = true;
    $("imp-review").hidden = false;
    renderImport();
    window.scrollTo(0, 0);
  } catch (err) { $("imp-status").textContent = failMsg(err); }
  $("imp-file").value = "";
});

function renderImport() {
  const items = imp.items;
  const dup = items.filter((x) => x.duplicate).length, blocked = items.filter((x) => x.blocked).length;
  const notes = [];
  const one = (n, a, b) => (n === 1 ? a : b);
  if (dup) notes.push(`${dup} ${one(dup, "spesa sembra già registrata", "spese sembrano già registrate")} (stessa cifra, data vicina): ${one(dup, "l'ho lasciata", "le ho lasciate")} fuori.`);
  if (blocked) notes.push(`${blocked} ${one(blocked, "spesa è di un mese", "spese sono di mesi")} che non posso modificare.`);
  if (imp.income) notes.push(`${imp.income} ${one(imp.income, "entrata", "entrate")} (accrediti, bonifici ricevuti) non ${one(imp.income, "la", "le")} importo.`);
  notes.push("Controlla soprattutto le spese fatte in viaggio: vanno aggiunte dal viaggio.");
  $("imp-note").innerHTML = notes.map(esc).join("<br>");

  const byMonth = {};
  items.forEach((it) => (byMonth[it.date.slice(0, 7)] ||= []).push(it));
  $("imp-list").innerHTML = Object.keys(byMonth).sort().reverse().map((k) => {
    const [y, m] = k.split("-").map(Number);
    const rows = byMonth[k].slice().reverse();
    return `<div class="group-head"><span>${MONTHS[m - 1]} ${y}</span><span>${rows.length} spese</span></div>
      <div class="card group"><ul class="imp-list">${rows.map(impRow).join("")}</ul></div>`;
  }).join("");
  updateImportTotal();
}

function impRow(it) {
  const cats = [...imp.categories];
  if (it.category && !cats.some((c) => c.toLowerCase() === it.category.toLowerCase())) cats.push(it.category);
  const opts = `<option value="">— categoria —</option>` + cats.map((c) => {
    const isNew = !imp.categories.some((x) => x.toLowerCase() === c.toLowerCase());
    return `<option value="${esc(c)}" ${it.category && c.toLowerCase() === it.category.toLowerCase() ? "selected" : ""}>${esc(c)}${isNew ? " (nuova)" : ""}</option>`;
  }).join("");
  const tag = it.blocked ? `<span class="tag-bad">${esc(it.blocked)}</span>`
    : it.duplicate ? `<span class="tag-warn">già presente: ${esc(it.duplicate)}</span>`
    : !it.category ? `<span class="tag-warn">scegli la categoria ↓</span>` : "";
  return `<li class="${it.on ? "on" : ""} ${it.blocked ? "blocked" : ""}" data-i="${it.i}">
    <label class="imp-check"><input type="checkbox" ${it.on ? "checked" : ""} ${it.blocked ? "disabled" : ""}></label>
    <div class="imp-main">
      <input class="imp-desc" value="${esc(it.description)}" aria-label="Descrizione">
      <small>${fmtDay(it.date)}${it.original.trim().toLowerCase() !== it.description.trim().toLowerCase() ? " · " + esc(it.original.slice(0, 60)) : ""}</small>
      ${tag}
      <select class="imp-cat" aria-label="Categoria">${opts}</select>
    </div>
    <b class="amt">${eur(it.amount)}</b></li>`;
}

function updateImportTotal() {
  const sel = imp.items.filter((x) => x.on && !x.blocked);
  const missing = sel.filter((x) => !x.category).length;
  const tot = sel.reduce((a, x) => a + x.amount, 0);
  $("imp-summary").innerHTML = `<div><span>Trovate</span><b>${imp.items.length}</b></div>
    <div><span>Scelte</span><b>${sel.length}</b></div><div><span>Totale</span><b>${eur0(tot)}</b></div>`;
  for (const id of ["imp-save", "imp-save2"]) {
    $(id).disabled = !sel.length || missing > 0;
    $(id).textContent = missing ? `Scegli la categoria di ${missing} ${missing === 1 ? "spesa" : "spese"}`
      : sel.length ? `Aggiungi ${sel.length} ${sel.length === 1 ? "spesa" : "spese"} (${eur(tot)})` : "Nessuna spesa scelta";
  }
}

$("imp-list").addEventListener("change", (e) => {
  const li = e.target.closest("li[data-i]"); if (!li) return;
  const it = imp.items[+li.dataset.i];
  if (e.target.type === "checkbox") { it.on = e.target.checked; li.classList.toggle("on", it.on); }
  if (e.target.classList.contains("imp-cat")) {
    it.category = e.target.value || null;
    if (it.category) it.on = true;
    li.outerHTML = impRow(it);
  }
  updateImportTotal();
});
$("imp-list").addEventListener("input", (e) => {
  if (!e.target.classList.contains("imp-desc")) return;
  imp.items[+e.target.closest("li[data-i]").dataset.i].description = e.target.value;
});
$("imp-all").addEventListener("click", () => { imp.items.forEach((x) => { x.on = !x.blocked; }); renderImport(); });
$("imp-none").addEventListener("click", () => { imp.items.forEach((x) => { x.on = false; }); renderImport(); });
$("imp-other").addEventListener("click", () => { imp = null; loadImport(); });

async function saveImport() {
  const sel = imp.items.filter((x) => x.on && !x.blocked && x.category && x.description.trim());
  if (!sel.length) return;
  for (const id of ["imp-save", "imp-save2"]) $(id).disabled = true;
  try {
    const r = await api("/api/import/save", { method: "POST", body: { items: sel.map((x) => ({
      date: x.date, description: x.description.trim(), amount: x.amount, category: x.category,
      note: "Da estratto conto" + (x.original.trim().toLowerCase() !== x.description.trim().toLowerCase() ? " · " + x.original.slice(0, 80) : "") })) } });
    toast(`✓ ${r.count} spese aggiunte (${r.sheets.join(", ")})`);
    imp = null;
    refresh();
    go("history");
  } catch (err) { toast(failMsg(err)); updateImportTotal(); }
}
$("imp-save").addEventListener("click", saveImport);
$("imp-save2").addEventListener("click", saveImport);

// ================= IMPOSTAZIONI (per dispositivo) =================

const ACCENTS = [["green", "Verde", "#23735f"], ["blue", "Blu", "#2f62c4"], ["purple", "Viola", "#6a4fc7"],
  ["pink", "Rosa", "#c23f74"], ["orange", "Arancio", "#c2620f"], ["graphite", "Grafite", "#3d434b"]];
let prefs = { theme: "auto", accent: "green", size: "normal", start: "home", lang: "it", ...store.get("prefs", {}) };

function applyPrefs() {
  const r = document.documentElement;
  const set = (k, v, def) => (v && v !== def ? (r.dataset[k] = v) : delete r.dataset[k]);
  set("theme", prefs.theme, "auto");
  set("accent", prefs.accent, "green");
  set("size", prefs.size, "normal");
  // colore della barra di stato su iPhone
  const dark = prefs.theme === "dark" || (prefs.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = dark ? "#141517" : "#f4f3ef";
    m.removeAttribute("media");
  });
}

/** Stato della modalità offline, mostrato nelle Impostazioni (serve per capire se la prova a Mac spento può riuscire). */
async function offlineStatus() {
  const out = { https: location.protocol === "https:" || location.hostname === "127.0.0.1", sw: !!navigator.serviceWorker?.controller,
    page: false, files: 0, data: store.get("api-index", []).length, persisted: null };
  try {
    const keys = await caches.keys();
    for (const k of keys.filter((x) => x.startsWith("spese-"))) {
      const c = await caches.open(k);
      out.page ||= !!(await c.match("/"));
      out.files = Math.max(out.files, (await c.keys()).length);
    }
  } catch {}
  try { out.persisted = await navigator.storage?.persisted?.(); } catch {}
  return out;
}
async function renderOfflineCheck() {
  const s = await offlineStatus();
  const ready = s.https && s.sw && s.page && s.data > 0;
  const row = (ok, txt) => `<li class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${txt}</li>`;
  $("offline-check").innerHTML = `<p class="${ready ? "ok-line" : "warn"}"><b>${ready ? "✓ Pronta: puoi spegnere il Mac" : "✗ Non ancora pronta"}</b></p>
    <ul class="check-list">${row(s.https, "Indirizzo sicuro (https)")}${row(s.sw, "Copia dell'app attiva")}${row(s.page, `File salvati nel telefono (${s.files})`)}
    ${row(s.data > 0, `Dati salvati (${s.data} pagine)`)}${s.persisted == null ? "" : row(s.persisted, "Protetta dalla pulizia di iOS")}</ul>
    ${ready ? "" : `<p class="hint">${!s.https ? "Apri l'app dall'icona con l'indirizzo https." : "Con il Mac acceso chiudi e riapri l'app, poi apri Home, Storico e Budget e torna qui."}</p>`}
    <p class="hint">Versione ${esc(APP_VERSION || "?")}</p>
    <button type="button" class="secondary" id="reset-app">🔄 Ripristina l'app</button>
    <p class="hint">Riscarica l'app dal Mac (serve il Mac acceso). Spese in coda, dati e impostazioni restano.</p>`;
  $("reset-app").onclick = () => { if (!online) return toast("Serve il Mac acceso per riscaricare l'app."); resetAppCopy(true); };
  window.__diag?.(`stato offline: ${JSON.stringify(s)}`);
}

function renderSettings() {
  renderOfflineCheck();
  for (const [id, key] of [["set-theme", "theme"], ["set-size", "size"], ["set-start", "start"], ["set-lang", "lang"]]) {
    document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === prefs[key]));
  }
  $("set-accent").innerHTML = ACCENTS.map(([k, name, c]) => `<button type="button" data-v="${k}" class="${prefs.accent === k ? "on" : ""}">
    <i style="background:${c}"></i><span>${name}</span></button>`).join("");
}

function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  store.set("prefs", prefs);
  applyPrefs();
  renderSettings();
}

for (const [id, key] of [["set-theme", "theme"], ["set-size", "size"], ["set-start", "start"], ["set-accent", "accent"], ["set-lang", "lang"]]) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    if (key === "lang" && b.dataset.v !== prefs.lang) { setPref(key, b.dataset.v); return location.reload(); }  // ridisegna tutto nella lingua nuova
    setPref(key, b.dataset.v);
    if (key === "start") toast(`All'avvio si aprirà ${b.textContent}`);
  });
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyPrefs);
applyPrefs();

// ================= ABBONAMENTI PROGRAMMATI =================

let subsData = null;

async function loadSubs() {
  try {
    const q = budgetTarget?.sheet ? "?sheet=" + encodeURIComponent(budgetTarget.sheet) : "";
    subsData = await api("/api/subscriptions" + q);
  } catch (err) { $("subs-list").innerHTML = `<li class="empty">${esc(failMsg(err))}</li>`; return; }
  const today = new Date().getDate();
  const isCurrent = subsData.sheet && data?.summary?.sheet === subsData.sheet;
  $("subs-list").innerHTML = subsData.items.map((x, i) => {
    const state = !x.auto ? " · a mano" : x.done ? " · ✓ inserito" : isCurrent && x.day > today ? ` · arriva il ${x.day}` : "";
    return `<li class="sub-row"><button type="button" class="pick" data-i="${i}"><span class="emoji">🔁</span>
      <span class="name">${esc(x.name)}<small class="tag-sub">${eur(x.amount)} · giorno ${x.day}${state}</small></span></button>
      <label class="toggle" aria-label="Automatico ${esc(x.name)}"><input type="checkbox" data-auto="${i}" ${x.auto ? "checked" : ""}><i></i></label></li>`;
  }).join("") || `<li class="empty" style="display:block">Nessun abbonamento.</li>`;
  $("subs-add").hidden = subsData.items.length >= 5;
}

async function saveSubs(items) {
  try {
    const r = await api("/api/subscriptions", { method: "PUT", body: { sheet: subsData?.sheet, items } });
    const n = r.added?.length || 0;
    toast(n ? `✓ ${n === 1 ? "Inserito" : `Inseriti ${n} abbonamenti:`} ${r.added.map((a) => a.name).join(", ")}` : "Abbonamenti salvati");
    refresh();
  } catch (err) { toast(failMsg(err)); }
  loadSubs();
}
const subsItems = () => subsData.items.map(({ name, amount, day, auto }) => ({ name, amount, day, auto }));

$("subs-list").addEventListener("change", (e) => {
  const cb = e.target.closest("input[data-auto]"); if (!cb || !subsData) return;
  const items = subsItems();
  items[+cb.dataset.auto].auto = cb.checked;
  saveSubs(items);
});
$("subs-list").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  const i = +b.dataset.i;
  const res = await editSub(subsData.items[i]);
  if (!res) return;
  const items = subsItems();
  if (res.action === "delete") items.splice(i, 1); else items[i] = { ...res.item, auto: items[i].auto };
  saveSubs(items);
});
$("subs-add").addEventListener("click", async () => {
  const res = await editSub(null);
  if (res?.item) saveSubs([...subsItems(), { ...res.item, auto: false }]);
});

function editSub(x) {
  return new Promise((resolve) => {
    const dlg = $("subdlg");
    $("sd-title").textContent = x ? x.name : "Nuovo abbonamento";
    $("sd-name").value = x?.name || "";
    $("sd-amount").value = x ? amountIn(x.amount) : "";
    $("sd-day").value = x?.day || 1;
    $("sd-delete").hidden = !x;
    dlg.onclose = () => {
      if (dlg.returnValue === "delete") return resolve({ action: "delete" });
      if (dlg.returnValue !== "ok") return resolve(null);
      const name = $("sd-name").value.trim(), amount = parseAmount($("sd-amount").value);
      const day = Math.min(31, Math.max(1, parseInt($("sd-day").value, 10) || 1));
      if (!name || !(amount > 0)) { toast("Scrivi nome e importo"); return resolve(null); }
      resolve({ action: "save", item: { name, amount, day } });
    };
    dlg.returnValue = "";
    dlg.showModal();
  });
}

// ================= GESTIONE CATEGORIE =================

let catManage = [];

async function loadCatManage() {
  loadSubs();
  try {
    const q = budgetTarget?.sheet ? "?sheet=" + encodeURIComponent(budgetTarget.sheet) : "";
    const r = await api("/api/categories" + q);
    catManage = r.categories;
    $("cat-manage").innerHTML = catManage.map((c, i) => `<li><button type="button" class="pick" data-i="${i}">
      <span class="emoji">${emoji(c.category)}</span><span class="name">${esc(c.category)}</span>
      <span class="budget">${c.budget ? eur0(c.budget) : "—"}</span></button></li>`).join("");
    $("cat-add").hidden = r.free_slots <= 0;
  } catch (err) { $("cat-manage").innerHTML = `<li class="empty">${esc(failMsg(err))}</li>`; }
}

$("cat-manage").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  const c = catManage[+b.dataset.i];
  const month = budgetTarget?.sheet || budgetTarget?.label || "";
  const others = catManage.map((x) => x.category).filter((x) => x !== c.category);
  const res = await editCategory(c, month, others);
  if (!res) return;
  try {
    if (res.action === "delete") {
      const r = await api("/api/categories/delete", { method: "POST", body: { name: c.category, move_to: res.moveTo || null } });
      toast(`Categoria eliminata${r.moved ? ` · ${r.moved} spese spostate in ${res.moveTo}` : ""}`);
    } else {
      if (res.name && res.name !== c.category) {
        await api("/api/categories/rename", { method: "POST", body: { old: c.category, new: res.name } });
      }
      if (res.budget !== c.budget) {
        await api("/api/budgets", { method: "PUT", body: { sheet: budgetTarget.sheet, date: budgetTarget.date,
          budgets: { [res.name || c.category]: res.budget } } });
      }
      toast("Categoria aggiornata");
    }
  } catch (err) { toast(failMsg(err)); }
  loadCatManage();
  refresh();
});

function editCategory(c, month, others) {
  return new Promise((resolve) => {
    const dlg = $("catdlg");
    $("cd-title").textContent = c.category;
    $("cd-name").value = c.category;
    $("cd-budget").value = numIn(c.budget);
    $("cd-month").textContent = month ? `(${month})` : "";
    $("cd-delete-box").hidden = true;
    $("cd-move").innerHTML = `<option value="">— scegli —</option>` + others.map((o) => `<option>${esc(o)}</option>`).join("");
    $("cd-delete").textContent = "Elimina";
    let deleting = false;
    $("cd-delete").onclick = (ev) => {
      ev.preventDefault();
      if (!deleting) {
        deleting = true;
        $("cd-delete-box").hidden = false;
        $("cd-delete-text").textContent = "Se ci sono spese in questa categoria (in qualunque mese), scegli dove spostarle. Poi premi Conferma.";
        $("cd-delete").textContent = "Conferma";
        return;
      }
      dlg.close("delete");
    };
    dlg.onclose = () => {
      if (dlg.returnValue === "delete") return resolve({ action: "delete", moveTo: $("cd-move").value });
      if (dlg.returnValue === "ok") return resolve({ action: "save", name: $("cd-name").value.trim(), budget: parseAmount($("cd-budget").value) || 0 });
      resolve(null);
    };
    dlg.returnValue = "";
    dlg.showModal();
  });
}

$("cat-add").addEventListener("click", async () => {
  const res = await askNumber("Nuova categoria", "Scrivi il nome e il budget al mese.", 0, true);
  if (!res || !res.name) return;
  try {
    await api("/api/categories/add", { method: "POST", body: { name: res.name, budget: res.value, sheet: budgetTarget?.sheet } });
    toast(`Categoria ${res.name} creata`);
  } catch (err) { toast(failMsg(err)); }
  loadCatManage();
  refresh();
});

/** Finestrella con un importo (e, se withName, anche un nome). */
// Annulla/Elimina sono type="button": così Invio (anche "Vai" sulla tastiera dell'iPhone) vale come Salva/Crea
document.addEventListener("click", (e) => {
  const b = e.target.closest("dialog button[data-close]"); if (b) b.closest("dialog").close(b.dataset.close);
});

function askNumber(title, text, value, withName = false) {
  return new Promise((resolve) => {
    const dlg = $("numdlg");
    $("num-title").textContent = title;
    $("num-text").innerHTML = esc(text) + (withName ? `<input id="num-name" class="desc" placeholder="Nome" style="margin-top:10px">` : "");
    $("num-value").value = numIn(value);
    dlg.onclose = () => resolve(dlg.returnValue === "ok"
      ? { value: parseAmount($("num-value").value) || 0, name: withName ? $("num-name").value.trim() : null } : null);
    dlg.returnValue = "";
    dlg.showModal();
  });
}

// ================= VIAGGI =================

let currentTrip = null;
let tripData = null;

async function loadTripsCache() {
  try {
    tripsCache = (await api("/api/trips")).trips;
    store.set("trips", tripsCache);
  } catch {}
  return tripsCache;
}

const fmtRange = (a, b) => {
  if (!a) return "Nessuna spesa ancora";
  const f = (d) => new Date(d).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
};

async function loadTrips(opts = {}) {
  if (opts.trip) return showTrip(opts.trip);
  currentTrip = null;
  $("trips-list").hidden = false;
  $("trip-detail").hidden = true;
  await loadTripsCache();
  $("trip-cards").innerHTML = tripsCache.length ? tripsCache.map((t, i) => {
    const pct = t.budget > 0 ? Math.min(100, (t.total / t.budget) * 100) : 0;
    return `<div class="trip-card" data-i="${i}"><span class="emoji">✈️</span>
      <div><b>${esc(t.name)}</b><span class="meta">${fmtRange(t.from, t.to)} · ${t.count} ${t.count === 1 ? "spesa" : "spese"}</span></div>
      <span class="amt">${eur(t.total)}${t.budget ? `<br><span class="meta">di ${eur0(t.budget)}</span>` : ""}</span>
      ${t.budget ? `<div class="progress"><i class="${t.total > t.budget ? "over" : ""}" style="width:${pct}%"></i></div>` : ""}</div>`;
  }).join("") : `<p class="empty">Nessun viaggio. Premi "＋ Nuovo" per crearne uno.</p>`;
}

$("trip-cards").addEventListener("click", (e) => {
  const c = e.target.closest(".trip-card"); if (!c) return;
  showTrip(tripsCache[+c.dataset.i].name);
});
$("trip-new-btn").addEventListener("click", () => {
  $("trip-new").hidden = !$("trip-new").hidden;
  if (!$("trip-new").hidden) $("trip-name").focus();
});
$("trip-create").addEventListener("click", async () => {
  const name = $("trip-name").value.trim();
  if (!name) return $("trip-name").focus();
  try {
    const r = await api("/api/trips", { method: "POST", body: { name } });
    $("trip-name").value = ""; $("trip-new").hidden = true;
    toast(`✓ Viaggio ${r.name} creato (anche in Excel)`);
    await loadTripsCache();
    showTrip(r.name);
  } catch (err) { toast(failMsg(err)); }
});
$("trip-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("trip-create").click(); } });

async function showTrip(name) {
  currentTrip = name;
  $("trips-list").hidden = true;
  $("trip-detail").hidden = false;
  try { tripData = await api("/api/trip?name=" + encodeURIComponent(name)); }
  catch (err) { toast(failMsg(err)); return loadTrips(); }
  const s = tripData.summary;
  $("trip-title").textContent = "✈️ " + s.name;
  $("trip-cat-add").hidden = tripData.free_slots <= 0;
  $("trip-dates").textContent = `${fmtRange(s.from, s.to)} · ${s.count} ${s.count === 1 ? "spesa" : "spese"}`;
  const left = s.budget - s.total;
  $("trip-hero").innerHTML = s.budget > 0 ? `
      <p class="big-label">${left >= 0 ? "Ti restano per il viaggio" : "Hai superato il budget del viaggio di"}</p>
      <div class="big-num ${left < 0 ? "neg" : ""}">${eur(Math.abs(left))}</div>
      <div class="progress"><i class="${left < 0 ? "over" : ""}" style="width:${Math.min(100, (s.total / s.budget) * 100)}%"></i></div>
      <div class="meta"><span>Speso ${eur(s.total)} di ${eur0(s.budget)}</span></div>`
    : `<p class="big-label">Speso nel viaggio</p><div class="big-num">${eur(s.total)}</div>
      <div class="meta"><span>Imposta un budget toccando le categorie qui sotto.</span></div>`;
  $("trip-cats").innerHTML = s.categories.map(catRow).join("");
  const txs = tripData.transactions;
  $("trip-list").innerHTML = txs.length ? txs.map((t, i) => txRow(t, i)).join("")
    : `<li class="empty" style="display:block">Ancora nessuna spesa in questo viaggio.</li>`;
}

$("trip-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-i]"); if (!li) return;
  const t = tripData.transactions[+li.dataset.i];
  openEdit({ ...t, trip: undefined }, tripData.categories, true, () => showTrip(currentTrip), currentTrip);
});
$("trip-cats").addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-cat]"); if (!li) return;
  const c = tripData.summary.categories.find((x) => x.category === li.dataset.cat);
  if (!c || c.virtual) return;
  const res = await askNumber(`Budget · ${c.category}`, `Quanto vuoi spendere per ${c.category.toLowerCase()} in questo viaggio?`, c.budget);
  if (!res) return;
  try {
    await api("/api/trips/budget", { method: "PUT", body: { trip: currentTrip, category: c.category, budget: res.value } });
    showTrip(currentTrip);
    loadTripsCache();
  } catch (err) { toast(failMsg(err)); }
});
$("trip-cat-add").addEventListener("click", async () => {
  const res = await askNumber("Nuova categoria", `Nome e budget per il viaggio ${currentTrip} (il budget puoi lasciarlo a 0).`, 0, true);
  if (!res?.name) return;
  try {
    const r = await api("/api/trips/category", { method: "POST", body: { trip: currentTrip, name: res.name, budget: res.value || 0 } });
    toast(`Categoria ${r.name} aggiunta al viaggio`);
    showTrip(currentTrip);
    loadTripsCache();
  } catch (err) { toast(failMsg(err)); }
});
$("trip-back").addEventListener("click", () => loadTrips());
$("trip-add").addEventListener("click", async () => {
  await loadTripsCache();
  openAdd({ trip: currentTrip, onDone: () => showTrip(currentTrip) });
});
$("trip-delete").addEventListener("click", async () => {
  if (!(await askConfirm(`Eliminare il viaggio ${currentTrip}?`, "Spariscono il suo foglio Excel, le sue spese e le righe nei mesi. Non si può annullare."))) return;
  try {
    await api("/api/trips/delete", { method: "POST", body: { name: currentTrip } });
    toast("Viaggio eliminato");
    refresh();
    loadTrips();
  } catch (err) { toast(failMsg(err)); }
});

// ================= avvio =================

window.addEventListener("online", () => { flushQueue(); refresh(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  flushQueue();
  setTimeout(warmOffline, 3000);
  // rientrando nell'app (es. dopo una modifica in Excel) ricarico quello che stai guardando
  if (view === "home") refresh();
  else if (view === "history") (histMode === "year" ? loadYear() : monthData && showMonth(monthData.summary.sheet, true));
  else if (view === "budget" && budgetMode === "sav") loadSavings();
  else if (view === "trips") currentTrip ? showTrip(currentTrip) : loadTrips();
});
setInterval(flushQueue, 30000);

enableSwipe($("home-recent"), (li) => {
  const t = homeRows[+li.dataset.i];
  return t && !t.queued && !(t.trip && t.sheet) ? { t, after: refresh } : null;
});
enableSwipe($("month-list"), (li) => {
  const t = monthFlat[+li.dataset.i];
  return t && !t.trip ? { t, after: () => showMonth(monthData.summary.sheet, true) } : null;
});
enableSwipe($("trip-list"), (li) => {
  const t = tripData?.transactions[+li.dataset.i];
  return t ? { t, trip: currentTrip, after: () => { showTrip(currentTrip); loadTripsCache(); } } : null;
});

$("desc-list").innerHTML = "";
renderStatus();
go((location.hash || "#" + prefs.start).slice(1));
window.__appStarted = true;
checkVersion();
$("boot")?.remove();
window.__diag?.("app partita · online " + online);
offlineStatus().then((st) => window.__diag?.("stato offline all'avvio: " + JSON.stringify(st)));
sendDiag();
refresh().then(() => {
  flushQueue();
  $("desc-list").innerHTML = (data?.descriptions || []).map((s) => `<option value="${esc(s)}">`).join("");
  setTimeout(warmOffline, 3000);  // dopo la prima schermata, per non rallentarla
});
loadQuick();
loadTripsCache();
loadOfflinePack();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => window.__diag?.("registrazione sw fallita: " + err));
  // l'app si apre dalla copia salvata: quando arriva una versione nuova (sw nuovo attivo) ricarico una volta
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded || !$("sheet").hidden) return;  // primo avvio, o stai scrivendo una spesa
    reloaded = true;
    window.__diag?.("versione nuova: ricarico");
    location.reload();
  });
}
// chiedo a iOS di non cancellare la copia dell'app e dei dati per fare spazio
navigator.storage?.persist?.().then((ok) => window.__diag?.("archiviazione persistente: " + (ok ? "sì" : "no"))).catch(() => {});
