"use strict";
/* Archivio dei dati nel telefono, sincronizzato con Supabase.
   - `Store.db` contiene tutte le tabelle come elenchi di righe (stessi nomi e colonne del database).
   - Chi modifica i dati (server.js) cambia `Store.db` e poi chiama `Store.commit()`: confrontando con l'ultima
     copia nota del database calcola cosa è cambiato e lo mette nella coda `outbox`.
   - La coda parte subito se c'è rete; senza rete resta nel telefono (anche chiudendo l'app) e parte dopo.
   - Modalità "demo" (senza account): tutto resta nel browser, nessuna coda.
   Tutto è salvato in localStorage, così l'app si apre subito e funziona anche senza rete. */

const TABLES = {
  categories:      { pk: ["name"],           cols: ["name", "position"] },
  months:          { pk: ["month"],          cols: ["month", "income", "incomes", "carry", "carry_on"] },
  budgets:         { pk: ["month", "category"], cols: ["month", "category", "amount"] },
  // la chiave primaria di expenses è solo id (le altre tabelle hanno user_id + pk)
  expenses:        { pk: ["id"],             cols: ["id", "date", "description", "amount", "category", "note", "trip"], conflict: "id" },
  trips:           { pk: ["name"],           cols: ["name", "note", "position"] },
  trip_categories: { pk: ["trip", "name"],   cols: ["trip", "name", "budget", "position"] },
  subscriptions:   { pk: ["id"],             cols: ["id", "name", "amount", "day", "auto", "position"] },
  settings:        { pk: [],                 cols: ["data"] },
};
const NUMERIC = new Set(["income", "carry", "amount", "budget"]);
const STD_CATEGORIES = ["Affitto", "Spesa", "Mensa", "Lavatrici/Asciugatrice", "Abbigliamento", "Abbonamenti", "Viaggi", "Svago", "Varie"];
const K_MODE = "indip-mode", K_DB = "indip-db", K_SNAP = "indip-snap", K_OUT = "indip-outbox", K_DEMO = "indip-demo-db";

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const emptyDb = () => Object.fromEntries(Object.keys(TABLES).map((t) => [t, t === "settings" ? [{ data: {} }] : []]));
const rowKey = (t, r) => TABLES[t].pk.map((c) => r[c]).join("\u0001") || "me";
const pick = (t, r) => Object.fromEntries(TABLES[t].cols.map((c) => [c, r[c] ?? null]));
const isNetworkError = (e) => e instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(String(e?.message || e));

const Store = {
  mode: null,          // "cloud" | "demo"
  client: null,
  user: null,
  db: emptyDb(),
  snap: {},            // tabella -> {chiave: JSON della riga} = ultima versione nota del database
  outbox: [],          // modifiche da mandare: {t, kind: "upsert"|"delete", rows|keys}
  lastError: null,
  listeners: new Set(),

  on(fn) { this.listeners.add(fn); },
  emit() { this.listeners.forEach((fn) => { try { fn(); } catch {} }); },

  cloudConfigured() {
    const c = window.SPESE_CONFIG || {};
    return !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase);
  },

  /** Riprende la sessione dell'ultima volta. true = si può aprire l'app subito. */
  async start() {
    if (this.cloudConfigured()) {
      const c = window.SPESE_CONFIG;
      this.client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    }
    const mode = lsGet(K_MODE, null);
    if (mode === "demo") { this.useDemo(); return true; }
    if (mode === "cloud" && this.client) {
      const { data } = await this.client.auth.getSession();
      const user = data.session?.user || lsGet("indip-user", null);   // senza rete la sessione salvata basta per guardare
      if (user) {
        this.mode = "cloud"; this.user = { id: user.id, email: user.email };
        this.db = lsGet(K_DB, emptyDb()); this.snap = lsGet(K_SNAP, {}); this.outbox = lsGet(K_OUT, []);
        this.normalize();
        return true;
      }
    }
    return false;
  },

  useDemo() {
    this.mode = "demo";
    lsSet(K_MODE, "demo");
    this.db = lsGet(K_DEMO, null) || { ...emptyDb(), categories: STD_CATEGORIES.map((name, position) => ({ name, position })) };
    this.normalize();
    this.persist();
  },

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authMsg(error));
    this.afterAuth(data.user);
  },

  async signUp(email, password) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw new Error(authMsg(error));
    if (!data.session) return { confirm: true };
    this.afterAuth(data.user);
    return { confirm: false };
  },

  afterAuth(user) {
    const prev = lsGet("indip-user", null);
    // un altro account su questo dispositivo: via tutto quello che apparteneva al precedente
    if (prev && prev.id !== user.id) clearAccountData();
    this.mode = "cloud"; this.user = { id: user.id, email: user.email };
    lsSet(K_MODE, "cloud"); lsSet("indip-user", this.user);
    this.db = lsGet(K_DB, emptyDb()); this.snap = lsGet(K_SNAP, {}); this.outbox = lsGet(K_OUT, []);
    this.normalize();
  },

  /** Elimina l'account e tutti i suoi dati (funzione delete_my_account nel database, vedi schema.sql). */
  async deleteAccount() {
    if (this.mode !== "cloud") throw new Error("Non sei entrato con un account");
    const { error } = await this.client.rpc("delete_my_account");
    if (error) throw new Error(isNetworkError(error) ? "Niente connessione: riprova quando sei online" : /function|schema cache|not find/i.test(error.message) ? "Eliminazione non ancora attiva su questo server: chiedi a chi gestisce l'app" : error.message);
    this.outbox = [];
    await this.signOut();
  },

  async signOut() {
    if (this.mode === "cloud") await this.client.auth.signOut().catch(() => {});
    localStorage.removeItem(K_MODE);
    clearAccountData();
    this.mode = null; this.user = null; this.db = emptyDb(); this.snap = {}; this.outbox = [];
  },

  /** Numeri come numeri, liste mai nulle (dal database i numeric arrivano come stringhe). */
  normalize() {
    for (const t of Object.keys(TABLES)) {
      this.db[t] = (this.db[t] || []).map((r) => {
        const o = pick(t, r);
        for (const c of Object.keys(o)) if (NUMERIC.has(c) && o[c] != null) o[c] = +o[c];
        if (t === "months") { o.incomes = Array.isArray(o.incomes) ? o.incomes : []; o.carry ??= 0; o.carry_on = !!o.carry_on; o.income ??= 0; }
        if (t === "subscriptions") { o.day = +o.day || 1; o.auto = !!o.auto; }
        if (t === "settings") o.data = o.data && typeof o.data === "object" ? o.data : {};
        return o;
      });
    }
    if (!this.db.settings.length) this.db.settings = [{ data: {} }];
  },

  persist() {
    if (this.mode === "demo") { lsSet(K_DEMO, this.db); return; }
    lsSet(K_DB, this.db); lsSet(K_SNAP, this.snap); lsSet(K_OUT, this.outbox);
  },

  settings() { return this.db.settings[0].data; },

  /** Registra le modifiche fatte a `db`: in demo le salva, in cloud le mette in coda e prova a mandarle. */
  commit() {
    this.normalize();
    if (this.mode === "demo") { this.persist(); this.emit(); return; }
    for (const t of Object.keys(TABLES)) {
      const before = this.snap[t] || {};
      const now = {};
      const upserts = [];
      for (const r of this.db[t]) {
        const k = rowKey(t, r), json = JSON.stringify(pick(t, r));
        now[k] = json;
        if (before[k] !== json) upserts.push(pick(t, r));
      }
      const deletes = Object.keys(before).filter((k) => !(k in now)).map((k) => {
        const r = JSON.parse(before[k]);
        return Object.fromEntries(TABLES[t].pk.map((c) => [c, r[c]]));
      });
      if (deletes.length && t !== "settings") this.outbox.push({ t, kind: "delete", keys: deletes });
      if (upserts.length) this.outbox.push({ t, kind: "upsert", rows: upserts });
      this.snap[t] = now;
    }
    this.persist();
    this.emit();
    this.flushSoon();
  },

  flushSoon() { clearTimeout(this.flushTimer); this.flushTimer = setTimeout(() => this.flush(), 300); },

  pending() { return this.outbox.reduce((a, op) => a + (op.rows || op.keys).length, 0); },

  async flush() {
    if (this.mode !== "cloud" || this.flushing || !this.outbox.length) return;
    this.flushing = true;
    try {
      while (this.outbox.length) {
        const op = this.outbox[0];
        try { await this.exec(op); }
        catch (err) {
          if (isNetworkError(err)) { this.lastError = "offline"; this.emit(); setTimeout(() => this.flush(), 20000); return; }
          this.lastError = String(err.message || err);
          console.warn("modifica scartata", op, err);
          window.dispatchEvent(new CustomEvent("store-error", { detail: this.lastError }));
        }
        this.outbox.shift();
        this.persist();
      }
      this.lastError = null;
    } finally { this.flushing = false; this.emit(); }
  },

  async exec(op) {
    const sb = this.client, uid = this.user.id, pk = TABLES[op.t].pk;
    if (op.kind === "upsert") {
      const rows = op.rows.map((r) => ({ ...r, user_id: uid }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from(op.t).upsert(rows.slice(i, i + 500), { onConflict: TABLES[op.t].conflict || ["user_id", ...pk].join(",") });
        if (error) throw error;
      }
      return;
    }
    // delete: raggruppo per tutte le colonne della chiave tranne l'ultima, e l'ultima va in .in()
    const last = pk[pk.length - 1];
    const groups = new Map();
    for (const k of op.keys) {
      const head = pk.slice(0, -1).map((c) => k[c]);
      const g = JSON.stringify(head);
      if (!groups.has(g)) groups.set(g, { head, vals: [] });
      groups.get(g).vals.push(k[last]);
    }
    for (const { head, vals } of groups.values()) {
      for (let i = 0; i < vals.length; i += 200) {
        let q = sb.from(op.t).delete().eq("user_id", uid);
        pk.slice(0, -1).forEach((c, j) => (q = q.eq(c, head[j])));
        const { error } = await q.in(last, vals.slice(i, i + 200));
        if (error) throw error;
      }
    }
  },

  /** Scarica tutto dal database (solo se non ci sono modifiche in coda). true = qualcosa è cambiato. */
  async refresh() {
    if (this.mode !== "cloud") return false;
    await this.flush();
    if (this.outbox.length) return false;
    const sb = this.client;
    const all = async (t) => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(t).select(TABLES[t].cols.join(",")).range(from, from + 999);
        if (error) throw error;
        out.push(...data);
        if (data.length < 1000) return out;
      }
    };
    const res = await Promise.all(Object.keys(TABLES).map(all));
    if (this.outbox.length) return false;   // nel frattempo hai modificato qualcosa: riprovo dopo
    const db = Object.fromEntries(Object.keys(TABLES).map((t, i) => [t, res[i]]));
    const fresh = !db.categories.length && !db.expenses.length && !db.months.length;
    const before = JSON.stringify(this.db);
    this.db = db;
    this.normalize();
    this.snap = Object.fromEntries(Object.keys(TABLES).map((t) => [t, Object.fromEntries(this.db[t].map((r) => [rowKey(t, r), JSON.stringify(pick(t, r))]))]));
    if (fresh) {   // account nuovo: categorie standard
      this.db.categories = STD_CATEGORIES.map((name, position) => ({ name, position }));
      this.commit();
    } else this.persist();
    const changed = JSON.stringify(this.db) !== before;
    if (changed) this.emit();
    return changed;
  },

  /** Cancella tutti i dati dell'account (o della prova). */
  wipe() {
    for (const t of Object.keys(TABLES)) this.db[t] = t === "settings" ? [{ data: {} }] : [];
    this.db.categories = STD_CATEGORIES.map((name, position) => ({ name, position }));
    this.commit();
  },
};

/** Toglie dal dispositivo i dati dell'account: copia del database, coda, utente e le copie salvate dall'app (api:…). */
function clearAccountData() {
  for (const k of [K_DB, K_SNAP, K_OUT, "indip-user", "api-index", "queue", "ops"]) localStorage.removeItem(k);
  Object.keys(localStorage).filter((k) => k.startsWith("api:")).forEach((k) => localStorage.removeItem(k));
}

function authMsg(err) {
  const m = String(err.message || err);
  if (/Invalid login/i.test(m)) return "Email o password sbagliate";
  if (/Email not confirmed/i.test(m)) return "Prima conferma l'email: apri il link che ti è arrivato";
  if (/already registered/i.test(m)) return "Questa email ha già un account: premi Entra";
  if (/Password should be/i.test(m)) return "La password deve avere almeno 6 caratteri";
  if (/rate limit/i.test(m)) return "Troppi tentativi: riprova tra qualche minuto";
  if (isNetworkError(err)) return "Niente connessione: riprova quando sei online";
  return m;
}

window.addEventListener("online", () => Store.flush());
