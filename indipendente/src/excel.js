"use strict";
/* Excel nel telefono (libreria SheetJS, nessun server):
   - SpeseExcel.read(file): legge il Budget_Tracker della versione con il computer (mesi, viaggi, entrate,
     surplus/deficit, abbonamenti) e lo trasforma nei dati dell'app;
   - SpeseExcel.importInto(data, replace): li mette nell'archivio (store.js);
   - SpeseExcel.download(): crea un file Excel con riassunto, un foglio per mese, i viaggi e tutte le spese. */

(() => {
const MONTHS_IT = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const pad = (n) => String(n).padStart(2, "0");
const monthKey = (y, m) => `${y}-${pad(m)}`;
const text = (v) => String(v ?? "").trim();
const isNum = (v) => typeof v === "number" && isFinite(v);
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const cf = (s) => text(s).toLowerCase();
const uuid = () => crypto.randomUUID();

function serialToIso(v) {
  if (!isNum(v) || v < 20000 || v > 80000) return null;
  const d = XLSX.SSF.parse_date_code(v);
  return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
}

/** "Borsa di studio da ricevere:" → "Borsa di studio" */
const incomeName = (label) => text(label).replace(/:\s*$/, "").replace(/\s+da ricevere$/i, "").replace(/\s*\(.*?\)\s*$/, "").slice(0, 40) || "Entrata";

async function read(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  // le formule senza valore salvato (es. il BUDGET TOTALE scritto dall'app) si vedono solo con sheetStubs
  const wbF = XLSX.read(buf, { type: "array", cellFormula: true, sheetStubs: true });
  const hidden = new Set((wb.Workbook?.Sheets || []).filter((s) => s.Hidden).map((s) => s.name));
  const categories = [];
  const addCat = (c) => { c = text(c); if (c && !categories.some((x) => cf(x) === cf(c))) categories.push(c); };
  const months = [], expenses = [], trips = [];
  let subscriptions = [], moved = 0;

  for (const name of wb.SheetNames) {
    if (hidden.has(name) || name.startsWith("_")) continue;
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const h = rows.slice(0, 25).findIndex((r) => r && r.some((v) => /^descrizione$/i.test(text(v))) && r.some((v) => /^importo$/i.test(text(v))));
    if (h < 0) continue;
    const head = rows[h].map((v) => cf(v));
    const cDesc = head.indexOf("descrizione"), cAmt = head.indexOf("importo");
    const cDate = head.lastIndexOf("data", cDesc);
    const cCat = head.indexOf("categoria", cAmt);
    const nIdx = head.indexOf("note", cCat);
    const cNote = nIdx > 0 && nIdx <= cCat + 2 ? nIdx : -1;
    const cBud = head.findIndex((v, i) => i > cCat + 1 && v === "categoria" && /budget/.test(head[i + 1] || ""));
    const isTrip = name.startsWith("✈");
    const budgets = {};
    if (cBud > 0) {
      for (let r = h + 1; r < Math.min(rows.length, h + 40); r++) {
        const cat = text(rows[r]?.[cBud]);
        if (!cat) continue;
        if (/^totale/i.test(cat)) break;
        const b = rows[r][cBud + 1];
        budgets[cat] = isNum(b) ? b : 0;
        if (!isTrip) addCat(cat);
      }
    }
    const list = [];
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const desc = text(row[cDesc]), amt = row[cAmt], date = serialToIso(row[cDate]);
      if (!desc || !isNum(amt) || amt <= 0 || !date) continue;
      if (/^✈️?\s*Viaggio:/i.test(desc)) continue;   // totale del viaggio nel mese: arriva dal foglio del viaggio
      list.push({ date, description: desc, amount: r2(amt), category: text(row[cCat]) || null, note: cNote >= 0 ? text(row[cNote]) || null : null });
    }
    if (isTrip) {
      trips.push({ name: name.replace(/^✈\s*/, "").trim(), categories: Object.entries(budgets).map(([n, b]) => ({ name: n, budget: r2(b) })), expenses: list });
      continue;
    }
    const idx = MONTHS_IT.findIndex((m) => cf(name).startsWith(cf(m))) + 1;
    if (!idx) continue;
    list.forEach((e) => e.category && addCat(e.category));

    // entrate: tabella "💶 ENTRATE DEL MESE" (modello degli amici) oppure le cifre in colonna B sopra le spese
    const incomes = [];
    let carry = 0, carryOn = false;
    const listHead = rows.findIndex((r) => r && r.some((v) => text(v).startsWith("💶 ENTRATE DEL MESE")));
    if (listHead >= 0) {
      const col = rows[listHead].findIndex((v) => text(v).startsWith("💶 ENTRATE DEL MESE"));
      for (let r = listHead + 1; r < listHead + 12; r++) {
        const n = text(rows[r]?.[col]), a = rows[r]?.[col + 1];
        if (/^totale/i.test(n)) break;
        if (n || isNum(a)) incomes.push({ name: n || "Entrata", amount: r2(isNum(a) ? a : 0) });
      }
    }
    for (let r = 1; r < h; r++) {
      const label = text(rows[r]?.[0]), v = rows[r]?.[1];
      if (!label) continue;
      if (/riportat|surplus|deficit/i.test(label)) {
        if (isNum(v)) carry = r2(v);
        const total = rows.findIndex((x) => x && /budget totale|totale disponibile/i.test(text(x[0])));
        const f = total >= 0 ? wbF.Sheets[name][XLSX.utils.encode_cell({ r: total, c: 1 })]?.f || "" : "";
        carryOn = !!v && new RegExp(`\\$?B\\$?${r + 1}(?!\\d)`).test(f);
        continue;
      }
      if (listHead >= 0 || !isNum(v) || /totale|entrate del mese/i.test(label)) continue;
      incomes.push({ name: incomeName(label), amount: r2(v) });
    }
    // abbonamenti programmati (tabella "💳 ABBONAMENTI"): vince l'ultimo mese che li ha
    const subHead = rows.findIndex((r) => r && r.some((v) => text(v).includes("💳") && /ABBONAMENTI/.test(text(v))));
    if (subHead >= 0) {
      const col = rows[subHead].findIndex((v) => text(v).includes("💳"));
      const found = [];
      for (let r = subHead + 1; r < subHead + 7; r++) {
        const n = text(rows[r]?.[col]), a = rows[r]?.[col + 1];
        if (/^totale/i.test(n)) break;
        if (!n || !isNum(a)) continue;
        const m = n.match(/\((\d{1,2})\b[^)]*\)/);
        found.push({ name: n.replace(/\(.*?\)/g, "").trim() || n, amount: r2(a), day: m ? Math.min(31, +m[1]) : 1 });
      }
      if (found.length) subscriptions = found;
    }
    // una spesa scritta in un mese con la data di un altro (es. l'affitto pagato all'inizio del mese dopo) resta nel suo mese
    const ys = list.map((e) => e.date).filter((d) => +d.slice(5, 7) === idx).map((d) => +d.slice(0, 4));
    const year = ys.length ? ys.sort((a, b) => ys.filter((y) => y === b).length - ys.filter((y) => y === a).length)[0] : null;
    if (year) {
      for (const e of list) {
        if (+e.date.slice(5, 7) === idx && +e.date.slice(0, 4) === year) continue;
        const last = new Date(year, idx, 0).getDate();
        const real = e.date.split("-").reverse().join("/");
        e.date = `${year}-${pad(idx)}-${pad(Math.min(+e.date.slice(8), last))}`;
        e.note = [e.note, `data vera ${real}`].filter(Boolean).join(" · ");
        moved++;
      }
    }
    expenses.push(...list);
    months.push({ idx, year, incomes, carry, carry_on: carryOn, budgets });
  }

  // anno dei mesi senza spese: segue l'ordine dei fogli (dopo Dicembre viene l'anno dopo)
  const firstKnown = months.findIndex((m) => m.year);
  if (firstKnown >= 0) {
    for (let i = firstKnown + 1; i < months.length; i++) if (!months[i].year) months[i].year = months[i - 1].year + (months[i].idx <= months[i - 1].idx ? 1 : 0);
    for (let i = firstKnown - 1; i >= 0; i--) if (!months[i].year) months[i].year = months[i + 1].year - (months[i].idx >= months[i + 1].idx ? 1 : 0);
  }
  // spese di un viaggio scritte una per una anche in un mese (stessa data e cifra): restano solo nel viaggio,
  // e nel mese al loro posto compare la riga "✈️ Viaggio" (il totale del mese non cambia)
  let dupes = 0;
  for (const t of trips) {
    for (const e of t.expenses) {
      const i = expenses.findIndex((x) => x.date === e.date && Math.abs(x.amount - e.amount) < 0.005);
      if (i >= 0) { expenses.splice(i, 1); dupes++; }
    }
  }
  if (trips.length) addCat("Viaggi");
  expenses.forEach((e) => { if (e.category) e.category = categories.find((c) => cf(c) === cf(e.category)) || e.category; });
  const outMonths = months.filter((m) => m.year).map((m) => ({ month: monthKey(m.year, m.idx), incomes: m.incomes, carry: m.carry, carry_on: m.carry_on, budgets: m.budgets }));
  return { categories, months: outMonths, expenses, trips, subscriptions, dupes, moved };
}

/** Mette i dati letti dal file nell'archivio. replace = prima cancella quelli che ci sono. */
function importInto(d, replace) {
  const db = Store.db;
  if (replace) for (const t of ["categories", "months", "budgets", "expenses", "trips", "trip_categories", "subscriptions"]) db[t] = [];
  d.categories.forEach((n) => { if (!db.categories.some((c) => cf(c.name) === cf(n))) db.categories.push({ name: n, position: db.categories.length }); });
  for (const m of d.months) {
    db.months = db.months.filter((x) => x.month !== m.month);
    db.months.push({ month: m.month, income: r2(m.incomes.reduce((a, i) => a + i.amount, 0)), incomes: m.incomes, carry: m.carry, carry_on: m.carry_on });
    db.budgets = db.budgets.filter((b) => b.month !== m.month);
    for (const [c, v] of Object.entries(m.budgets)) db.budgets.push({ month: m.month, category: c, amount: r2(v) });
  }
  d.expenses.forEach((e) => db.expenses.push({ id: uuid(), ...e, trip: null }));
  for (const t of d.trips) {
    if (db.trips.some((x) => cf(x.name) === cf(t.name))) continue;
    db.trips.push({ name: t.name, note: null, position: db.trips.length });
    t.categories.forEach((c, i) => db.trip_categories.push({ trip: t.name, name: c.name, budget: c.budget, position: i }));
    t.expenses.forEach((e) => db.expenses.push({ id: uuid(), ...e, trip: t.name }));
  }
  if (d.subscriptions.length && (replace || !db.subscriptions.length)) {
    db.subscriptions = d.subscriptions.map((s, i) => ({ id: uuid(), ...s, auto: false, position: i }));
  }
  Store.commit();
}

function download(filename = `Spese ${new Date().toISOString().slice(0, 10)}.xlsx`) {
  const S = window.SpeseServer, db = Store.db;
  const wb = XLSX.utils.book_new();
  const asDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const style = (ws, widths) => { ws["!cols"] = widths.map((w) => ({ wch: w })); return ws; };
  const keys = S.monthKeys();
  const y = S.year();
  const summaryRows = [["Mese", "Entrate", "Budget", "Speso", "Surplus/Deficit"]];
  y.months.forEach((m) => summaryRows.push([`${m.month} ${m.key.slice(0, 4)}`, m.income, m.budget, m.spent, m.surplus]));
  summaryRows.push(["TOTALE (mesi iniziati)", y.total.income, y.total.budget, y.total.spent, y.total.surplus]);
  XLSX.utils.book_append_sheet(wb, style(XLSX.utils.aoa_to_sheet(summaryRows), [22, 12, 12, 12, 16]), "Riassunto");

  for (const k of keys) {
    const s = S.summary(k, keys);
    const m = db.months.find((x) => x.month === k);
    const exp = db.expenses.filter((e) => !e.trip && e.date.startsWith(k)).sort((a, b) => a.date.localeCompare(b.date));
    if (!exp.length && !s.budget && !s.income.base) continue;
    const aoa = [[`Spese · ${MONTHS_IT[+k.slice(5) - 1]} ${k.slice(0, 4)}`], []];
    (m?.incomes || []).forEach((i) => aoa.push([i.name, i.amount]));
    if (m?.carry) aoa.push([`Surplus/deficit riportato${m.carry_on ? "" : " (non contato)"}`, m.carry]);
    aoa.push(["Entrate totali", s.income.total], ["Budget", s.budget], ["Speso", s.total], [], ["Categoria", "Budget", "Speso", "Restano"]);
    s.categories.filter((c) => c.budget || c.total).forEach((c) => aoa.push([c.category, c.budget, c.total, c.left]));
    aoa.push([], ["Data", "Descrizione", "Importo", "Categoria", "Note"]);
    exp.forEach((e) => aoa.push([asDate(e.date), e.description, e.amount, e.category || "", e.note || ""]));
    for (const t of db.trips) {
      const tt = db.expenses.filter((e) => e.trip === t.name && e.date.startsWith(k));
      if (tt.length) aoa.push([asDate(tt.map((e) => e.date).sort()[0]), `✈️ Viaggio: ${t.name}`, r2(tt.reduce((a, e) => a + e.amount, 0)), "Viaggi", `${tt.length} spese del viaggio`]);
    }
    XLSX.utils.book_append_sheet(wb, style(XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" }), [28, 34, 12, 22, 30]), `${MONTHS_IT[+k.slice(5) - 1]} ${k.slice(0, 4)}`);
  }
  for (const t of db.trips) {
    const cats = db.trip_categories.filter((c) => c.trip === t.name).sort((a, b) => a.position - b.position);
    const exp = db.expenses.filter((e) => e.trip === t.name).sort((a, b) => a.date.localeCompare(b.date));
    const aoa = [[`Viaggio · ${t.name}`], [], ["Categoria", "Budget", "Speso"]];
    cats.forEach((c) => aoa.push([c.name, c.budget, r2(exp.filter((e) => cf(e.category) === cf(c.name)).reduce((a, e) => a + e.amount, 0))]));
    aoa.push([], ["Data", "Descrizione", "Importo", "Categoria", "Note"]);
    exp.forEach((e) => aoa.push([asDate(e.date), e.description, e.amount, e.category || "", e.note || ""]));
    XLSX.utils.book_append_sheet(wb, style(XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" }), [24, 34, 12, 22, 30]), `✈ ${t.name}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  }
  const all = [["Data", "Descrizione", "Importo", "Categoria", "Note", "Viaggio"],
    ...[...db.expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [asDate(e.date), e.description, e.amount, e.category || "", e.note || "", e.trip || ""])];
  XLSX.utils.book_append_sheet(wb, style(XLSX.utils.aoa_to_sheet(all, { cellDates: true, dateNF: "dd/mm/yyyy" }), [12, 34, 10, 22, 30, 20]), "Tutte le spese");
  XLSX.writeFile(wb, filename);
}

window.SpeseExcel = { read, importInto, download };
})();
