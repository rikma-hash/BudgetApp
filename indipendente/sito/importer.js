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

async function parse(filename, base64) {
  const bin = atob(String(base64 || "").split(",").pop());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (bytes.length > 8_000_000) throw Object.assign(new Error("File troppo grande (max 8 MB)"), { status: 400 });
  const name = String(filename || "").toLowerCase();
  try {
    if (name.endsWith(".pdf") || bin.startsWith("%PDF-")) return toExpenses(await parsePdf(bytes));
    const head = bin.slice(0, 2000);
    if (/\.(csv|txt|tsv)$/.test(name) || head.includes(",") || head.includes(";")) return toExpenses(parseCsv(bytes));
  } catch (err) { throw Object.assign(err, { status: 400 }); }
  throw Object.assign(new Error("Formato non riconosciuto: usa un file CSV o PDF"), { status: 400 });
}

window.SpeseImport = { parse, parseAmount, parseDate, cleanDescription };
})();
