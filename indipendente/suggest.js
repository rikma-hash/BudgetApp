"use strict";
/* Suggerimento della categoria, tutto nel telefono (senza server e senza IA):
   1. le tue spese passate con la stessa descrizione (o quasi uguale);
   2. le parole chiave di keywords.json (Lidl → Spesa, Bolt → Trasporti…).
   Una categoria suggerita che non hai ancora viene proposta come "nuova". */

let KEYWORDS = {};
fetch("keywords.json").then((r) => r.json()).then((k) => (KEYWORDS = k)).catch(() => {});

function normalize(text) {
  return String(text || "").toLowerCase().trim()
    .replace(/\(.*?\)/g, " ")                    // "Penny (pollo, tonno)" → "penny"
    .replace(/[^\p{L}\p{N}& ]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

/** Simile a token_set_ratio: 100 se le parole di una descrizione stanno tutte nell'altra. */
function similarity(a, b) {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter ? (100 * inter) / Math.min(A.size, B.size) : 0;
}

/**
 * @param {string} description
 * @param {string[]} known  categorie che hai
 * @param {{description:string, category:string, date:string}[]} history  le tue spese
 * @returns {{category:string, score:number, source:string, isNew:boolean}[]}  al massimo 3, la migliore prima
 */
function suggestCategory(description, known, history) {
  const key = normalize(description);
  if (!key) return [];
  const canon = (c) => known.find((k) => k.toLowerCase() === String(c || "").toLowerCase());
  const scores = new Map();
  const add = (cat, score, source) => {
    const name = canon(cat) || cat;
    const cur = scores.get(name.toLowerCase());
    if (!cur || score > cur.score) scores.set(name.toLowerCase(), { category: name, score, source, isNew: !canon(cat) });
  };

  // 1. storico: stessa descrizione (conta quante volte e quale è la più recente) o simile
  const exact = new Map(), near = new Map();
  let latest = null;
  for (const t of history) {
    const cat = canon(t.category); if (!cat) continue;
    const k = normalize(t.description);
    if (k === key) {
      exact.set(cat, (exact.get(cat) || 0) + 1);
      if (!latest || t.date >= latest.date) latest = { cat, date: t.date };
    } else if (k.length > 2) {
      const sim = similarity(key, k);
      if (sim >= 80) near.set(cat, Math.max(near.get(cat) || 0, sim));
    }
  }
  const total = [...exact.values()].reduce((a, b) => a + b, 0);
  exact.forEach((n, cat) => add(cat, 0.6 + 0.35 * n / total + (latest?.cat === cat ? 0.05 : 0), "storico"));
  near.forEach((sim, cat) => add(cat, (sim / 100) * 0.7, "storico"));

  // 2. parole chiave (le parole lunghe valgono anche dentro un'altra parola)
  const padded = ` ${key} `;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    for (const raw of words) {
      const w = raw.toLowerCase().trim();
      if (padded.includes(` ${w} `) || (w.length > 4 && key.includes(w))) {
        add(cat, (w.length > 3 ? 0.75 : 0.6) - (canon(cat) ? 0 : 0.05), "parole chiave");
      }
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 3);
}
