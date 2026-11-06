"use strict";
/* App "Spese" in modalità indipendente: niente Mac, niente server Python, niente Tailscale.
   I dati passano da Store (store.js): Supabase online oppure solo nel browser (prova).
   Tutti i calcoli (mese, budget, suggerimenti, Excel) si fanno qui nel telefono. */

const $ = (id) => document.getElementById(id);
const LOCALE = "it-IT";
const eur = (n) => (n ?? 0).toLocaleString(LOCALE, { style: "currency", currency: "EUR" });
const eur0 = (n) => (n ?? 0).toLocaleString(LOCALE, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const lc = (s) => String(s || "").toLowerCase();
const sign = (n) => (n < -0.004 ? "neg" : n > 0.004 ? "pos" : "");
const parseAmount = (s) => {
  let t = String(s ?? "").replace(/\s|€/g, "");
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "") : t.replace(/,/g, "");
  return parseFloat(t.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
};
const numIn = (n) => (n ? String(Math.round(n * 100) / 100).replace(".", ",") : "");
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => isoDay(new Date());
const yesterday = () => isoDay(new Date(Date.now() - 864e5));
const thisMonth = () => today().slice(0, 7);
const addMonths = (key, n) => { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fmtDay = (d) => (!d ? "" : d === today() ? "Oggi" : d === yesterday() ? "Ieri"
  : new Date(d + "T12:00").toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" }));
const shortMonth = (key) => { const [y, m] = key.split("-"); return `${MONTHS_IT[+m - 1].slice(0, 3)}${y === thisMonth().slice(0, 4) ? "" : " " + y.slice(2)}`; };

const EMOJI = [
  ["affitto", "🏠"], ["spesa", "🛒"], ["mensa", "🍽️"], ["lavatric", "🧺"], ["abbigliamento", "👕"], ["abbonament", "🔁"],
  ["viagg", "✈️"], ["svago", "🎉"], ["varie", "📦"], ["trasport", "🚌"], ["cura", "💊"], ["casa", "🛋️"], ["fast food", "🍔"],
  ["ristorant", "🍔"], ["regal", "🎁"], ["commission", "🏦"], ["sport", "🏋️"], ["salute", "💊"],
];
const emoji = (cat) => (EMOJI.find(([k]) => lc(cat).includes(k)) || [, "💶"])[1];

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2800);
}
const failMsg = (err) => (/Failed to fetch|NetworkError|Load failed/i.test(err?.message) ? "Niente connessione: riprova quando sei online" : err?.message || "Qualcosa è andato storto");

function confirmBox(title, text, okLabel = "Conferma") {
  return new Promise((resolve) => {
    const d = $("confirm");
    $("cf-title").textContent = title; $("cf-text").textContent = text; $("cf-ok").textContent = okLabel;
    d.returnValue = ""; d.onclose = () => resolve(d.returnValue === "ok"); d.showModal();
  });
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-close]"); if (b) b.closest("dialog").close(); });

/** Chiede il nome di una categoria (niente prompt(): nell'app dalla schermata Home di iPhone non è affidabile). */
function askName() {
  return new Promise((resolve) => {
    const d = $("namedlg");
    $("nd-name").value = "";
    d.returnValue = "";
    d.onclose = () => resolve(d.returnValue === "ok" ? $("nd-name").value.trim() || null : null);
    d.showModal();
    setTimeout(() => $("nd-name").focus(), 50);
  });
}

// ================= DATI CALCOLATI =================

const db = () => Store.db;
const catNames = () => db().categories.map((c) => c.name);
const expensesOf = (month) => db().expenses.filter((e) => e.date.startsWith(month));

/** Riepilogo di un mese: per categoria budget/speso, totali. */
function monthSummary(month) {
  const exp = expensesOf(month);
  const bud = db().budgets[month] || {};
  const names = catNames();
  const canon = (c) => names.find((n) => lc(n) === lc(c));
  const rows = names.map((name) => ({ category: name, budget: bud[name] || 0, total: 0 }));
  let other = 0;
  for (const e of exp) {
    const r = rows.find((x) => x.category === canon(e.category));
    if (r) r.total += e.amount; else other += e.amount;
  }
  if (other) rows.push({ category: "Senza categoria", budget: 0, total: other, virtual: true });
  rows.forEach((r) => (r.total = Math.round(r.total * 100) / 100));
  const total = Math.round(exp.reduce((a, e) => a + e.amount, 0) * 100) / 100;
  const budget = Math.round(Object.entries(bud).filter(([c]) => canon(c)).reduce((a, [, v]) => a + v, 0) * 100) / 100;
  return { month, rows, total, budget, income: db().months[month]?.income || 0, expenses: exp };
}

// ================= NAVIGAZIONE =================

let view = "home";
const VIEWS = ["login", "home", "history", "budget", "more"];

function go(name, opts = {}) {
  if (name !== "login" && !Store.mode) name = "login";
  view = name;
  VIEWS.forEach((v) => ($(`view-${v}`).hidden = v !== name));
  $("tabs").hidden = name === "login";
  document.querySelectorAll("#tabs [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === name));
  document.body.classList.toggle("has-plan-bar", name === "budget");
  if (name === "history" && opts.category !== undefined) histFilter = opts.category;
  if (name === "history" && opts.month) histMonth = opts.month;
  render();
  window.scrollTo(0, 0);
  if (name !== "login") history.replaceState(null, "", "#" + name);
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });

function render() {
  if (view === "home") renderHome();
  else if (view === "history") renderHistory();
  else if (view === "budget") renderBudget();
  else if (view === "more") renderMore();
}

// ================= ACCESSO =================

function showLogin() {
  const cloud = Store.cloudConfigured();
  $("login-cloud").hidden = !cloud;
  $("login-nocloud").hidden = cloud;
  go("login");
}

async function afterLogin() {
  try { await Store.refresh(); } catch (err) { toast(failMsg(err)); }
  go(location.hash.slice(1) && VIEWS.includes(location.hash.slice(1)) && location.hash !== "#login" ? location.hash.slice(1) : "home");
}

function loginMsg(text, bad) { $("login-msg").textContent = text; $("login-msg").classList.toggle("neg", !!bad); }

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg("Entro…");
  try { await Store.signIn($("login-email").value.trim(), $("login-pass").value); loginMsg(""); afterLogin(); }
  catch (err) { loginMsg(failMsg(err), true); }
});
$("login-up").addEventListener("click", async () => {
  if (!$("login-form").reportValidity()) return;
  loginMsg("Creo l'account…");
  try {
    const r = await Store.signUp($("login-email").value.trim(), $("login-pass").value);
    if (r.confirm) loginMsg("Ti ho mandato un'email: apri il link per confermare, poi torna qui e premi Entra.");
    else { loginMsg(""); afterLogin(); }
  } catch (err) { loginMsg(failMsg(err), true); }
});
$("login-demo").addEventListener("click", () => { Store.startDemo(); go("home"); });

// ================= HOME =================

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
  const sub = [t.trip ? "✈️ " + t.trip : t.category || "Senza categoria", fmtDay(t.date), t.note].filter(Boolean).map(esc).join(" · ");
  return `<li data-id="${esc(t.id)}" data-i="${i}"><span class="emoji">${emoji(t.category)}</span>
    <div class="what"><b>${esc(t.description)}</b><span>${sub}</span></div><span class="amt">${eur(t.amount)}</span></li>`;
}

function renderHome() {
  const m = thisMonth();
  const s = monthSummary(m);
  $("home-month").textContent = `${MONTHS_IT[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
  const left = s.budget - s.total;
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  $("hero").innerHTML = s.budget > 0 ? `
      <p class="big-label">Hai speso questo mese</p>
      <div class="big-num ${left < 0 ? "neg" : ""}">${eur(s.total)}</div>
      <div class="progress"><i class="${left < 0 ? "over" : ""}" style="width:${Math.min(100, (s.total / s.budget) * 100)}%"></i></div>
      <div class="meta"><span class="${left < 0 ? "neg" : ""}">${left >= 0 ? `Ti restano ${eur(left)} di ${eur0(s.budget)}` : `Hai superato il budget di ${eur(-left)}`}</span><span>${daysLeft} giorni alla fine del mese</span></div>`
    : `<p class="big-label">Hai speso questo mese</p><div class="big-num">${eur(s.total)}</div>
      <div class="meta"><span>Nessun budget per questo mese.</span></div>
      <button class="secondary cta" type="button" data-go="budget">Imposta il budget</button>`;
  const cats = s.rows.filter((c) => c.total > 0 || c.budget > 0).sort((a, b) => b.total - a.total);
  $("home-cats").innerHTML = cats.length ? cats.map(catRow).join("") : `<li class="empty" style="display:block">Ancora nessuna spesa questo mese.</li>`;
  const recent = [...db().expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $("home-recent").innerHTML = recent.length ? recent.map(txRow).join("") : `<li class="empty" style="display:block">Tocca ＋ per aggiungere la prima spesa.</li>`;
}

$("home-cats").addEventListener("click", (e) => { const li = e.target.closest("li[data-cat]"); if (li) go("history", { category: li.dataset.cat, month: thisMonth() }); });
for (const id of ["home-recent", "hist-list"]) {
  $(id).addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]"); if (!li) return;
    const t = db().expenses.find((x) => x.id === li.dataset.id);
    if (t) openSheet(t);
  });
}

// ================= STORICO =================

let histMonth = null;
let histFilter = null;

function monthsWithData() {
  const keys = new Set([thisMonth(), ...db().expenses.map((e) => e.date.slice(0, 7)), ...Object.keys(db().budgets)]);
  return [...keys].filter((k) => k <= thisMonth()).sort().reverse();
}

function renderHistory() {
  const months = monthsWithData();
  if (!histMonth || !months.includes(histMonth)) histMonth = months[0];
  $("hist-pills").innerHTML = months.map((k) => `<button data-m="${k}" class="${k === histMonth ? "on" : ""}">${shortMonth(k)}</button>`).join("");
  const s = monthSummary(histMonth);
  const left = s.budget - s.total;
  $("hist-summary").innerHTML = `<div><span>Speso</span><b>${eur(s.total)}</b></div>
    <div><span>Budget</span><b>${s.budget ? eur0(s.budget) : "—"}</b></div>
    <div><span>${!s.budget ? "Rimasto" : left >= 0 ? "Avanzo" : "Sforato"}</span><b class="${s.budget ? sign(left) : ""}">${s.budget ? eur(Math.abs(left)) : "—"}</b></div>`;
  const cats = s.rows.filter((c) => c.total > 0 || c.budget > 0).sort((a, b) => b.total - a.total);
  $("hist-cats").innerHTML = cats.length ? cats.map(catRow).join("") : `<li class="empty" style="display:block">Nessuna spesa né budget.</li>`;
  const used = [...new Set(s.expenses.map((e) => e.category || "Senza categoria"))];
  if (histFilter && !used.some((c) => lc(c) === lc(histFilter))) histFilter = null;
  $("hist-filter").innerHTML = used.length > 1 ? `<button data-c="" class="${!histFilter ? "on" : ""}">Tutte</button>` +
    used.map((c) => `<button data-c="${esc(c)}" class="${lc(c) === lc(histFilter) ? "on" : ""}">${emoji(c)} ${esc(c)}</button>`).join("") : "";
  const list = s.expenses.filter((e) => !histFilter || lc(e.category || "Senza categoria") === lc(histFilter)).sort((a, b) => b.date.localeCompare(a.date));
  const byDay = {};
  list.forEach((t) => (byDay[t.date] ||= []).push(t));
  let i = 0;
  $("hist-list").innerHTML = list.length ? Object.entries(byDay).map(([d, items]) =>
    `<div class="group-head"><span>${fmtDay(d)}</span><span>${eur(items.reduce((a, t) => a + t.amount, 0))}</span></div>
     <div class="card"><ul class="tx-list">${items.map((t) => txRow(t, i++)).join("")}</ul></div>`).join("")
    : `<p class="empty">Nessuna spesa${histFilter ? " in questa categoria" : ""}.</p>`;
}

$("hist-pills").addEventListener("click", (e) => { const b = e.target.closest("button[data-m]"); if (!b) return; histMonth = b.dataset.m; histFilter = null; renderHistory(); });
$("hist-filter").addEventListener("click", (e) => { const b = e.target.closest("button[data-c]"); if (!b) return; histFilter = b.dataset.c || null; renderHistory(); });
$("hist-cats").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-cat]"); if (!li) return;
  histFilter = li.dataset.cat; renderHistory(); $("hist-list").scrollIntoView({ behavior: "smooth" });
});

// ================= BUDGET =================

let budMonth = thisMonth();

function renderBudget() {
  const opts = [addMonths(thisMonth(), -1), thisMonth(), addMonths(thisMonth(), 1), addMonths(thisMonth(), 2)];
  if (!opts.includes(budMonth)) budMonth = thisMonth();
  $("bud-pills").innerHTML = opts.map((k) => `<button data-m="${k}" class="${k === budMonth ? "on" : ""}">${shortMonth(k)}</button>`).join("");
  const s = monthSummary(budMonth);
  if (document.activeElement !== $("bud-income")) $("bud-income").value = numIn(s.income);
  $("bud-list").innerHTML = s.rows.filter((r) => !r.virtual).map((r) => `<li><span class="emoji">${emoji(r.category)}</span>
      <button type="button" class="name" data-cat="${esc(r.category)}">${esc(r.category).replace(/\//g, "/<wbr>")}<small>${r.total ? `speso ${eur(r.total)}` : "niente speso"}</small></button>
      <input data-cat="${esc(r.category)}" inputmode="decimal" placeholder="0" value="${numIn(r.budget)}" aria-label="Budget ${esc(r.category)}"></li>`).join("");
  updateBudBar();
}

function updateBudBar() {
  const income = parseAmount($("bud-income").value) || 0;
  const assigned = [...document.querySelectorAll("#bud-list input")].reduce((a, i) => a + (parseAmount(i.value) || 0), 0);
  const left = income - assigned;
  $("bud-bar").className = "plan-bar" + (income && left < -0.5 ? " neg" : income && Math.abs(left) < 0.5 ? " ok" : "");
  $("bud-bar").innerHTML = `<div><small>Entrate</small><b>${eur0(income)}</b></div>
    <div><small>Nelle categorie</small><b>${eur0(assigned)}</b></div>
    <div class="pb-state"><b>${!income ? "Scrivi le entrate" : left < -0.5 ? `⚠️ Sfori di ${eur0(-left)}` : Math.abs(left) < 0.5 ? "✓ Tutto diviso" : `Restano ${eur0(left)}`}</b>
      <small>${$("bud-saved").textContent}</small></div>`;
}

let budTimer = null;
function scheduleBudgetSave() {
  $("bud-saved").textContent = "Salvo…";
  updateBudBar();
  clearTimeout(budTimer);
  budTimer = setTimeout(saveBudget, 700);
}
async function saveBudget() {
  clearTimeout(budTimer);
  const month = budMonth;
  const budgets = {};
  document.querySelectorAll("#bud-list input").forEach((i) => (budgets[i.dataset.cat] = parseAmount(i.value) || 0));
  const income = parseAmount($("bud-income").value) || 0;
  try {
    const cur = monthSummary(month);
    if (income !== cur.income) await Store.setIncome(month, income);
    const changed = Object.fromEntries(Object.entries(budgets).filter(([c, v]) => v !== (db().budgets[month]?.[c] || 0) || !(c in (db().budgets[month] || {}))));
    await Store.setBudgets(month, changed);
    $("bud-saved").textContent = "✓ Salvato";
  } catch (err) { $("bud-saved").textContent = "Non salvato"; toast(failMsg(err)); }
  if (view === "budget") updateBudBar();
}

$("bud-pills").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-m]"); if (!b) return;
  if (budTimer) await saveBudget();
  budMonth = b.dataset.m; $("bud-saved").textContent = ""; renderBudget();
});
$("bud-income").addEventListener("input", scheduleBudgetSave);
$("bud-list").addEventListener("input", (e) => { if (e.target.matches("input")) scheduleBudgetSave(); });
$("bud-list").addEventListener("click", async (e) => {
  const b = e.target.closest("button.name"); if (!b) return;
  const res = await editCategory(b.dataset.cat);
  if (!res) return;
  try {
    if (res.action === "delete") { await Store.deleteCategory(b.dataset.cat, res.moveTo); toast("Categoria eliminata"); }
    else if (res.name && res.name !== b.dataset.cat) { await Store.renameCategory(b.dataset.cat, res.name); toast("Categoria rinominata"); }
  } catch (err) { toast(failMsg(err)); }
  renderBudget();
});
$("bud-add").addEventListener("click", async () => {
  const name = await askName();
  if (!name) return;
  try { await Store.addCategory(name); renderBudget(); } catch (err) { toast(failMsg(err)); }
});
$("bud-copy").addEventListener("click", async () => {
  const prev = addMonths(budMonth, -1);
  const src = db().budgets[prev];
  if (!src || !Object.values(src).some((v) => v > 0)) return toast(`${shortMonth(prev)} non ha un budget da copiare`);
  try {
    await Store.setBudgets(budMonth, src);
    if (!db().months[budMonth]?.income && db().months[prev]?.income) await Store.setIncome(budMonth, db().months[prev].income);
    toast(`✓ Copiato il budget di ${shortMonth(prev)}`);
    renderBudget();
  } catch (err) { toast(failMsg(err)); }
});
window.addEventListener("pagehide", () => budTimer && saveBudget());

function editCategory(name) {
  return new Promise((resolve) => {
    const d = $("catdlg");
    const n = db().expenses.filter((e) => e.category === name).length;
    $("cd-title").textContent = name;
    $("cd-name").value = name;
    $("cd-delete-box").hidden = true;
    $("cd-move").innerHTML = `<option value="">— lasciale senza categoria —</option>` + catNames().filter((c) => c !== name).map((c) => `<option>${esc(c)}</option>`).join("");
    $("cd-delete").textContent = "Elimina";
    let deleting = false;
    $("cd-delete").onclick = () => {
      if (!deleting) {
        deleting = true;
        $("cd-delete-box").hidden = false;
        $("cd-move").closest("label").hidden = !n;
        $("cd-delete-text").textContent = n ? `Ci sono ${n} spese in questa categoria (in tutti i mesi): scegli dove spostarle, poi premi Conferma.` : "Premi Conferma per eliminarla.";
        $("cd-delete").textContent = "Conferma";
        return;
      }
      d.close("delete");
    };
    d.onclose = () => resolve(d.returnValue === "delete" ? { action: "delete", moveTo: $("cd-move").value || null }
      : d.returnValue === "ok" ? { action: "save", name: $("cd-name").value.trim() } : null);
    d.returnValue = "";
    d.showModal();
  });
}

// ================= ALTRO: account, Excel =================

function renderMore() {
  $("more-account").textContent = Store.mode === "cloud" ? `Sei entrato come ${Store.user?.email || "—"}. I dati sono online.`
    : "Stai usando l'app senza account: i dati sono solo in questo browser.";
  $("more-logout").textContent = Store.mode === "cloud" ? "Esci" : "Torna alla schermata di accesso";
}

$("more-logout").addEventListener("click", async () => {
  if (Store.mode === "cloud" && !(await confirmBox("Esci", "Esci dall'account su questo dispositivo? I dati restano online.", "Esci"))) return;
  if (Store.mode === "demo") { localStorage.removeItem("indip-mode"); Store.mode = null; return showLogin(); }
  await Store.signOut();
  showLogin();
});

$("more-export").addEventListener("click", () => {
  if (!window.XLSX) return toast("Sto ancora caricando: riprova tra un attimo");
  if (!db().expenses.length && !Object.keys(db().budgets).length) return toast("Non ci sono ancora dati da scaricare");
  downloadExcel(db(), `Spese ${today()}.xlsx`);
});

let importData = null;
$("more-import").addEventListener("click", () => $("more-file").click());
$("more-file").addEventListener("change", async () => {
  const f = $("more-file").files[0];
  $("more-file").value = "";
  if (!f) return;
  if (!window.XLSX) return toast("Sto ancora caricando: riprova tra un attimo");
  try { importData = await readBudgetExcel(f); }
  catch (err) { importData = null; return toast("Non riesco a leggere questo file: " + failMsg(err)); }
  const d = importData;
  const total = d.expenses.reduce((a, e) => a + e.amount, 0);
  const box = $("import-preview");
  box.hidden = false;
  if (!d.expenses.length && !d.months.length) { box.innerHTML = `<p class="hint">Non ho trovato spese né budget in questo file.</p>`; return; }
  const first = d.expenses.map((e) => e.date).sort()[0], last = d.expenses.map((e) => e.date).sort().at(-1);
  box.innerHTML = `<div class="import-box">
    <p><b>Ho trovato:</b></p>
    <ul><li>${d.expenses.length} spese per ${eur(total)}${first ? ` (dal ${fmtDay(first)} al ${fmtDay(last)})` : ""}</li>
      <li>${d.months.length} mesi con entrate o budget: ${d.months.map((m) => shortMonth(m.month)).join(", ") || "—"}</li>
      <li>${d.categories.length} categorie</li>
      ${d.trips.length ? `<li>${d.trips.length} ${d.trips.length === 1 ? "viaggio" : "viaggi"} (${d.trips.map(esc).join(", ")}): le spese vanno in Viaggi</li>` : ""}
      ${d.dupes ? `<li>${d.dupes} spese dei viaggi erano già scritte nei mesi: non le conto due volte</li>` : ""}
      ${d.moved ? `<li>${d.moved} ${d.moved === 1 ? "spesa scritta in un mese con la data di un altro resta" : "spese scritte in un mese con la data di un altro restano"} nel mese del foglio (data vera nella nota)</li>` : ""}</ul>
    <button class="primary" type="button" id="imp-replace">Sostituisci i dati dell'app con questi</button>
    <button class="secondary" type="button" id="imp-add">Aggiungi ai dati che ci sono</button>
    <button class="secondary" type="button" id="imp-cancel">Annulla</button></div>`;
});
$("import-preview").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b || !importData) return;
  if (b.id === "imp-cancel") { $("import-preview").hidden = true; importData = null; return; }
  const replace = b.id === "imp-replace";
  if (replace && db().expenses.length && !(await confirmBox("Sostituisci tutto", `Le ${db().expenses.length} spese che ci sono adesso nell'app verranno cancellate e sostituite con quelle del file.`, "Sostituisci"))) return;
  b.disabled = true; b.textContent = "Importo…";
  try {
    await Store.importAll(importData, replace);
    toast(`✓ Importate ${importData.expenses.length} spese`);
    importData = null;
    $("import-preview").hidden = true;
    go("home");
  } catch (err) { toast(failMsg(err)); b.disabled = false; b.textContent = "Riprova"; }
});

$("more-wipe").addEventListener("click", async () => {
  if (!(await confirmBox("Cancella tutti i dati", "Spese, budget, entrate e categorie di questo account spariscono per sempre. Scarica prima l'Excel se vuoi tenerne una copia.", "Cancella tutto"))) return;
  try { await Store.wipe(); toast("Dati cancellati"); go("home"); } catch (err) { toast(failMsg(err)); }
});

// ================= AGGIUNGI / MODIFICA =================

let editing = null;        // spesa che sto modificando (null = nuova)
let selected = null;       // {category, isNew}
let suggestions = [];
let picked = false;        // categoria toccata a mano: il suggerimento non la cambia più
let dayChoice = "0";

function openSheet(tx = null) {
  editing = tx;
  picked = !!tx;
  selected = tx?.category ? { category: tx.category, isNew: false } : null;
  suggestions = [];
  $("sheet-title").textContent = tx ? "Modifica spesa" : "Nuova spesa";
  $("sheet-delete").hidden = !tx;
  $("amount").value = tx ? numIn(tx.amount) : "";
  $("desc").value = tx?.description || "";
  $("note").value = tx?.note || "";
  $("extra").open = !!tx?.note;
  setDay(tx ? (tx.date === today() ? "0" : tx.date === yesterday() ? "1" : "other") : "0", tx?.date);
  $("desc-list").innerHTML = [...new Set(db().expenses.map((e) => e.description))].slice(-300).map((d) => `<option value="${esc(d)}">`).join("");
  $("hint").textContent = "";
  renderCats();
  $("sheet").showModal();
  if (!tx) setTimeout(() => $("amount").focus(), 50);
}

function setDay(choice, date) {
  dayChoice = choice;
  document.querySelectorAll("#day-seg button").forEach((b) => b.classList.toggle("on", b.dataset.day === choice));
  $("date").hidden = choice !== "other";
  if (choice === "other") $("date").value = date || $("date").value || today();
}
const chosenDate = () => (dayChoice === "0" ? today() : dayChoice === "1" ? yesterday() : $("date").value);

function catItem(cat, isNew, tag) {
  const on = selected && lc(selected.category) === lc(cat);
  return `<li><button type="button" class="pick ${isNew ? "new" : ""} ${on ? "on" : ""}" data-cat="${esc(cat)}" data-new="${isNew ? 1 : 0}">
    <span class="emoji">${emoji(cat)}</span><span class="name">${esc(cat)}${tag ? `<small class="tag">${tag}</small>` : ""}</span>
    <span class="radio"></span></button></li>`;
}

function renderCats() {
  const cats = catNames();
  const sugg = suggestions.filter((s) => s.score >= 0.5);
  const rest = cats.filter((c) => !sugg.some((s) => lc(s.category) === lc(c)));
  $("cat-grid").innerHTML =
    (sugg.length ? `<li class="sep">Suggerite</li>` + sugg.map((s) => catItem(s.category, s.isNew, s.isNew ? "nuova" : s === sugg[0] ? "consigliata" : "")).join("") +
      `<li class="sep">Tutte le categorie</li>` : "") +
    rest.map((c) => catItem(c, false, "")).join("") +
    `<li><button type="button" class="pick other" data-other="1"><span class="emoji">＋</span><span class="name">Nuova categoria…</span></button></li>`;
  updateSave();
}

function updateSave() {
  const amt = parseAmount($("amount").value);
  $("save").disabled = !(amt > 0 && $("desc").value.trim() && selected && chosenDate());
}

let suggTimer = null;
$("desc").addEventListener("input", () => {
  updateSave();
  clearTimeout(suggTimer);
  suggTimer = setTimeout(() => {
    suggestions = suggestCategory($("desc").value, catNames(), db().expenses);
    const best = suggestions[0];
    if (!picked && best && best.score >= 0.6) selected = { category: best.category, isNew: best.isNew };
    $("hint").textContent = best ? `· ${best.source === "storico" ? "come le altre volte" : "dalle parole chiave"}` : "";
    renderCats();
  }, 200);
});
$("amount").addEventListener("input", updateSave);
$("date").addEventListener("change", updateSave);
$("day-seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-day]"); if (b) { setDay(b.dataset.day); updateSave(); } });
$("cat-grid").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.other) {
    const name = await askName();
    if (!name?.trim()) return;
    selected = { category: name.trim(), isNew: !catNames().some((c) => lc(c) === lc(name.trim())) };
    if (selected.isNew) suggestions = [{ category: selected.category, score: 1, isNew: true, source: "tu" }, ...suggestions];
  } else selected = { category: b.dataset.cat, isNew: b.dataset.new === "1" };
  picked = true;
  renderCats();
});
$("sheet-close").addEventListener("click", () => $("sheet").close());

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("save").disabled) return;
  $("save").disabled = true;
  const exp = { date: chosenDate(), description: $("desc").value.trim(), amount: parseAmount($("amount").value),
    category: selected.category, note: $("note").value.trim() || null, trip: editing?.trip || null };
  try {
    if (selected.isNew) exp.category = await Store.addCategory(selected.category);
    if (editing) await Store.updateExpense(editing.id, exp); else await Store.addExpense(exp);
    $("sheet").close();
    toast(editing ? "✓ Spesa modificata" : `✓ Salvata: ${eur(exp.amount)} in ${exp.category}`);
    render();
  } catch (err) { toast(failMsg(err)); updateSave(); }
});

$("sheet-delete").addEventListener("click", async () => {
  if (!editing) return;
  if (!(await confirmBox("Elimina spesa", `Elimino "${editing.description}" da ${eur(editing.amount)}?`, "Elimina"))) return;
  try { await Store.deleteExpense(editing.id); $("sheet").close(); toast("Spesa eliminata"); render(); }
  catch (err) { toast(failMsg(err)); }
});

$("fab").addEventListener("click", () => openSheet());

// ================= AVVIO =================

window.addEventListener("online", () => Store.mode === "cloud" && Store.refresh().then(render).catch(() => {}));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Store.mode === "cloud" && !$("sheet").open) Store.refresh().then(render).catch(() => {});
});

(async () => {
  let ready = false;
  try { ready = await Store.start(); } catch (err) { toast(failMsg(err)); }
  if (!ready) return showLogin();
  const start = VIEWS.includes(location.hash.slice(1)) && location.hash !== "#login" ? location.hash.slice(1) : "home";
  go(start);                                       // subito con la copia salvata nel dispositivo
  if (Store.mode === "cloud") { try { await Store.refresh(); render(); } catch (err) { toast(failMsg(err)); } }
})();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
