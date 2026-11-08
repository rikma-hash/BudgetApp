"use strict";
/* Lettura di estratti conto / movimenti carta (CSV o PDF), tutta nel telefono: è server/importer.py tradotto.
   SpeseImport.parse(nome, base64) → {items: [{date, description, original, amount}], income: n. entrate} */

(() => {
const DATE_COLS = ["data operazione", "data contabile", "data", "buchungstag", "buchungsdatum", "datum", "started date",
  "completed date", "date", "transaction date", "booking date", "data valuta", "valuta", "valutadatum"];
const DESC_COLS = ["descrizione operazione", "descrizione", "causale", "dettagli", "esercente", "controparte", "beneficiario",
  "beguenstigter/zahlungspflichtiger", "begünstigter/zahlungspflichtiger", "empfänger", "empfaenger",
  "auftraggeber/empfänger", "name", "payee", "merchant", "description", "verwendungszweck", "beschreibung",
  "buchungstext", "reference", "note", "notes"];
const AMOUNT_COLS = ["importo (eur)", "importo", "amount (eur)", "amount", "betrag (eur)", "betrag", "umsatz", "valore"];
const OUT_COLS = ["uscite", "addebiti", "addebito", "dare", "soll", "debit", "importo addebitato", "ausgang"];
const IN_COLS = ["entrate", "accrediti", "accredito", "avere", "haben", "credit", "eingang"];
const INCOME_WORDS = ["accredito", "stipendio", "bonifico a vostro favore", "bonifico a tuo favore", "ricarica da", "rimborso",
  "gutschrift", "eingang", "lohn", "gehalt", "refund", "top-up", "top up", "storno"];
const DATE_RE = String.raw`(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})`;
const AMOUNT_RE = String.raw`([-+−]?\s?€?\s?\d{1,3}(?:[.\s']\d{3})*(?:[.,]\d{2})\s?(?:€|EUR)?\s?[-+]?)`;
const pad = (n) => String(n).padStart(2, "0");

function parseAmount(t) {
  if (t == null) return null;
  let s = String(t).trim().replace(/−/g, "-").replace(/€|EUR/g, "").replace(/ /g, " ").trim();
  if (!s) return null;
  const neg = s.startsWith("-") || s.endsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  s = s.replace(/^[-+() ]+|[-+() ]+$/g, "").replace(/ /g, "").replace(/'/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  const v = parseFloat(s);
  return isNaN(v) ? null : neg ? -v : v;
}
function parseDate(t, yearHint) {
  const s = String(t || "").trim();
  let y, mo, d, m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else {
    m = s.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = m[3] ? +m[3] : (yearHint || new Date().getFullYear());
    if (y < 100) y += 2000;
  }
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

const NOISE = new RegExp(String.raw`\b(pagamento|pagam\.?|pag\.?|pos|carta|card|n\.|nr\.?|num\.?|del|ore|op\.?|operazione|transazione|acquisto|addebito|sdd|sepa|lastschrift|kartenzahlung|girocard|visa|mastercard|maestro|debit|contactless|apple ?pay|google ?pay|eur|euro|presso|c/o|da|il|in data|data|valuta|riferimento|rif\.?)\b`, "gi");
const title = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
function cleanDescription(t) {
  let s = String(t || "").replace(/\s+/g, " ").trim();
  const m = s.match(/\bpresso\s+(.+)/i) || s.match(/\bc\/o\s+(.+)/i);
  if (m) s = m[1];
  s = s.replace(/\*+\d*|x{3,}\d*/gi, " ").replace(new RegExp(DATE_RE, "g"), " ").replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    .replace(new RegExp(AMOUNT_RE, "g"), " ").replace(/\b[\w-]*\d{4,}[\w-]*\b/g, " ").replace(NOISE, " ")
    .replace(/[|;/_]+/g, " ").replace(/\s+/g, " ").replace(/^[\s\-.,:]+|[\s\-.,:]+$/g, "");
  if (!s) s = String(t || "").replace(/\s+/g, " ").trim().slice(0, 40);
  s = s.split(" ").slice(0, 5).join(" ");
  if (s === s.toUpperCase() || s === s.toLowerCase()) s = title(s);
  return s.slice(0, 60);
}

function decode(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}
const find = (headers, names) => {
  for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; }
  for (const n of names) { const i = headers.findIndex((h) => h.includes(n)); if (i >= 0) return i; }
  return null;
};
function splitCsv(line, delim) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}
function parseCsv(bytes) {
  const lines = decode(bytes).split(/\r?\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 30).join("\n");
  const delim = [";", ",", "\t", "|"].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  const rows = lines.map((l) => splitCsv(l, delim));
  let headI = -1;
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const h = rows[i].map((c) => c.trim().toLowerCase());
    if (find(h, DATE_COLS) != null && (find(h, AMOUNT_COLS) != null || find(h, OUT_COLS) != null)) { headI = i; break; }
  }
  if (headI < 0) throw new Error("Non trovo le colonne Data e Importo in questo file CSV");
  const headers = rows[headI].map((c) => c.trim().toLowerCase());
  const cDate = find(headers, DATE_COLS), cAmount = find(headers, AMOUNT_COLS), cOut = find(headers, OUT_COLS), cIn = find(headers, IN_COLS);
  const descCols = [];
  for (const n of DESC_COLS) {
    const i = find(headers, [n]);
    if (i != null && !descCols.includes(i) && ![cDate, cAmount, cOut, cIn].includes(i)) descCols.push(i);
    if (descCols.length === 2) break;
  }
  const raw = [];
  for (const r of rows.slice(headI + 1)) {
    if (r.length <= cDate) continue;
    const day = parseDate(r[cDate]);
    if (!day) continue;
    let amount;
    if (cOut != null || cIn != null) {
      const out = cOut != null && cOut < r.length ? parseAmount(r[cOut]) : null;
      const inc = cIn != null && cIn < r.length ? parseAmount(r[cIn]) : null;
      if (out) amount = -Math.abs(out); else if (inc) amount = Math.abs(inc);
      else if (cAmount != null && cAmount < r.length) amount = parseAmount(r[cAmount]); else continue;
    } else amount = cAmount < r.length ? parseAmount(r[cAmount]) : null;
    if (!amount) continue;
    const parts = descCols.filter((i) => i < r.length && r[i].trim()).map((i) => r[i].trim());
    raw.push({ date: day, original: parts.join(" · ") || "Spesa", name: parts[0] || "Spesa", signed: amount });
  }
  return raw;
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = ok; s.onerror = () => ko(new Error("Non riesco a caricare il lettore PDF: serve la connessione"));
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}
/** Testo del PDF riga per riga, con gli spazi che rispettano le colonne (come extract_text "layout"). */
async function pdfText(bytes) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items.filter((i) => i.str.trim());
    const lines = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push(it);
    }
    for (const y of [...lines.keys()].sort((a, b) => b - a)) {
      let line = "";
      for (const it of lines.get(y).sort((a, b) => a.transform[4] - b.transform[4])) {
        const col = Math.round(it.transform[4] / 4.5);
        line = line.length < col ? line + " ".repeat(col - line.length) : line + (line && !line.endsWith(" ") ? " " : "");
        line += it.str;
      }
      out.push(line);
    }
  }
  return out.join("\n");
}
async function parsePdf(bytes) {
  const textAll = await pdfText(bytes);
  if (textAll.trim().length < 20) throw new Error("Questo PDF non contiene testo (forse è una foto/scansione): scarica il CSV o un PDF dall'app");
  const ym = textAll.match(/\b(20\d{2})\b/);
  const year = ym ? +ym[1] : null;
  const lineRe = new RegExp(String.raw`^\s*${DATE_RE}(?:\s+${DATE_RE})?\s+(.+?)\s+${AMOUNT_RE}(?:\s+${AMOUNT_RE})?\s*$`);
  const shortRe = new RegExp(String.raw`^\s*(\d{1,2}[./]\d{1,2})\.?\s+(.+?)\s+${AMOUNT_RE}\s*$`);
  const outHead = /\b(uscite|addebiti|dare|soll|debit|ausgang)\b/i, inHead = /\b(entrate|accrediti|avere|haben|credit|eingang)\b/i;
  const raw = [];
  let last = null, cols = null;
  for (const line of textAll.split("\n")) {
    const mo = line.match(outHead), mi = line.match(inHead);
    if (mo && mi) { cols = [mo.index + mo[0].length, mi.index + mi[0].length]; continue; }
    let day, desc, a1, a2;
    const m = line.match(lineRe);
    if (m) { day = parseDate(m[1], year); desc = m[3]; a1 = m[4]; a2 = m[5]; }
    else {
      const m2 = line.match(shortRe);
      if (m2 && parseDate(m2[1], year)) { day = parseDate(m2[1], year); desc = m2[2]; a1 = m2[3]; a2 = null; }
      else {
        if (last && line.trim() && last.original.length < 120 && !new RegExp(DATE_RE).test(line)) {
          const extra = line.replace(/\s+/g, " ").trim();
          if (extra && !/^[\d\s.,€-]+$/.test(extra)) last.original += " " + extra;
        }
        continue;
      }
    }
    if (!day) continue;
    const amount = parseAmount(a1);
    if (amount == null) continue;
    desc = desc.replace(/\s{2,}/g, " ").trim();
    if (/saldo|totale|riporto|kontostand|balance/i.test(desc)) continue;
    let signed = amount;
    const s1 = String(a1).trim();
    const end = a2 == null ? line.trimEnd().lastIndexOf(s1) + s1.length : null;
    if (cols && end != null && end > 0) signed = Math.abs(end - cols[0]) <= Math.abs(end - cols[1]) ? -Math.abs(amount) : Math.abs(amount);
    else if (!/^[-−+]/.test(s1) && !/[-+]$/.test(s1)) signed = INCOME_WORDS.some((w) => desc.toLowerCase().includes(w)) ? Math.abs(amount) : -Math.abs(amount);
    else if (s1.startsWith("+") || s1.endsWith("+")) signed = Math.abs(amount);
    last = { date: day, original: desc, signed };
    raw.push(last);
  }
  if (!raw.length) throw new Error("Non ho trovato movimenti in questo PDF: prova con il file CSV");
  return raw;
}

function toExpenses(raw) {
  if (!raw.length) return { items: [], income: 0 };
  const allPositiveAreSpend = !raw.some((r) => r.signed < 0);
  const out = [];
  let income = 0;
  for (const r of raw) {
    const spend = r.signed < 0 || (allPositiveAreSpend && !INCOME_WORDS.some((w) => r.original.toLowerCase().includes(w)));
    if (!spend) { income++; continue; }
    out.push({ date: r.date, original: r.original, description: cleanDescription(r.name || r.original), amount: Math.round(Math.abs(r.signed) * 100) / 100 });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { items: out, income };
}

// ---------- fogli di calcolo fatti a mano (Excel, Numbers, ODS/Google Fogli, CSV senza date) · come parse_table in importer.py ----------
const MONTH_WORDS = { 1: ["gennaio", "january", "januar", "jan", "gen"], 2: ["febbraio", "february", "februar", "feb"],
  3: ["marzo", "march", "märz", "maerz", "mar"], 4: ["aprile", "april", "apr"], 5: ["maggio", "may", "mai", "mag"],
  6: ["giugno", "june", "juni", "jun", "giu"], 7: ["luglio", "july", "juli", "jul", "lug"], 8: ["agosto", "august", "aug", "ago"],
  9: ["settembre", "september", "sept", "sep", "set"], 10: ["ottobre", "october", "oktober", "oct", "okt", "ott"],
  11: ["novembre", "november", "nov"], 12: ["dicembre", "december", "dezember", "dec", "dez", "dic"] };
const T_DATE = DATE_COLS.concat(["giorno", "quando", "tag", "day", "when"]);
const T_AMOUNT = AMOUNT_COLS.concat(["totale", "total", "tot", "costo", "prezzo", "price", "cost", "kosten", "preis", "summe", "spesa (€)", "€", "eur", "euro", "quanto", "cifra"]);
const T_CAT = ["categoria", "categorie", "category", "kategorie", "tipo", "type", "gruppo", "genere"];
const T_DESC = ["descrizione", "description", "voce", "cosa", "nome", "dettaglio", "dettagli", "articolo", "oggetto", "item", "what", "beschreibung", "bezeichnung", "was", "spesa", "causale", "note", "notes"];
const T_IN = IN_COLS.concat(["entrata", "income", "einnahmen", "einnahme"]);
const SUB_PREFIX = /^\s*(di cui|davon|of which|incl\.?|including)\s+/i;
const TOTAL_WORDS = /^\s*(totale|totali|total|totals|tot\.?|somma|summe|gesamt|subtotale|subtotal)\b/i;
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function monthFromName(name) {
  const low = String(name || "").toLowerCase(), now = new Date();
  let found = null;
  for (const [m, words] of Object.entries(MONTH_WORDS)) {
    if (!found && words.some((w) => new RegExp(`(?<![a-zà-ü])${w}(?![a-zà-ü])`).test(low))) found = +m;
  }
  if (!found) return null;
  const y = low.match(/\b(20\d{2})\b/) || low.match(/(?<!\d)'?(\d{2})\b/);
  let year = y ? +y[1] : (found <= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() - 1);
  if (year < 100) year += 2000;
  return [year, found];
}
const cellText = (v) => (v == null ? "" : v instanceof Date ? isoOf(v) : typeof v === "number" && Number.isInteger(v) ? String(v) : String(v).trim());
function num(v) {
  if (v == null || typeof v === "boolean" || v instanceof Date) return [null, ""];
  if (typeof v === "number") return [v, ""];
  const s = String(v).trim();
  const a = parseAmount(s);
  if (a != null) return [a, ""];
  const m = s.match(/^\s*([-−]?\s?€?\s?\d[\d.,']*)\s*€?\s*(.*)$/s);
  if (m) { const x = parseAmount(m[1]); if (x != null) return [x, m[2].trim().replace(/^[\s()[\]\-–:·]+|[\s()[\]\-–:·]+$/g, "")]; }
  return [null, ""];
}
const asDate = (v) => (v instanceof Date ? isoOf(new Date(v.getTime() + 12 * 36e5)) : typeof v === "string" && /\d/.test(v) ? parseDate(v) : null);
function short(desc) {
  const d = desc.replace(/\s+/g, " ").trim();
  if (d.length <= 40) return d;
  const cut = d.split(/[,(;:]/)[0].trim();
  return cut.length >= 3 && cut.length <= 40 ? cut : d.split(" ").slice(0, 5).join(" ").slice(0, 40);
}

function parseTable(name, rows0) {
  let rows = rows0.slice(0, 5000).map((r) => (r || []).slice(0, 40));
  const width = Math.max(0, ...rows.map((r) => r.length));
  rows = rows.map((r) => r.concat(Array(width - r.length).fill(null)));
  const isText = (v) => typeof v === "string" && v.trim() && num(v)[0] == null && !asDate(v);
  const numericBelow = (i, j) => rows.slice(i + 1, i + 61).filter((r) => num(r[j])[0] != null).length;
  let head = null;
  for (let i = 0; i < Math.min(30, rows.length) && head == null; i++) {
    const texts = rows[i].map((v, j) => (isText(v) ? j : -1)).filter((j) => j >= 0);
    if (texts.length >= 2 && texts.some((j) => numericBelow(i, j))) head = i;
  }
  if (head == null) return { items: [], income: 0 };
  const headers = rows[head].map((v) => cellText(v).toLowerCase()), data = rows.slice(head + 1);
  const used = new Set();
  const fnd = (names) => { const j = find(headers.map((h, k) => (used.has(k) ? "" : h)), names); return j != null && headers[j] ? j : null; };
  let cDate = fnd(T_DATE);
  if (cDate == null) {
    let best = null, bestN = 0;
    for (let j = 0; j < width; j++) { const n = data.filter((r) => asDate(r[j])).length; if (n > bestN) { best = j; bestN = n; } }
    if (best != null && bestN >= Math.max(2, Math.floor(data.length / 3))) cDate = best;
  }
  used.add(cDate);
  const cAmount = fnd(T_AMOUNT); used.add(cAmount);
  const cCat = fnd(T_CAT); used.add(cCat);
  const cIn = fnd(T_IN); used.add(cIn);
  let cDesc = fnd(T_DESC);
  if (cDesc == null) {
    let bestN = -1;
    for (let j = 0; j < width; j++) if (!used.has(j)) { const n = data.filter((r) => isText(r[j])).length; if (n > bestN) { cDesc = j; bestN = n; } }
  }
  used.add(cDesc);
  const matrix = [...Array(width).keys()].filter((j) => !used.has(j) && headers[j] && numericBelow(head, j));
  const mainCols = matrix.filter((j) => !SUB_PREFIX.test(headers[j])), subCols = matrix.filter((j) => SUB_PREFIX.test(headers[j]));
  if (cAmount == null && !mainCols.length) return { items: [], income: 0 };
  const ym = monthFromName(name), now = new Date();
  const items = [];
  let income = 0;
  for (const r of data) {
    const desc = cDesc != null ? cellText(r[cDesc]) : "";
    if (!desc || TOTAL_WORDS.test(desc) || parseAmount(desc) != null) continue;
    const notes = [];
    let amount = null;
    if (cAmount != null) { const [a, extra] = num(r[cAmount]); amount = a; if (extra) notes.push(extra); }
    let cat = null, sub = null, total = 0;
    for (const j of mainCols) { const [v, extra] = num(r[j]); if (v) { total += v; cat ||= cellText(rows[head][j]); if (extra && !notes.includes(extra)) notes.push(extra); } }
    for (const j of subCols) { const [v, extra] = num(r[j]); if (v) { sub ||= cellText(rows[head][j]).replace(SUB_PREFIX, "").trim(); if (extra && !notes.includes(extra)) notes.push(extra); } }
    if (amount == null) amount = total || null;
    if (cCat != null && cellText(r[cCat])) cat = cellText(r[cCat]);
    if (cIn != null && !amount && num(r[cIn])[0]) { income++; continue; }
    if (!amount) continue;
    if (amount < 0) { income++; continue; }
    const day = cDate != null ? asDate(r[cDate]) : null;
    const item = { original: desc, description: short(desc), amount: Math.round(amount * 100) / 100, note: notes.join(" · ") || null, source_category: sub || cat, src: name };
    if (day) item.date = day;
    else { const [y, m] = ym || [now.getFullYear(), now.getMonth() + 1]; Object.assign(item, { date: `${y}-${pad(m)}-01`, nodate: true, month_guess: !!ym }); }
    items.push(item);
  }
  return { items, income };
}
function tablesResult(tables, months) {
  let items = [], income = 0;
  const sources = [];
  for (const [name, rows] of tables) {
    const res = parseTable(name, rows);
    if (!res.items.length) continue;
    const override = (months || {})[name];
    if (override) res.items.forEach((it) => { if (it.nodate) it.date = `${override}-01`; });
    const nod = res.items.filter((it) => it.nodate);
    if (nod.length) sources.push({ src: name, month: nod[0].date.slice(0, 7), guess: nod[0].month_guess, count: nod.length });
    items = items.concat(res.items);
    income += res.income;
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { items, income, sources, kind: "table" };
}
function workbookTables(bytes) {
  if (!window.XLSX) throw new Error("Sto ancora caricando: riprova tra un attimo");
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  return wb.SheetNames.filter((n) => !(wb.Workbook?.Sheets || []).find((s) => s.name === n && s.Hidden))
    .map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true })]);
}
function parseOfx(text) {
  const raw = [];
  for (let block of text.split(/<STMTTRN>/i).slice(1)) {
    block = block.split(/<\/STMTTRN>/i)[0];
    const get = (tag) => ((block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i")) || [])[1] || "").trim();
    const d = get("DTPOSTED") || get("DTUSER"), amount = parseAmount(get("TRNAMT").replace(",", "."));
    if (!/^\d{8}/.test(d) || amount == null) continue;
    const name = get("NAME"), memo = get("MEMO");
    raw.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, original: [name, memo].filter(Boolean).join(" · ") || "Spesa", name: name || memo || "Spesa", signed: amount });
  }
  if (!raw.length) throw new Error("Non ho trovato movimenti in questo file OFX");
  return raw;
}
function parseQif(text) {
  const recs = [];
  let cur = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("!")) continue;
    if (line.startsWith("^")) { if (Object.keys(cur).length) recs.push(cur); cur = {}; continue; }
    if (!(line[0] in cur)) cur[line[0]] = line.slice(1).trim();
  }
  if (Object.keys(cur).length) recs.push(cur);
  const parts = recs.map((r) => (r.D || "").match(/\d+/g) || []);
  const us = parts.some((p) => p.length >= 2 && +p[1] > 12) && !parts.some((p) => p.length >= 2 && +p[0] > 12);
  const raw = [];
  recs.forEach((r, k) => {
    const p = parts[k];
    if (p.length < 3 || !(r.T || r.U)) return;
    let y, month, day;
    if (p[0].length === 4) [y, month, day] = [+p[0], +p[1], +p[2]];
    else { y = +p[2]; [day, month] = us ? [+p[1], +p[0]] : [+p[0], +p[1]]; }
    if (y < 100) y += 2000;
    const date = parseDate(`${y}-${pad(month)}-${pad(day)}`), amount = parseAmount(r.T || r.U);
    if (!date || amount == null) return;
    const name = r.P || "", memo = r.M || "";
    raw.push({ date, original: [name, memo].filter(Boolean).join(" · ") || "Spesa", name: name || memo || "Spesa", signed: amount });
  });
  if (!raw.length) throw new Error("Non ho trovato movimenti in questo file QIF");
  return raw;
}

async function parse(filename, base64, months = null) {
  const bin = atob(String(base64 || "").split(",").pop());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (bytes.length > 8_000_000) throw Object.assign(new Error("File troppo grande (max 8 MB)"), { status: 400 });
  const name = String(filename || "").toLowerCase();
  try {
    if (name.endsWith(".pdf") || bin.startsWith("%PDF-")) return toExpenses(await parsePdf(bytes));
    // Excel (anche .xls), Numbers, ODS: tutti con SheetJS
    if (bin.startsWith("PK") || bin.startsWith("\xd0\xcf\x11\xe0") || /\.(xlsx|xlsm|xls|ods|numbers)$/.test(name)) {
      return tablesResult(workbookTables(bytes), months);
    }
    const text = decode(bytes), head = text.slice(0, 3000);
    if (/<OFX>|OFXHEADER/i.test(head) || name.endsWith(".ofx")) return toExpenses(parseOfx(text));
    if (text.trimStart().startsWith("!Type") || name.endsWith(".qif")) return toExpenses(parseQif(text));
    if (/\.(csv|txt|tsv)$/.test(name) || /[,;\t]/.test(head)) {
      try { return toExpenses(parseCsv(bytes)); }
      catch (err) {
        // CSV fatto a mano: righe di testo (non SheetJS, che leggerebbe "12,50" come 1250)
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        const sample = lines.slice(0, 30).join("\n");
        const delim = [";", ",", "\t", "|"].reduce((a, d) => (sample.split(d).length > sample.split(a).length ? d : a), ";");
        const rows = lines.map((l) => splitCsv(l, delim).map((c) => (c.trim() ? c : null)));
        const res = tablesResult([[filename.replace(/\.[^.]+$/, ""), rows]], months);
        if (res.items.length) return res;
        throw new Error("Non trovo le colonne con descrizione e importo in questo file CSV");
      }
    }
  } catch (err) { throw Object.assign(err, { status: 400 }); }
  throw Object.assign(new Error("Formato non riconosciuto: usa Excel, Numbers, CSV, PDF, OFX o QIF"), { status: 400 });
}

window.SpeseImport = { parse, parseAmount, parseDate, cleanDescription };
})();
