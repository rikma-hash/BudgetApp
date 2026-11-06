"use strict";
/* Avvio della versione indipendente: riprende la sessione (o chiede di entrare), poi carica l'app vera (app.js).
   Aggiunge nelle Impostazioni: account, sincronizzazione, Excel (scarica / importa dal vecchio file), cancella dati. */

(() => {
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (n) => (n ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const say = (msg) => (typeof toast === "function" ? toast(msg) : alert(msg));

let appLoaded = false;
function startApp() {
  $("login").hidden = true;
  $("boot").style.display = "";
  if (appLoaded) return location.reload();
  appLoaded = true;
  const s = document.createElement("script");
  s.src = document.body.dataset.app;
  s.onload = () => { renderAccount(); setTimeout(() => window.SpeseServer.applySubscriptions().length && reloadView(), 1500); };
  document.body.appendChild(s);
}

/** Ricarica quello che si vede, se nel frattempo sono arrivati dati da un altro dispositivo (senza disturbare). */
function reloadView() {
  if (!appLoaded || typeof view === "undefined") return;
  if (document.querySelector("dialog[open]") || !$("sheet")?.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
  try {
    if (view === "home") refresh();
    else if (view === "history") loadHistory();
  } catch {}
}

async function sync() {
  if (Store.mode !== "cloud") return;
  try { if (await Store.refresh()) reloadView(); } catch {}
}

// ---------- accesso ----------
function showLogin() {
  $("boot").style.display = "none";
  $("login").hidden = false;
  $("login-cloud").hidden = !Store.cloudConfigured();
}
const msg = (t, bad) => { $("login-msg").textContent = t; $("login-msg").classList.toggle("neg", !!bad); };
async function enter(fn) {
  if (!$("login-form").reportValidity()) return;
  msg("Un attimo…");
  try {
    const r = await fn($("login-email").value.trim(), $("login-pass").value);
    if (r?.confirm) return msg("Ti ho mandato un'email: apri il link per confermare, poi torna qui e premi Entra.");
    msg("Scarico i tuoi dati…");
    await Store.refresh();
    msg("");
    startApp();
  } catch (err) { msg(err.message || String(err), true); }
}
$("login-form").addEventListener("submit", (e) => { e.preventDefault(); enter((a, b) => Store.signIn(a, b)); });
$("login-up").addEventListener("click", () => enter((a, b) => Store.signUp(a, b)));
$("login-demo").addEventListener("click", () => { Store.useDemo(); startApp(); });

// ---------- impostazioni: account, sincronizzazione, Excel ----------
function renderAccount() {
  const box = $("acc-box"); if (!box) return;
  const n = Store.pending();
  box.innerHTML = Store.mode === "cloud"
    ? `<p>Sei entrato come <b>${esc(Store.user?.email)}</b>.</p>
       <p class="${n ? "warn" : "ok-line"}">${n ? `⏳ ${n} ${n === 1 ? "modifica" : "modifiche"} ancora sul telefono: ${Store.lastError === "offline" ? "partono appena c'è connessione" : "le sto mandando"}.` : "✓ Tutto salvato online: lo vedi anche dagli altri dispositivi."}</p>`
    : `<p>Stai usando l'app <b>senza account</b>: i dati sono solo in questo browser. Scarica ogni tanto l'Excel per non perderli.</p>`;
  $("acc-logout").textContent = Store.mode === "cloud" ? "Esci dall'account" : "Torna alla schermata di accesso";
  const pill = $("sync-pill");
  if (pill) { pill.hidden = !n || Store.mode !== "cloud"; pill.textContent = `⏳ ${n} da sincronizzare`; }
}
Store.on(renderAccount);

document.addEventListener("click", async (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "acc-logout") {
    if (Store.mode === "cloud") {
      if (Store.pending() && !(await askConfirm("Esci", "Ci sono modifiche non ancora salvate online: uscendo si perdono. Esci lo stesso?", "Esci"))) return;
      await Store.signOut();
    } else { localStorage.removeItem("indip-mode"); Store.mode = null; }
    location.hash = ""; location.reload();
  } else if (id === "acc-export") {
    if (!window.XLSX) return say("Sto ancora caricando: riprova tra un attimo");
    window.SpeseExcel.download();
  } else if (id === "acc-import") $("acc-file").click();
  else if (id === "acc-wipe") {
    if (!(await askConfirm("Cancella tutti i dati", "Spese, budget, viaggi, abbonamenti e categorie di questo account spariscono per sempre. Scarica prima l'Excel se vuoi tenerne una copia.", "Cancella tutto"))) return;
    Store.wipe(); say("Dati cancellati"); location.hash = "home"; location.reload();
  } else if (id === "imp-x-replace" || id === "imp-x-add") {
    const replace = id === "imp-x-replace";
    if (replace && Store.db.expenses.length && !(await askConfirm("Sostituisci i dati", `Le ${Store.db.expenses.length} spese che ci sono adesso verranno sostituite da quelle del file.`, "Sostituisci"))) return;
    window.SpeseExcel.importInto(pendingImport, replace);
    say(`✓ Importate ${pendingImport.expenses.length + pendingImport.trips.reduce((a, t) => a + t.expenses.length, 0)} spese`);
    pendingImport = null; $("acc-preview").hidden = true;
    location.hash = "home"; location.reload();
  } else if (id === "imp-x-cancel") { pendingImport = null; $("acc-preview").hidden = true; }
});

let pendingImport = null;
document.addEventListener("change", async (e) => {
  if (e.target.id !== "acc-file") return;
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (!window.XLSX) return say("Sto ancora caricando: riprova tra un attimo");
  try { pendingImport = await window.SpeseExcel.read(f); } catch (err) { return say("Non riesco a leggere questo file: " + (err.message || err)); }
  const d = pendingImport;
  const tripN = d.trips.reduce((a, t) => a + t.expenses.length, 0);
  const total = d.expenses.reduce((a, x) => a + x.amount, 0) + d.trips.reduce((a, t) => a + t.expenses.reduce((b, x) => b + x.amount, 0), 0);
  const box = $("acc-preview");
  box.hidden = false;
  box.innerHTML = !d.expenses.length && !d.months.length ? `<p class="hint">Non ho trovato spese né budget in questo file.</p>` : `
    <p><b>Ho trovato:</b></p>
    <ul class="hint-list">
      <li>${d.expenses.length + tripN} spese per ${eur(total)}</li>
      <li>${d.months.length} mesi con entrate o budget</li>
      <li>${d.categories.length} categorie${d.subscriptions.length ? ` · ${d.subscriptions.length} abbonamenti` : ""}</li>
      ${d.trips.length ? `<li>${d.trips.length} ${d.trips.length === 1 ? "viaggio" : "viaggi"}: ${d.trips.map((t) => esc(t.name)).join(", ")}</li>` : ""}
      ${d.dupes ? `<li>${d.dupes} spese dei viaggi erano scritte anche nei mesi: ora stanno solo nel viaggio (nel mese c'è la riga ✈️ Viaggio, il totale non cambia)</li>` : ""}
      ${d.moved ? `<li>${d.moved} ${d.moved === 1 ? "spesa scritta in un mese con la data di un altro resta" : "spese scritte in un mese con la data di un altro restano"} nel mese del foglio (data vera nella nota)</li>` : ""}
    </ul>
    <button class="primary big" type="button" id="imp-x-replace">Sostituisci i dati con questi</button>
    <button class="secondary" type="button" id="imp-x-add">Aggiungi ai dati che ci sono</button>
    <button class="secondary" type="button" id="imp-x-cancel">Annulla</button>`;
});

window.addEventListener("store-error", (e) => say("Una modifica non è stata salvata online: " + e.detail));
document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
setInterval(() => { if (!document.hidden) sync(); }, 60000);

// ---------- partenza ----------
(async () => {
  let ready = false;
  try { ready = await Store.start(); } catch (err) { console.error(err); }
  if (!ready) return showLogin();
  if (Store.mode === "cloud" && !Store.db.categories.length) { try { await Store.refresh(); } catch {} }
  startApp();
  sync();
})();
})();
