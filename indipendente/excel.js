"use strict";
/* Excel nel telefono (libreria SheetJS, nessun server):
   - readBudgetExcel(file): legge il Budget_Tracker attuale (fogli dei mesi e dei viaggi) e restituisce
     categorie, entrate e budget di ogni mese, spese;
   - downloadExcel(db): crea un file Excel con riassunto, un foglio per mese e tutte le spese. */

const MONTHS_IT = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const monthKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;            // m da 1 a 12
const monthLabel = (key) => { const [y, m] = key.split("-"); return `${MONTHS_IT[+m - 1]} ${y}`; };

const cellText = (v) => String(v ?? "").trim();
const isNum = (v) => typeof v === "number" && isFinite(v);

/** Numero di data di Excel → "AAAA-MM-GG" (senza passare dai fusi orari). */
function serialToIso(v) {
  if (!isNum(v) || v < 20000 || v > 80000) return null;
  const d = XLSX.SSF.parse_date_code(v);
  return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
}

async function readBudgetExcel(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const hidden = new Set((wb.Workbook?.Sheets || []).filter((s) => s.Hidden).map((s) => s.name));
  const categories = [];
  const addCat = (c) => { c = cellText(c); if (c && !categories.some((x) => x.toLowerCase() === c.toLowerCase())) categories.push(c); };
  const months = [];       // {name, idx (1-12), year?, income, budgets, expenses}
  const expenses = [];
  const trips = [];
  const tripLists = [];    // le spese dei viaggi si aggiungono alla fine, togliendo quelle già scritte nei mesi
  let dupes = 0, moved = 0;

  for (const name of wb.SheetNames) {
    if (hidden.has(name) || name.startsWith("_")) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    // riga delle intestazioni: quella che ha "Descrizione" e "Importo"
    const h = rows.slice(0, 25).findIndex((r) => r && r.some((v) => /^descrizione$/i.test(cellText(v))) && r.some((v) => /^importo$/i.test(cellText(v))));
    if (h < 0) continue;
    const head = rows[h].map((v) => cellText(v).toLowerCase());
    const cDesc = head.indexOf("descrizione"), cAmt = head.indexOf("importo");
    const cDate = head.lastIndexOf("data", cDesc);
    const cCat = head.indexOf("categoria", cAmt);
    const cNote = head.indexOf("note", cCat) > 0 && head.indexOf("note", cCat) <= cCat + 2 ? head.indexOf("note", cCat) : -1;
    // tabella dei budget: un'altra colonna "Categoria" più a destra, con accanto "Budget…"
    const cBud = head.findIndex((v, i) => i > cCat + 1 && v === "categoria" && /budget/.test(head[i + 1] || ""));
    const isTrip = name.startsWith("✈");
    const budgets = {};
    if (cBud > 0 && !isTrip) {
      for (let r = h + 1; r < Math.min(rows.length, h + 40); r++) {
        const cat = cellText(rows[r]?.[cBud]);
        if (!cat) continue;
        if (/^totale/i.test(cat)) break;
        addCat(cat);
        const b = rows[r][cBud + 1];
        budgets[cat] = isNum(b) ? b : 0;
      }
    }
    const trip = isTrip ? name.replace(/^✈\s*/, "") : null;
    const list = [];
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const desc = cellText(row[cDesc]), amt = row[cAmt], date = serialToIso(row[cDate]);
      if (!desc || !isNum(amt) || amt <= 0 || !date) continue;
      if (/^✈️?\s*Viaggio:/i.test(desc)) continue;   // totale del viaggio nel mese: le spese vere arrivano dal foglio del viaggio
      const cat = cellText(row[cCat]);
      const note = cNote >= 0 ? cellText(row[cNote]) : "";
      if (isTrip) list.push({ date, description: desc, amount: amt, category: "Viaggi", note: [cat, note].filter(Boolean).join(" · ") || null, trip });
      else { if (cat) addCat(cat); list.push({ date, description: desc, amount: amt, category: cat || null, note: note || null, trip: null }); }
    }
    if (isTrip) { trips.push(trip); tripLists.push(list); continue; }

    const idx = MONTHS_IT.findIndex((m) => name.toLowerCase().startsWith(m.toLowerCase())) + 1;
    if (!idx) { expenses.push(...list); continue; }
    // una spesa scritta nel foglio di un mese ma con la data di un altro (es. l'affitto di settembre pagato il 5 ottobre):
    // resta nel mese del foglio, con la data vera nella nota
    const sheetYear = (() => { const ys = list.map((e) => e.date).filter((d) => +d.slice(5, 7) === idx).map((d) => +d.slice(0, 4)); return ys[0] || null; })();
    if (sheetYear) {
      for (const e of list) {
        if (+e.date.slice(5, 7) === idx && +e.date.slice(0, 4) === sheetYear) continue;
        const last = new Date(sheetYear, idx, 0).getDate();
        const real = e.date.split("-").reverse().join("/");
        e.date = `${sheetYear}-${String(idx).padStart(2, "0")}-${String(Math.min(+e.date.slice(8), last)).padStart(2, "0")}`;
        e.note = [e.note, `data vera ${real}`].filter(Boolean).join(" · ");
        moved++;
      }
    }
    expenses.push(...list);
    // entrate: le cifre sopra le spese, tranne totali e surplus/deficit
    let income = 0;
    for (let r = 0; r < h; r++) {
      const label = cellText(rows[r]?.[0]), v = rows[r]?.[1];
      if (label && isNum(v) && !/totale|surplus|deficit|riportat/i.test(label)) income += v;
    }
    const years = list.map((e) => +e.date.slice(0, 4));
    const year = years.length ? years.sort((a, b) => years.filter((y) => y === b).length - years.filter((y) => y === a).length)[0] : null;
    months.push({ idx, year, income, budgets });
  }

  // anno dei mesi senza spese: segue l'ordine dei fogli (dopo Dicembre viene l'anno dopo)
  const firstKnown = months.findIndex((m) => m.year);
  if (firstKnown >= 0) {
    for (let i = firstKnown + 1; i < months.length; i++) if (!months[i].year) months[i].year = months[i - 1].year + (months[i].idx <= months[i - 1].idx ? 1 : 0);
    for (let i = firstKnown - 1; i >= 0; i--) if (!months[i].year) months[i].year = months[i + 1].year - (months[i].idx >= months[i + 1].idx ? 1 : 0);
  }
  // spese del viaggio già scritte una per una in un mese (stessa data e stessa cifra): non le conto due volte
  const seen = new Map();
  expenses.forEach((e) => { const k = e.date + "|" + e.amount.toFixed(2); seen.set(k, (seen.get(k) || 0) + 1); });
  for (const list of tripLists) {
    for (const e of list) {
      const k = e.date + "|" + e.amount.toFixed(2);
      if (seen.get(k)) { seen.set(k, seen.get(k) - 1); dupes++; continue; }
      expenses.push(e);
    }
  }
  if (trips.length) addCat("Viaggi");
  // "affitto" e "Affitto" sono la stessa categoria: uso il nome scritto nella tabella dei budget
  expenses.forEach((e) => { if (e.category) e.category = categories.find((c) => c.toLowerCase() === e.category.toLowerCase()) || e.category; });
  const outMonths = months.filter((m) => m.year && (m.income || Object.values(m.budgets).some((b) => b > 0)))
    .map((m) => ({ month: monthKey(m.year, m.idx), income: m.income, budgets: m.budgets }));
  return { categories, months: outMonths, expenses, trips, dupes, moved };
}

function downloadExcel(db, filename = "Spese.xlsx") {
  const wb = XLSX.utils.book_new();
  const sum = (a) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;
  const asDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const keys = [...new Set([...Object.keys(db.months), ...Object.keys(db.budgets), ...db.expenses.map((e) => e.date.slice(0, 7))])].sort();

  const summary = [["Mese", "Entrate", "Budget", "Speso", "Avanzo"]];
  const sheets = [];
  for (const k of keys) {
    const exp = db.expenses.filter((e) => e.date.startsWith(k)).sort((a, b) => a.date.localeCompare(b.date));
    const bud = db.budgets[k] || {};
    const income = db.months[k]?.income || 0;
    const budget = sum(Object.values(bud));
    const spent = sum(exp.map((e) => e.amount));
    summary.push([monthLabel(k), income, budget, spent, Math.round((budget - spent) * 100) / 100]);
    const canon = (c) => (c && db.categories.find((x) => x.name.toLowerCase() === c.toLowerCase())?.name) || c || "Senza categoria";
    const cats = [...new Set([...db.categories.map((c) => c.name), ...Object.keys(bud), ...exp.map((e) => canon(e.category))])];
    const aoa = [[`Spese · ${monthLabel(k)}`], [], ["Entrate", income], ["Budget", budget], ["Speso", spent], [],
      ["Categoria", "Budget", "Speso", "Restano"]];
    for (const c of cats) {
      const s = sum(exp.filter((e) => canon(e.category) === c).map((e) => e.amount));
      if (!s && !bud[c]) continue;
      aoa.push([c, bud[c] || 0, s, Math.round(((bud[c] || 0) - s) * 100) / 100]);
    }
    aoa.push([], ["Data", "Descrizione", "Importo", "Categoria", "Note"]);
    exp.forEach((e) => aoa.push([asDate(e.date), e.description, e.amount, e.category || "", [e.trip && "✈ " + e.trip, e.note].filter(Boolean).join(" · ")]));
    sheets.push([monthLabel(k), aoa]);
  }

  const style = (ws, widths) => { ws["!cols"] = widths.map((w) => ({ wch: w })); return ws; };
  XLSX.utils.book_append_sheet(wb, style(XLSX.utils.aoa_to_sheet(summary), [18, 12, 12, 12, 12]), "Riassunto");
  sheets.forEach(([name, aoa]) => XLSX.utils.book_append_sheet(wb, style(XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" }), [24, 34, 12, 22, 30]), name.slice(0, 31)));
  const all = [["Data", "Descrizione", "Importo", "Categoria", "Note", "Viaggio"],
    ...[...db.expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [asDate(e.date), e.description, e.amount, e.category || "", e.note || "", e.trip || ""])];
  XLSX.utils.book_append_sheet(wb, style(XLSX.utils.aoa_to_sheet(all, { cellDates: true, dateNF: "dd/mm/yyyy" }), [12, 34, 10, 22, 30, 20]), "Tutte le spese");
  XLSX.writeFile(wb, filename);
}
