"use strict";
/* "Server nel telefono": risponde alle chiamate /api/… dell'app (le stesse di server/main.py sul Mac) usando i dati
   di Store (store.js). Così l'interfaccia è identica a quella della versione con il Mac (stessi file web/).
   Le chiamate vengono intercettate sostituendo window.fetch: tutto il resto passa normalmente. */

(() => {
const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const TRIP_TEMPLATE = ["Trasporto Principale", "Trasporto Locale", "Alloggio", "Cibo Ristorazione", "Cibo Spesa",
  "Intrattenimento / Attività", "Shopping e Personale", "Imprevisti Commissioni"];
const MAX_CATS = 15, TRIP_MAX_CATS = 20, MAX_SUBS = 5;
const FIXED = new Set(["affitto"]), SUBS = new Set(["abbonamenti"]), LUMPY = new Set(["affitto", "abbonamenti", "viaggi"]);
const ESSENTIAL = new Set(["spesa", "mensa", "lavatrici/asciugatrice", "affitto", "abbonamenti"]);
const SMALL = 5;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

// ---------- piccoli aiuti ----------
const db = () => Store.db;
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const cf = (s) => String(s ?? "").trim().toLowerCase();
const canonical = (name, list) => list.find((x) => cf(x) === cf(name)) || null;
const pad = (n) => String(n).padStart(2, "0");
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const keyOf = (iso) => iso.slice(0, 7);
const addMonthsKey = (key, n) => { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysIn = (key) => { const [y, m] = key.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const weekOf = (iso) => Math.min(5, Math.floor((+iso.slice(8, 10) - 1) / 7) + 1);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const round5 = (x) => Math.max(0, Math.round(x / 5) * 5);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const it2 = (x, dec = 2) => { const s = x.toFixed(dec).replace(".", ","); return dec === 1 ? s.replace(/,0$/, "") : s; };
const settings = () => Store.settings();

// numero di riga stabile per ogni spesa (l'app identifica le spese con sheet+row, come nel file Excel)
const rowOf = new Map(), idOf = new Map();
let nextRow = 1;
const row = (id) => { if (!rowOf.has(id)) { rowOf.set(id, nextRow); idOf.set(nextRow, id); nextRow++; } return rowOf.get(id); };

// ---------- categorie ----------
const catNames = () => [...db().categories].sort((a, b) => a.position - b.position).map((c) => c.name);
function addCategory(name, budget, key) {
  name = String(name || "").replace(/\s+/g, " ").trim();
  if (!name) throw bad("Scrivi un nome per la categoria");
  const have = canonical(name, catNames());
  if (have) return have;
  if (db().categories.length >= MAX_CATS) throw bad(`Al massimo ${MAX_CATS} categorie`);
  db().categories.push({ name, position: Math.max(-1, ...db().categories.map((c) => c.position)) + 1 });
  if (key) setBudget(key, name, budget || 0);
  return name;
}
const ensureCategory = (name) => canonical(name, catNames()) || addCategory(name, 0);

// ---------- mesi ----------
/** Mesi che "esistono" (come i fogli del file): dal primo con dati all'ultimo, sempre compreso quello in corso. */
function monthKeys() {
  const cur = keyOf(isoToday());
  const set = new Set([cur]);
  db().months.forEach((m) => set.add(m.month));
  db().budgets.forEach((b) => set.add(b.month));
  db().expenses.forEach((e) => set.add(keyOf(e.date)));
  const keys = [...set].sort();
  const out = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k = addMonthsKey(k, 1)) out.push(k);
  return out;
}
/** Nome del "foglio": il mese ("Novembre"), con l'anno solo se lo stesso mese compare due volte. */
function labelOf(key, keys = monthKeys()) {
  const m = +key.slice(5);
  const name = MONTHS[m - 1];
  return keys.filter((k) => +k.slice(5) === m).length > 1 ? `${name} ${key.slice(0, 4)}` : name;
}
function keyOfLabel(label) {
  if (!label) return null;
  if (/^\d{4}-\d{2}$/.test(label)) return label;
  const keys = monthKeys();
  return keys.find((k) => labelOf(k, keys) === label) || null;
}
const sheetKey = (sheet) => { const k = keyOfLabel(sheet); if (!k) throw new HttpError(404, "Mese non trovato"); return k; };
const monthRow = (key) => db().months.find((m) => m.month === key);

/** Come ensure_month: un mese nuovo prende entrate e budget dall'ultimo mese che li ha. */
function ensureMonth(key) {
  let m = monthRow(key);
  if (m) return m;
  const prev = [...db().months].filter((x) => x.month < key).sort((a, b) => b.month.localeCompare(a.month))[0];
  m = { month: key, income: prev?.income || 0, incomes: prev ? prev.incomes.map((i) => ({ ...i })) : [], carry: 0, carry_on: false };
  db().months.push(m);
  if (prev && !db().budgets.some((b) => b.month === key)) {
    db().budgets.filter((b) => b.month === prev.month).forEach((b) => db().budgets.push({ month: key, category: b.category, amount: b.amount }));
  }
  return m;
}
function setBudget(key, cat, amount) {
  const b = db().budgets.find((x) => x.month === key && cf(x.category) === cf(cat));
  if (b) b.amount = r2(Math.max(0, amount)); else db().budgets.push({ month: key, category: cat, amount: r2(Math.max(0, amount)) });
}
const budgetOf = (key, cat) => db().budgets.find((x) => x.month === key && cf(x.category) === cf(cat))?.amount || 0;

function income(key) {
  const m = monthRow(key) || { incomes: [], carry: 0, carry_on: false };
  const items = m.incomes.map((i) => ({ name: i.name, amount: r2(i.amount) }));
  const base = r2(items.reduce((a, i) => a + i.amount, 0));
  const carry = m.carry_on ? r2(m.carry) : 0;
  return { items, riporto: carry, base, total: r2(base + carry) };
}
function setIncome(key, values) {
  const m = ensureMonth(key);
  if (Array.isArray(values.items)) {
    m.incomes = values.items.filter((i) => String(i.name || "").trim()).slice(0, 10)
      .map((i) => ({ name: String(i.name).trim().slice(0, 40), amount: r2(i.amount) }));
  }
  if ("riporto" in values) {
    m.carry_on = !!values.riporto;
    if (values.riporto) m.carry = r2(values.riporto);
  }
  m.income = r2(m.incomes.reduce((a, i) => a + i.amount, 0));
}

// ---------- spese dei mesi ----------
const monthExpenses = (key) => db().expenses.filter((e) => !e.trip && keyOf(e.date) === key);
const tripExpenses = (trip) => db().expenses.filter((e) => e.trip === trip);

function tx(e, keys) {
  return { row: row(e.id), date: e.date, description: e.description, amount: e.amount, category: e.category, note: e.note,
    week: weekOf(e.date), sheet: labelOf(keyOf(e.date), keys), trip: null };
}
/** Righe "✈️ Viaggio: …" del mese: il totale di ogni viaggio con spese in quel mese (categoria Viaggi). */
function tripLinks(key, keys) {
  const out = [];
  for (const t of db().trips) {
    const ex = db().expenses.filter((e) => e.trip === t.name && keyOf(e.date) === key);
    if (!ex.length) continue;
    const dates = ex.map((e) => e.date).sort();
    out.push({ row: row("link:" + t.name + ":" + key), date: dates[0], description: "✈️ Viaggio: " + t.name, amount: r2(ex.reduce((a, e) => a + e.amount, 0)),
      category: canonical("Viaggi", catNames()) || "Viaggi", note: `Spese del viaggio (${ex.length})`, week: weekOf(dates[0]), sheet: labelOf(key, keys), trip: t.name });
  }
  return out;
}
const transactions = (key, keys = monthKeys()) => [...monthExpenses(key).map((e) => tx(e, keys)), ...tripLinks(key, keys)];
const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "") || b.row - a.row;

function summary(key, keys = monthKeys()) {
  const names = catNames();
  const spent = Object.fromEntries(names.map((c) => [c, [0, 0, 0, 0, 0]]));
  const extra = {};
  for (const t of transactions(key, keys)) {
    const c = canonical(t.category || "", names);
    const bucket = c ? spent[c] : (extra[t.category || "Senza categoria"] ||= [0, 0, 0, 0, 0]);
    bucket[Math.min(5, Math.max(1, t.week || 1)) - 1] += t.amount;
  }
  const rows = names.map((c) => {
    const b = budgetOf(key, c), tot = r2(spent[c].reduce((a, x) => a + x, 0));
    return { category: c, budget: b, weeks: spent[c].map(r2), total: tot, left: r2(b - tot) };
  });
  for (const [c, w] of Object.entries(extra)) { const tot = r2(w.reduce((a, x) => a + x, 0)); rows.push({ category: c, budget: 0, weeks: w.map(r2), total: tot, left: -tot }); }
  return { sheet: labelOf(key, keys), categories: rows, editable: true, budget: r2(rows.reduce((a, r) => a + r.budget, 0)),
    total: r2(rows.reduce((a, r) => a + r.total, 0)), income: income(key) };
}

function year() {
  const keys = monthKeys(), cur = keyOf(isoToday());
  const rows = keys.map((k) => {
    const s = summary(k, keys), inc = income(k);
    return { month: labelOf(k, keys), sheet: labelOf(k, keys), income: inc.base, budget: s.budget, spent: s.total,
      surplus: r2(s.budget - s.total), saved: r2(inc.base - s.total), current: k === cur, future: k > cur, key: k };
  });
  const counted = rows.filter((r) => !r.future);
  const total = Object.fromEntries(["income", "budget", "spent", "surplus", "saved"].map((f) => [f, r2(counted.reduce((a, r) => a + r[f], 0))]));
  return { months: rows, total };
}
function carryBefore(key) {
  return r2(year().months.filter((m) => m.key < key && !m.future && !m.current).reduce((a, m) => a + m.surplus, 0));
}

// ---------- suggerimento della categoria ----------
function normalize(text) {
  return String(text || "").toLowerCase().trim().replace(/\(.*?\)/g, " ").replace(/[^\p{L}\p{N}& ]+/gu, " ").replace(/\s+/g, " ").trim();
}
let KEYWORDS = {};
fetch("keywords.json").then((r) => r.json()).then((k) => (KEYWORDS = k)).catch(() => {});
function fromKeywords(key) {
  const scores = {}, padded = ` ${key} `;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    for (const raw of words) {
      const w = raw.toLowerCase();
      if (padded.includes(` ${w.trim()} `) || (w.length > 4 && key.includes(w.trim()))) scores[cat] = Math.max(scores[cat] || 0, (w.length > 3 ? 0.75 : 0.6) + Math.min(w.trim().length, 30) / 1000);  // a parità vince la parola più lunga
    }
  }
  return scores;
}
function historyIndex() {
  const names = catNames(), idx = new Map();
  for (const e of db().expenses) {
    if (e.trip) continue;
    const c = canonical(e.category || "", names); if (!c) continue;
    const k = normalize(e.description);
    if (!idx.has(k)) idx.set(k, {});
    idx.get(k)[c] = (idx.get(k)[c] || 0) + 1;
  }
  return idx;
}
function tokenSet(a, b) {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  let inter = 0; A.forEach((w) => B.has(w) && inter++);
  return inter ? (100 * inter) / Math.min(A.size, B.size) : 0;
}
function suggest(description, known = catNames()) {
  const key = normalize(description);
  const knownCf = new Map(known.map((k) => [cf(k), k]));
  const merged = new Map();
  const add = (cat, score, source) => {
    const canon = knownCf.get(cf(cat)) || cat;
    const cur = merged.get(cf(canon));
    if (!cur || score > cur.score) merged.set(cf(canon), { category: canon, score: r2(score), source, new: !knownCf.has(cf(canon)) });
  };
  if (key) {
    const learned = settings().learned || {};
    if (learned[key]) add(learned[key], 1, "storico");
    const idx = historyIndex();
    if (idx.has(key)) {
      const counts = idx.get(key), total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [c, n] of Object.entries(counts)) add(c, 0.6 + 0.35 * n / total, "storico");
    }
    const near = [...idx.keys()].filter((k) => k !== key && k.length > 2).map((k) => [k, tokenSet(key, k)]).filter(([, s]) => s >= 80)
      .sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [k, sim] of near) {
      const counts = idx.get(k), total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [c, n] of Object.entries(counts)) add(c, (sim / 100) * 0.85 * n / total, "storico");
    }
    for (const [c, s] of Object.entries(fromKeywords(key))) add(c, knownCf.has(cf(c)) ? s : s - 0.05, "parole chiave");
  }
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score || a.new - b.new).slice(0, 3);
  return { description, suggestions: ranked, ai_used: false };
}
function learn(description, category) {
  const s = settings();
  s.learned = { ...(s.learned || {}), [normalize(description)]: category };
}
function renameLearned(from, to) {
  const l = settings().learned || {};
  for (const k of Object.keys(l)) if (cf(l[k]) === cf(from)) l[k] = to;
}

// ---------- spese: aggiungi / modifica / elimina ----------
function installments(e) {
  const n = Math.max(1, Math.min(24, +e.split || 1));
  if (n <= 1) return [{ date: e.date, description: e.description.trim(), amount: r2(e.amount), note: e.note || null }];
  const part = r2(e.amount / n), out = [];
  const [y, m, d] = e.date.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    const key = addMonthsKey(`${y}-${pad(m)}`, i);
    const day = Math.min(d, daysIn(key));
    const amount = i < n - 1 ? part : r2(e.amount - part * (n - 1));
    const note = `Rata ${i + 1} di ${n} · totale ${e.amount.toFixed(2).replace(".", ",")} €` + (e.note ? ` · ${e.note}` : "");
    out.push({ date: `${key}-${pad(day)}`, description: `${e.description.trim()} (${i + 1}/${n})`, amount, note });
  }
  return out;
}
function addExpense(b) {
  if (!(b.amount > 0)) throw bad("Importo non valido");
  if (!String(b.description || "").trim()) throw bad("Scrivi una descrizione");
  if (b.id && db().expenses.some((e) => e.id === b.id)) return { status: "duplicate" };
  const key = keyOf(b.date);
  ensureMonth(key);
  let cat = canonical(b.category, catNames());
  if (!cat) {
    if (b.new_category_budget == null) throw bad(`Categoria '${b.category}' inesistente`);
    cat = addCategory(b.category, b.new_category_budget, key);
  }
  let first = null;
  installments({ ...b, category: cat }).forEach((p, i) => {
    ensureMonth(keyOf(p.date));
    const e = { id: i === 0 && isUuid(b.id) ? b.id : uuid(), date: p.date, description: p.description, amount: p.amount, category: cat, note: p.note, trip: null };
    db().expenses.push(e);
    first ||= e;
  });
  learn(b.description, cat);
  const keys = monthKeys();
  return { status: "saved", sheet: labelOf(key, keys), row: row(first.id), week: weekOf(first.date), category: cat, created_sheet: false, split: +b.split || 1 };
}
function findExpense(r, expect, trip = null) {
  const id = idOf.get(+r);
  const e = db().expenses.find((x) => x.id === id && (trip ? x.trip === trip : !x.trip));
  if (!e || (expect && (e.description.trim() !== String(expect.description).trim() || Math.abs(e.amount - expect.amount) > 0.005))) {
    throw new HttpError(409, "La spesa è cambiata nel frattempo: ricarica e riprova");
  }
  return e;
}
function editExpense(b) {
  const e = findExpense(b.row, b.expect);
  const oldKey = keyOf(e.date);
  const cat = canonical(b.category, catNames()) || addCategory(b.category, 0);
  const date = b.date || e.date;
  ensureMonth(keyOf(date));
  Object.assign(e, { date, description: b.description.trim(), amount: r2(b.amount), category: cat, note: b.note || null });
  learn(b.description, cat);
  const moved = keyOf(date) !== oldKey;
  return { status: "saved", sheet: labelOf(keyOf(date)), row: row(e.id), category: cat, moved };
}

// ---------- proposta di budget (advisor.propose) ----------
function pastMonths(before) {
  const cur = keyOf(isoToday()), keys = monthKeys(), out = [];
  for (const k of keys) {
    if (k >= before) break;
    if (k === cur) continue;
    const s = summary(k, keys);
    if (s.total > 0) out.push({ key: k, summary: s, byCat: Object.fromEntries(s.categories.map((c) => [cf(c.category), c.total])) });
  }
  return out;
}
function propose(key, saveRate = 0.1, useCarry = false, historyMonths = 3) {
  const keys = monthKeys();
  const current = Object.fromEntries(catNames().map((c) => [c, budgetOf(key, c)]));
  const inc = income(key);
  const months = pastMonths(key).slice(-historyMonths);
  const carry = carryBefore(key);
  const target = inc.base * (1 - saveRate) + (useCarry ? carry : 0);
  const subsTotal = r2(db().subscriptions.reduce((a, s) => a + s.amount, 0));
  const rows = [];
  let fixedTotal = 0, rawTotal = 0;
  for (const [cat, budget] of Object.entries(current)) {
    const k = cf(cat);
    const hist = months.map((m) => m.byCat[k] || 0);
    const avg = mean(hist);
    const over = months.reduce((a, m) => a + m.summary.categories.filter((c) => cf(c.category) === k && c.budget > 0 && c.total > c.budget).length, 0);
    const r = { category: cat, current: budget, avg: r2(avg), last: r2(hist.length ? hist[hist.length - 1] : 0), months_over: over, kind: "variabile" };
    if (FIXED.has(k)) { r.kind = "fissa"; r.proposal = round5(Math.max(r.last, budget, avg)); fixedTotal += r.proposal; }
    else if (SUBS.has(k)) { r.kind = "abbonamenti"; r.proposal = Math.round(Math.max(subsTotal, avg, budget)); fixedTotal += r.proposal; }
    else { r.raw = r2(avg > 0 ? avg : budget); rawTotal += r.raw; }
    rows.push(r);
  }
  const scale = rawTotal ? Math.max(0, target - fixedTotal) / rawTotal : 0;
  rows.forEach((r) => { if ("raw" in r) r.proposal = round5(r.raw * scale); });
  return { sheet: labelOf(key, keys), income: inc, save_rate: saveRate, carry, carry_included: !!monthRow(key)?.carry_on,
    target: r2(target), rows, total: r2(rows.reduce((a, r) => a + r.proposal, 0)), avg_total: r2(rows.reduce((a, r) => a + r.avg, 0)),
    history_used: months.map((m) => labelOf(m.key, keys)) };
}

// ---------- abbonamenti ----------
const subsSorted = () => [...db().subscriptions].sort((a, b) => a.position - b.position);
function subDone(s, key) {
  return db().expenses.some((e) => !e.trip && keyOf(e.date) === key && cf(e.description).includes(cf(s.name)) && Math.abs(e.amount - s.amount) < 0.01);
}
/** La categoria Viaggi c'è sempre: i viaggi finiscono lì nei totali del mese. */
function ensureViaggi() {
  if (!db().categories.length || canonical("Viaggi", catNames())) return false;
  try { addCategory("Viaggi", 0); return true; } catch { return false; }   // 15 categorie già usate: niente
}
function applySubscriptions() {
  const today = isoToday(), key = keyOf(today), added = [];
  if (ensureViaggi()) Store.commit();
  for (const s of subsSorted()) {
    if (!s.auto || Math.min(s.day, daysIn(key)) > +today.slice(8) || subDone(s, key)) continue;
    const cat = ensureCategory("Abbonamenti");
    ensureMonth(key);
    const date = `${key}-${pad(Math.min(s.day, daysIn(key)))}`;
    db().expenses.push({ id: uuid(), date, description: s.name, amount: s.amount, category: cat, note: "Abbonamento inserito in automatico", trip: null });
    added.push({ name: s.name, amount: s.amount, date, sheet: labelOf(key) });
  }
  if (added.length) {
    const st = settings();
    st.subs_log = [...(st.subs_log || []), ...added].slice(-50);
    Store.commit();
  }
  return added;
}

// ---------- viaggi ----------
const tripRow = (name) => { const t = db().trips.find((x) => x.name === name); if (!t) throw new HttpError(404, `Viaggio '${name}' non trovato`); return t; };
const tripCats = (name) => db().trip_categories.filter((c) => c.trip === name).sort((a, b) => a.position - b.position);
function tripSummary(name) {
  const cats = tripCats(name), known = cats.map((c) => c.name), txs = tripExpenses(name);
  const spent = Object.fromEntries(known.map((c) => [c, 0]));
  let other = 0;
  for (const t of txs) { const c = canonical(t.category || "", known); if (c) spent[c] += t.amount; else other += t.amount; }
  const rows = cats.map((c) => ({ category: c.name, budget: c.budget, total: r2(spent[c.name]), left: r2(c.budget - spent[c.name]) }));
  if (other) rows.push({ category: "Senza categoria", budget: 0, total: r2(other), left: r2(-other), virtual: true });
  const dates = txs.map((t) => t.date).sort();
  return { name, sheet: "✈ " + name, categories: rows, budget: r2(cats.reduce((a, c) => a + c.budget, 0)), total: r2(txs.reduce((a, t) => a + t.amount, 0)),
    count: txs.length, from: dates[0] || null, to: dates[dates.length - 1] || null };
}
const tripTx = (e) => ({ row: row(e.id), date: e.date, description: e.description, amount: e.amount, category: e.category, note: e.note, trip: e.trip });
function addTripCategory(trip, name, budget = 0) {
  name = String(name || "").replace(/\s+/g, " ").trim();
  if (!name) throw bad("Scrivi un nome per la categoria");
  if (name.toUpperCase() === "TOTALE") throw bad("Questo nome non si può usare");
  const cats = tripCats(trip);
  if (canonical(name, cats.map((c) => c.name))) throw bad(`La categoria '${name}' c'è già in questo viaggio`);
  if (cats.length >= TRIP_MAX_CATS) throw bad(`Un viaggio può avere al massimo ${TRIP_MAX_CATS} categorie`);
  db().trip_categories.push({ trip, name, budget: r2(budget), position: Math.max(-1, ...cats.map((c) => c.position)) + 1 });
  return name;
}
function copyTripBudgets(trip, source) {
  let copied = 0;
  for (const c of tripCats(source)) {
    const have = tripCats(trip).find((x) => cf(x.name) === cf(c.name));
    if (have) have.budget = c.budget;
    else { try { addTripCategory(trip, c.name, c.budget); } catch { continue; } }
    copied++;
  }
  return copied;
}

// ---------- risparmi (advisor.insights) ----------
function insights() {
  const y = year(), keys = monthKeys(), cur = keyOf(isoToday());
  const closed = y.months.filter((m) => m.key !== cur && !m.future && m.spent > 0);
  const savedClosed = r2(closed.reduce((a, m) => a + m.saved, 0));
  const incomeClosed = closed.reduce((a, m) => a + m.income, 0);
  const closedKeys = closed.map((m) => m.key);
  const closedSheets = closed.map((m) => m.sheet);
  const txs = db().expenses.filter((e) => !e.trip && closedKeys.includes(keyOf(e.date))).map((e) => ({ ...e, sheet: labelOf(keyOf(e.date), keys) }));
  const nMonths = Math.max(1, closedKeys.length);
  const themeTxs = {};
  for (const t of txs) {
    if (FIXED.has(cf(t.category))) continue;
    const kw = fromKeywords(normalize(t.description));
    const best = Object.keys(kw).sort((a, b) => kw[b] - kw[a])[0];
    const theme = best || (t.category ? t.category[0].toUpperCase() + t.category.slice(1).toLowerCase() : "Altro");
    (themeTxs[theme] ||= []).push(t);
  }
  const themes = Object.entries(themeTxs).map(([k, v]) => [k, v.reduce((a, t) => a + t.amount, 0)]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const items = (list, limit = 5) => {
    const by = {};
    for (const t of list) { const n = t.description.trim(); const k = n[0].toUpperCase() + n.slice(1).toLowerCase(); (by[k] ||= []).push(t.amount); }
    return Object.entries(by).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0)).slice(0, limit)
      .map(([name, v]) => ({ name, count: v.length, total: r2(v.reduce((x, y) => x + y, 0)) }));
  };
  const byMonth = (list) => closedSheets.map((s) => ({ sheet: s, total: r2(list.filter((t) => t.sheet === s).reduce((a, t) => a + t.amount, 0)) }));
  const detail = (theme) => {
    const tt = themeTxs[theme];
    return { count: tt.length, per_month_count: Math.round(tt.length / nMonths * 10) / 10, avg_ticket: tt.length ? r2(tt.reduce((a, t) => a + t.amount, 0) / tt.length) : 0,
      items: items(tt), months: byMonth(tt) };
  };
  const byDesc = {};
  for (const t of txs) if (!FIXED.has(cf(t.category))) (byDesc[normalize(t.description)] ||= []).push(t.amount);
  const recurring = Object.entries(byDesc).filter(([, a]) => a.length >= 3).map(([d, a]) => [d, a.length, a.reduce((x, y) => x + y, 0)]).sort((a, b) => b[2] - a[2]).slice(0, 6);
  const small = txs.filter((t) => t.amount < SMALL);
  const subs = subsSorted(), subsTotal = subs.reduce((a, s) => a + s.amount, 0);
  const tips = [];
  for (const [theme, amount] of themes.filter(([k]) => !ESSENTIAL.has(cf(k))).slice(0, 3)) {
    const monthly = amount / nMonths, d = detail(theme);
    tips.push({ title: theme, monthly: r2(monthly), saving: r2(monthly * 0.3),
      text: `In media ${Math.round(monthly)} €/mese. Riducendo del 30% risparmi circa ${Math.round(monthly * 0.3)} €/mese (${Math.round(monthly * 0.3 * 12)} € in un anno).`,
      how: `Sono circa ${it2(d.per_month_count, 1)} spese al mese da ${it2(d.avg_ticket)} € in media. Basta farne ${Math.max(1, Math.round(d.per_month_count * 0.3))} in meno al mese.`,
      top: d.items.slice(0, 4).map((i) => i.name), ...d });
  }
  if (small.length) {
    const tot = small.reduce((a, t) => a + t.amount, 0);
    tips.push({ title: "Piccole spese (sotto 5 €)", monthly: r2(tot / nMonths), saving: r2(tot / nMonths * 0.3),
      text: `${small.length} spese per ${Math.round(tot)} € in totale: sembrano poco, ma sono ${Math.round(tot / nMonths)} €/mese.`,
      how: "Caffè, snack e bibite: sono quelle che non si notano. Prova a segnarle tutte per un mese.",
      top: [], count: small.length, per_month_count: Math.round(small.length / nMonths * 10) / 10, avg_ticket: r2(tot / small.length), items: items(small), months: byMonth(small) });
  }
  if (subs.length) {
    tips.push({ title: "Abbonamenti", monthly: r2(subsTotal), saving: 0,
      text: `${subsTotal.toFixed(2)} €/mese, cioè ${Math.round(subsTotal * 12)} € l'anno. Controlla se li usi tutti.`,
      how: "Per ognuno chiediti: l'ho usato questo mese? Se no, sospenderlo è il risparmio più facile.",
      top: subs.map((s) => `${s.name} ${s.amount.toFixed(2)} €`), items: subs.map((s) => ({ name: s.name, count: 12, total: r2(s.amount * 12) })), items_label: "in un anno", months: [] });
  }
  const perCat = {}, names = {};
  for (const m of closed) {
    for (const c of summary(m.key, keys).categories) {
      if (c.budget > 0) { const k = cf(c.category); names[k] ||= c.category; (perCat[k] ||= []).push({ sheet: m.sheet, budget: c.budget, total: c.total }); }
    }
  }
  const over = {}, budgetTips = [];
  for (const [k, ms] of Object.entries(perCat)) {
    const nOver = ms.filter((x) => x.total > x.budget).length;
    if (nOver) over[names[k][0].toUpperCase() + names[k].slice(1).toLowerCase()] = nOver;
    const avgSpent = mean(ms.map((x) => x.total)), avgBudget = mean(ms.map((x) => x.budget));
    if (FIXED.has(k)) continue;
    if (nOver >= 2 || (ms.length === 1 && nOver && avgSpent > avgBudget * 1.2)) {
      budgetTips.push({ category: names[k], kind: "alza", months_over: nOver, months: ms, avg_spent: r2(avgSpent), avg_budget: r2(avgBudget), suggest: round5(avgSpent) });
    } else if (ms.every((x) => x.total < x.budget * 0.7) && avgBudget - avgSpent >= 10) {
      budgetTips.push({ category: names[k], kind: "abbassa", months_over: 0, months: ms, avg_spent: r2(avgSpent), avg_budget: r2(avgBudget), suggest: round5(avgSpent * 1.1) });
    }
  }
  budgetTips.sort((a, b) => Math.abs(b.avg_spent - b.avg_budget) - Math.abs(a.avg_spent - a.avg_budget));
  return {
    months: y.months, current_month: MONTHS[+cur.slice(5) - 1], saved_closed: savedClosed,
    saving_rate: incomeClosed ? Math.round(savedClosed / incomeClosed * 1000) / 1000 : 0,
    avg_saved: closed.length ? r2(savedClosed / closed.length) : 0,
    themes: themes.map(([k, v]) => ({ theme: k, total: r2(v), monthly: r2(v / nMonths), ...detail(k) })),
    recurring: recurring.map(([d, n, s]) => ({ description: d, count: n, total: r2(s) })),
    over_budget: Object.entries(over).map(([category, months]) => ({ category, months })).sort((a, b) => b.months - a.months),
    tips, budget_tips: budgetTips.slice(0, 5), pace: currentPace(), closed_months: closedSheets,
  };
}
function currentPace() {
  const today = isoToday(), key = keyOf(today), days = daysIn(key), day = +today.slice(8);
  const rows = [];
  for (const c of summary(key).categories) {
    if (!c.budget && !c.total) continue;
    const lumpy = LUMPY.has(cf(c.category));
    const projected = lumpy || day < 7 ? c.total : c.total / day * days;
    const left = c.budget - c.total;
    rows.push({ category: c.category, budget: c.budget, total: c.total, used: c.budget ? Math.round(c.total / c.budget * 1000) / 1000 : null,
      projected: r2(projected), lumpy, per_day: left > 0 ? r2(left / (days - day + 1)) : 0 });
  }
  return { sheet: labelOf(key), day, days, reliable: day >= 7, categories: rows };
}

// ---------- le risposte, una per indirizzo ----------
const routes = {
  "GET /api/version": () => ({ version: null }),
  "POST /api/diag": () => ({ status: "ok" }),
  "GET /api/update": () => { throw new HttpError(503, "Gli aggiornamenti arrivano da soli con la pagina"); },
  "GET /api/offline-pack": () => {
    const history = {};
    for (const [k, counts] of historyIndex()) history[k] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return { keywords: KEYWORDS, learned: settings().learned || {}, history };
  },

  "GET /api/state": (q) => {
    const day = q.day || isoToday(), key = keyOf(day), keys = monthKeys();
    const recent = transactions(key, keys).sort(byDateDesc).slice(0, 30);
    return { today: day, week: weekOf(day), summary: summary(key, keys), recent, descriptions: [...historyIndex().keys()].sort(),
      pending: 0, excel_open: false, ai: { mode: "off", available: false }, file: "online", problem: null };
  },
  "POST /api/suggest": (q, b) => suggest(b.description || ""),
  "POST /api/expenses": (q, b) => addExpense(b),
  "POST /api/expenses/edit": (q, b) => editExpense(b),
  "POST /api/expenses/delete": (q, b) => { const e = findExpense(b.row, b.expect); db().expenses = db().expenses.filter((x) => x !== e); return { status: "deleted" }; },

  "GET /api/months": () => {
    const keys = monthKeys(), today = isoToday(), cur = keyOf(today), nxt = addMonthsKey(cur, 1);
    return { months: keys.map((k) => ({ sheet: labelOf(k, keys), editable: true, future: k > cur })),
      current: labelOf(cur, keys), this: { label: MONTHS[+cur.slice(5) - 1], date: today },
      next: { sheet: keys.includes(nxt) ? labelOf(nxt, keys) : null, label: MONTHS[+nxt.slice(5) - 1], date: `${nxt}-01` } };
  },
  // "＋ Mese": il mese dopo l'ultimo, con entrate e budget dell'ultimo mese (come ensureMonth)
  "POST /api/months/add": () => {
    const next = addMonthsKey(monthKeys().at(-1), 1);
    ensureMonth(next);
    return { status: "ok", sheet: labelOf(next), created: true, date: `${next}-01` };
  },
  "GET /api/month": (q) => {
    const key = sheetKey(q.sheet), keys = monthKeys();
    return { summary: summary(key, keys), transactions: transactions(key, keys).sort(byDateDesc), categories: catNames() };
  },
  "GET /api/year": () => { const y = year(); y.months.forEach((m) => delete m.key); return y; },

  "PUT /api/budget": (q, b) => { const key = keyOf(b.date || isoToday()); ensureMonth(key); setBudget(key, canonical(b.category, catNames()) || addCategory(b.category, 0), b.budget); return { status: "ok" }; },
  "GET /api/budget/proposal": (q) => {
    const key = q.sheet ? sheetKey(q.sheet) : keyOf(q.date || isoToday());
    const p = propose(key, Math.max(0, Math.min(0.5, +(q.save_rate ?? 0.1))), q.use_carry === "true");
    if (!q.sheet) p.sheet = MONTHS[+key.slice(5) - 1];
    return p;
  },
  "PUT /api/budgets": (q, b) => {
    const key = b.sheet ? sheetKey(b.sheet) : keyOf(b.date || isoToday());
    ensureMonth(key);
    const targets = [key, ...(b.apply_following ? monthKeys().filter((k) => k > key) : [])];
    targets.forEach((t, i) => {
      ensureMonth(t);
      if (b.income && Object.keys(b.income).length) {
        const inc = { ...b.income };
        if (i > 0) delete inc.riporto;
        setIncome(t, inc);
      }
      for (const [cat, v] of Object.entries(b.budgets || {})) setBudget(t, canonical(cat, catNames()) || addCategory(cat, 0), Math.max(0, +v || 0));
    });
    return { status: "ok", sheet: labelOf(key), months: targets.length };
  },
  "POST /api/budgets/copy": (q, b) => {
    const from = sheetKey(b.sheet);
    let src = catNames().map((c) => [c, budgetOf(from, c)]);
    if (b.category) {
      const name = canonical(b.category, catNames());
      if (!name) throw bad(`Categoria '${b.category}' non trovata in ${b.sheet}`);
      src = [[name, budgetOf(from, name)]];
    }
    const done = [];
    for (const t of b.targets || []) {
      const k = keyOfLabel(t);
      if (!k || k === from) continue;
      ensureMonth(k);
      src.forEach(([c, v]) => setBudget(k, c, v));
      done.push(t);
    }
    if (!done.length) throw bad("Nessun mese da aggiornare");
    return { status: "ok", months: done, categories: src.length };
  },

  "GET /api/subscriptions": (q) => {
    const key = q.sheet ? keyOfLabel(q.sheet) || keyOf(isoToday()) : keyOf(isoToday());
    const items = subsSorted().map((s, i) => ({ row: i, label: s.name, name: s.name, amount: s.amount, day: s.day, done: subDone(s, key), auto: s.auto }));
    return { sheet: labelOf(key), items, recent: (settings().subs_log || []).slice(-5) };
  },
  "PUT /api/subscriptions": (q, b) => {
    const items = b.items || [];
    if (items.length > MAX_SUBS) throw bad(`Al massimo ${MAX_SUBS} abbonamenti`);
    const old = subsSorted();
    db().subscriptions = items.map((it, i) => {
      const prev = old.find((s) => cf(s.name) === cf(it.name));
      return { id: prev?.id || uuid(), name: String(it.name).trim(), amount: r2(it.amount), day: Math.max(1, Math.min(31, +it.day || 1)), auto: !!it.auto, position: i };
    });
    Store.commit();
    return { status: "ok", added: applySubscriptions() };
  },

  "GET /api/profile": () => { const { learned, subs_log, ...rest } = settings(); return rest; },
  "PUT /api/profile": (q, b) => { Object.assign(settings(), b); return { status: "ok" }; },
  "GET /api/balance": () => {
    const bal = settings().balance || {};
    if (typeof bal.amount !== "number" || !bal.date) return { amount: null };
    const today = isoToday();
    const spent = r2(db().expenses.filter((e) => e.date > bal.date && e.date <= today).reduce((a, e) => a + e.amount, 0));
    return { amount: bal.amount, date: bal.date, spent_since: spent, estimate: r2(bal.amount - spent) };
  },

  "GET /api/insights": () => insights(),
  "POST /api/advice": () => { throw new HttpError(503, "I consigli scritti da Claude ci sono solo nella versione con il computer"); },
  "GET /api/quick": () => {
    const names = catNames(), groups = new Map();
    for (const t of db().expenses.filter((e) => !e.trip).sort((a, b) => a.date.localeCompare(b.date)).slice(-250)) {
      const k = cf(t.description); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
    }
    const out = [];
    for (const items of [...groups.values()].sort((a, b) => b.length - a.length).slice(0, 8)) {
      if (items.length < 2) break;
      const amounts = items.map((i) => i.amount).sort((a, b) => a - b), last = items[items.length - 1];
      out.push({ description: last.description, amount: amounts[Math.floor(amounts.length / 2)], category: canonical(last.category || "", names) || last.category, count: items.length });
    }
    return { items: out };
  },

  "GET /api/trips": () => ({ trips: [...db().trips].sort((a, b) => a.position - b.position).map((t) => tripSummary(t.name)), ready: true }),
  "GET /api/trip": (q) => {
    tripRow(q.name);
    const cats = tripCats(q.name).map((c) => c.name);
    return { summary: tripSummary(q.name), transactions: tripExpenses(q.name).map(tripTx).sort(byDateDesc), categories: cats, free_slots: TRIP_MAX_CATS - cats.length };
  },
  "POST /api/trips": (q, b) => {
    const name = String(b.name || "").replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28);
    if (!name) throw bad("Scrivi il nome del viaggio");
    if (db().trips.some((t) => cf(t.name) === cf(name))) throw bad(`Il viaggio '${name}' esiste già`);
    db().trips.push({ name, note: b.note || null, position: Math.max(-1, ...db().trips.map((t) => t.position)) + 1 });
    ensureViaggi();
    if (b.copy_from) copyTripBudgets(name, b.copy_from);
    else TRIP_TEMPLATE.forEach((c) => addTripCategory(name, c, (b.budgets || {})[c] || 0));
    return { status: "ok", name };
  },
  "POST /api/trips/delete": (q, b) => {
    tripRow(b.name);
    db().trips = db().trips.filter((t) => t.name !== b.name);
    db().trip_categories = db().trip_categories.filter((c) => c.trip !== b.name);
    db().expenses = db().expenses.filter((e) => e.trip !== b.name);
    return { status: "deleted" };
  },
  "POST /api/trips/expense": (q, b) => {
    tripRow(b.trip);
    if (b.id && db().expenses.some((e) => e.id === b.id)) return { status: "duplicate" };
    let cat = canonical(b.category, tripCats(b.trip).map((c) => c.name));
    if (!cat) {
      if (b.new_category_budget == null) throw bad(`Categoria '${b.category}' inesistente in questo viaggio`);
      cat = addTripCategory(b.trip, b.category, b.new_category_budget);
    }
    ensureMonth(keyOf(b.date));
    const e = { id: isUuid(b.id) ? b.id : uuid(), date: b.date, description: b.description.trim(), amount: r2(b.amount), category: cat, note: b.note || null, trip: b.trip };
    db().expenses.push(e);
    return { status: "saved", trip: b.trip, row: row(e.id), category: cat };
  },
  "POST /api/trips/edit": (q, b) => {
    const e = findExpense(b.row, b.expect, b.trip);
    const cats = tripCats(b.trip).map((c) => c.name);
    const cat = canonical(b.category, cats) || addTripCategory(b.trip, b.category, 0);
    Object.assign(e, { date: b.date || e.date, description: b.description.trim(), amount: r2(b.amount), category: cat, note: b.note || null });
    return { status: "saved", trip: b.trip, row: row(e.id), category: cat };
  },
  "POST /api/trips/delete-expense": (q, b) => { const e = findExpense(b.row, b.expect, b.trip); db().expenses = db().expenses.filter((x) => x !== e); return { status: "deleted" }; },
  "PUT /api/trips/budget": (q, b) => {
    const c = tripCats(b.trip).find((x) => cf(x.name) === cf(b.category));
    if (!c) throw bad(`Categoria del viaggio '${b.category}' non trovata`);
    c.budget = r2(Math.max(0, b.budget));
    return { status: "ok" };
  },
  "POST /api/trips/category": (q, b) => { tripRow(b.trip); return { status: "ok", name: addTripCategory(b.trip, b.name, b.budget || 0) }; },
  "POST /api/trips/delete-category": (q, b) => {
    const cats = tripCats(b.trip), cat = canonical(b.name, cats.map((c) => c.name));
    if (!cat) throw bad(`Categoria del viaggio '${b.name}' non trovata`);
    const to = b.move_to ? canonical(b.move_to, cats.map((c) => c.name)) : null;
    if (b.move_to && (!to || to === cat)) throw bad("Scegli un'altra categoria del viaggio in cui spostare le spese");
    let moved = 0;
    if (to) tripExpenses(b.trip).forEach((e) => { if (cf(e.category) === cf(cat)) { e.category = to; moved++; } });
    db().trip_categories = db().trip_categories.filter((c) => !(c.trip === b.trip && c.name === cat));
    return { status: "ok", moved };
  },
  "POST /api/trips/copy-budget": (q, b) => {
    if (b.trip === b.source) throw bad("Scegli un altro viaggio");
    tripRow(b.trip); tripRow(b.source);
    return { status: "ok", copied: copyTripBudgets(b.trip, b.source) };
  },

  "GET /api/categories": (q) => {
    const key = q.sheet ? keyOfLabel(q.sheet) || keyOf(isoToday()) : keyOf(isoToday());
    const s = summary(key);
    return { sheet: s.sheet, categories: s.categories.map((c) => ({ category: c.category, budget: c.budget, total: c.total })),
      free_slots: MAX_CATS - catNames().length, income: income(key) };
  },
  "POST /api/categories/rename": (q, b) => {
    const from = canonical(b.old, catNames());
    const to = String(b.new || "").trim();
    if (!from) throw bad(`Categoria '${b.old}' non trovata`);
    if (!to) throw bad("Scrivi il nuovo nome");
    const clash = canonical(to, catNames());
    if (clash && cf(clash) !== cf(from)) throw bad(`Esiste già una categoria '${clash}'`);
    db().categories.forEach((c) => { if (c.name === from) c.name = to; });
    db().budgets.forEach((x) => { if (cf(x.category) === cf(from)) x.category = to; });
    let n = 0;
    db().expenses.forEach((e) => { if (!e.trip && cf(e.category) === cf(from)) { e.category = to; n++; } });
    renameLearned(from, to);
    return { status: "ok", changed: n };
  },
  "POST /api/categories/delete": (q, b) => {
    if (cf(b.name) === "viaggi") throw bad("La categoria Viaggi serve per i totali dei viaggi: non si può eliminare");
    const src = canonical(b.name, catNames());
    if (!src) throw bad(`Categoria '${b.name}' non trovata`);
    const dest = b.move_to ? canonical(b.move_to, catNames()) : null;
    const rows = db().expenses.filter((e) => !e.trip && cf(e.category) === cf(src));
    if (rows.length && !dest) throw bad(`'${src}' ha delle spese: scegli in quale categoria spostarle`);
    rows.forEach((e) => (e.category = dest));
    db().categories = db().categories.filter((c) => c.name !== src);
    db().budgets = db().budgets.filter((x) => cf(x.category) !== cf(src));
    if (dest) renameLearned(src, dest);
    return { status: "ok", moved: rows.length };
  },
  "POST /api/categories/add": (q, b) => {
    if (canonical(b.name, catNames())) throw bad(`La categoria '${b.name}' esiste già`);
    const key = b.sheet ? sheetKey(b.sheet) : keyOf(isoToday());
    ensureMonth(key);
    addCategory(b.name, b.budget || 0, key);
    return { status: "ok" };
  },

  "GET /api/excel": () => ({ file: "Spese.xlsx", on_mac: true, files_url: null, mtime: null }),
  "POST /api/excel/open": () => {
    if (!window.XLSX) throw new HttpError(503, "Sto ancora caricando: riprova tra un attimo");
    window.SpeseExcel.download();
    return { status: "ok" };
  },

  "POST /api/import/parse": async (q, b) => {
    const parsed = await window.SpeseImport.parse(b.filename, b.data);
    const existing = db().expenses;
    const keys = monthKeys();
    const first = keys[0];
    const known = catNames();
    const items = parsed.items.map((it, i) => {
      const dup = existing.find((t) => Math.abs(t.amount - it.amount) < 0.005 && Math.abs(new Date(t.date) - new Date(it.date)) <= 2 * 864e5);
      const top = suggest(it.description, known).suggestions[0];
      return { ...it, i, blocked: keyOf(it.date) < first && db().expenses.length ? "Prima dell'inizio del budget" : null,
        duplicate: dup ? `${dup.description} (${dup.trip ? "✈️ " + dup.trip : labelOf(keyOf(dup.date), keys)})` : null,
        category: top?.category || null, new: !!top?.new, score: top ? top.score : 0 };
    });
    return { items, income: parsed.income, categories: known };
  },
  "POST /api/import/save": (q, b) => {
    const sheets = new Set();
    for (const it of b.items || []) {
      const cat = ensureCategory(it.category);
      ensureMonth(keyOf(it.date));
      db().expenses.push({ id: uuid(), date: it.date, description: it.description.trim(), amount: r2(it.amount), category: cat, note: it.note || null, trip: null });
      learn(it.description, cat);
      sheets.add(labelOf(keyOf(it.date)));
    }
    return { status: "ok", count: (b.items || []).length, sheets: [...sheets].sort() };
  },
};

// ---------- aggancio a fetch ----------
const realFetch = window.fetch.bind(window);
const WRITE = new Set(["POST", "PUT", "DELETE"]);
const READONLY_POST = new Set(["/api/suggest", "/api/diag", "/api/import/parse", "/api/advice", "/api/excel/open"]);

async function handle(path, method, body) {
  const url = new URL(path, location.origin);
  const fn = routes[`${method} ${url.pathname}`];
  if (!fn) throw new HttpError(404, "Funzione non disponibile nella versione senza computer");
  const q = Object.fromEntries(url.searchParams.entries());
  const before = WRITE.has(method) && !READONLY_POST.has(url.pathname) ? JSON.stringify(Store.db) : null;
  try {
    const out = await fn(q, body || {});
    if (before !== null && JSON.stringify(Store.db) !== before) Store.commit();
    return out;
  } catch (err) {
    if (before !== null) { Store.db = JSON.parse(before); Store.normalize(); }   // niente modifiche a metà
    throw err;
  }
}

window.fetch = async (input, init = {}) => {
  const path = typeof input === "string" ? input : input.url;
  const u = new URL(path, location.origin);
  if (u.origin !== location.origin || !u.pathname.startsWith("/api/")) return realFetch(input, init);
  const method = (init.method || "GET").toUpperCase();
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch {}
  try {
    const out = await handle(u.pathname + u.search, method, body);
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return new Response(JSON.stringify({ detail: err.message || "Errore" }), { status, headers: { "Content-Type": "application/json" } });
  }
};

window.SpeseServer = { applySubscriptions, monthKeys, labelOf, summary, year, catNames, suggest };
// abbonamenti automatici: all'avvio e ogni mezz'ora (come il server sul Mac)
setInterval(() => Store.mode && applySubscriptions(), 30 * 60 * 1000);
})();
