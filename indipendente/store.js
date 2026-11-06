"use strict";
/* Dove stanno i dati. Due modi con le stesse funzioni:
   - "demo": tutto nel browser di questo dispositivo (localStorage), senza account;
   - "cloud": Supabase (database online con login), uguale su iPhone e Mac, funziona a Mac spento.
   L'app tiene in memoria una copia completa (`db`) e la aggiorna dopo ogni modifica riuscita;
   la copia viene salvata anche nel dispositivo, così all'apertura si vede subito e si può guardare senza rete. */

const DEMO_KEY = "indip-demo-db";
const CACHE_KEY = "indip-cache";
const STD_CATEGORIES = ["Affitto", "Spesa", "Mensa", "Lavatrici/Asciugatrice", "Abbigliamento", "Abbonamenti", "Viaggi", "Svago", "Varie"];

const emptyDb = () => ({ categories: [], months: {}, budgets: {}, expenses: [] });
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const Store = {
  mode: null,      // "demo" | "cloud"
  client: null,    // client Supabase
  user: null,      // {id, email} in modalità cloud
  db: emptyDb(),

  cloudConfigured() {
    const c = window.SPESE_CONFIG || {};
    return !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase);
  },

  /** Avvio: riprende la modalità scelta l'ultima volta. Restituisce true se c'è già una sessione pronta. */
  async start() {
    const mode = lsGet("indip-mode", null);
    if (this.cloudConfigured()) {
      const c = window.SPESE_CONFIG;
      this.client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    }
    if (mode === "demo") { this.mode = "demo"; this.db = lsGet(DEMO_KEY, emptyDb()); return true; }
    if (mode === "cloud" && this.client) {
      const { data } = await this.client.auth.getSession();
      if (data.session) { this.mode = "cloud"; this.user = data.session.user; this.db = lsGet(CACHE_KEY, emptyDb()); return true; }
    }
    return false;
  },

  startDemo() {
    this.mode = "demo";
    lsSet("indip-mode", "demo");
    this.db = lsGet(DEMO_KEY, null) || { ...emptyDb(), categories: STD_CATEGORIES.map((name, position) => ({ name, position })) };
    this.persist();
  },

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authMsg(error));
    this.mode = "cloud"; this.user = data.user; lsSet("indip-mode", "cloud");
  },

  async signUp(email, password) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw new Error(authMsg(error));
    if (!data.session) return { confirm: true };   // Supabase chiede di confermare l'email
    this.mode = "cloud"; this.user = data.user; lsSet("indip-mode", "cloud");
    return { confirm: false };
  },

  async signOut() {
    if (this.mode === "cloud") await this.client.auth.signOut().catch(() => {});
    localStorage.removeItem("indip-mode");
    localStorage.removeItem(CACHE_KEY);
    this.mode = null; this.user = null; this.db = emptyDb();
  },

  persist() { lsSet(this.mode === "demo" ? DEMO_KEY : CACHE_KEY, this.db); },

  /** Ricarica tutto dal database (solo cloud; in demo i dati sono già qui). */
  async refresh() {
    if (this.mode !== "cloud") return;
    const sb = this.client;
    const all = async (table, order) => {
      const out = [];
      for (let from = 0; ; from += 1000) {     // Supabase restituisce al massimo 1000 righe per volta
        const { data, error } = await sb.from(table).select("*").order(order).range(from, from + 999);
        if (error) throw new Error(error.message);
        out.push(...data);
        if (data.length < 1000) return out;
      }
    };
    const [cats, months, budgets, expenses] = await Promise.all([
      all("categories", "position"), all("months", "month"), all("budgets", "month"), all("expenses", "date")]);
    const db = emptyDb();
    db.categories = cats.map((c) => ({ name: c.name, position: c.position }));
    months.forEach((m) => (db.months[m.month] = { income: +m.income }));
    budgets.forEach((b) => ((db.budgets[b.month] ||= {})[b.category] = +b.amount));
    db.expenses = expenses.map(rowToExpense);
    if (!db.categories.length && !db.expenses.length) {   // account nuovo: categorie standard
      db.categories = STD_CATEGORIES.map((name, position) => ({ name, position }));
      await this.q(sb.from("categories").insert(db.categories));
    }
    this.db = db;
    this.persist();
  },

  async q(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data;
  },

  // ---------- spese ----------
  async addExpense(e) {
    const row = cleanExpense(e);
    if (this.mode === "cloud") {
      const [saved] = await this.q(this.client.from("expenses").insert(row).select());
      this.db.expenses.push(rowToExpense(saved));
    } else this.db.expenses.push({ id: newId(), ...row });
    this.persist();
  },

  async updateExpense(id, e) {
    const row = cleanExpense(e);
    if (this.mode === "cloud") await this.q(this.client.from("expenses").update(row).eq("id", id));
    const i = this.db.expenses.findIndex((x) => x.id === id);
    if (i >= 0) this.db.expenses[i] = { ...this.db.expenses[i], ...row };
    this.persist();
  },

  async deleteExpense(id) {
    if (this.mode === "cloud") await this.q(this.client.from("expenses").delete().eq("id", id));
    this.db.expenses = this.db.expenses.filter((x) => x.id !== id);
    this.persist();
  },

  // ---------- categorie ----------
  async addCategory(name) {
    name = String(name || "").replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Scrivi un nome per la categoria");
    const have = this.db.categories.find((c) => sameName(c.name, name));
    if (have) return have.name;
    const row = { name, position: this.db.categories.length };
    if (this.mode === "cloud") await this.q(this.client.from("categories").insert(row));
    this.db.categories.push(row);
    this.persist();
    return name;
  },

  async renameCategory(from, to) {
    to = String(to || "").replace(/\s+/g, " ").trim();
    if (!to || sameName(from, to) && from === to) return;
    if (!sameName(from, to) && this.db.categories.some((c) => sameName(c.name, to))) throw new Error(`La categoria ${to} c'è già`);
    if (this.mode === "cloud") {
      const sb = this.client;
      await this.q(sb.from("categories").update({ name: to }).eq("name", from));
      await this.q(sb.from("budgets").update({ category: to }).eq("category", from));
      await this.q(sb.from("expenses").update({ category: to }).eq("category", from));
    }
    this.db.categories.forEach((c) => { if (c.name === from) c.name = to; });
    Object.values(this.db.budgets).forEach((b) => { if (from in b) { b[to] = b[from]; delete b[from]; } });
    this.db.expenses.forEach((x) => { if (x.category === from) x.category = to; });
    this.persist();
  },

  /** Elimina una categoria; le sue spese vanno in `moveTo` (o restano senza categoria). */
  async deleteCategory(name, moveTo) {
    if (this.mode === "cloud") {
      const sb = this.client;
      await this.q(sb.from("expenses").update({ category: moveTo || null }).eq("category", name));
      await this.q(sb.from("budgets").delete().eq("category", name));
      await this.q(sb.from("categories").delete().eq("name", name));
    }
    this.db.expenses.forEach((x) => { if (x.category === name) x.category = moveTo || null; });
    Object.values(this.db.budgets).forEach((b) => delete b[name]);
    this.db.categories = this.db.categories.filter((c) => c.name !== name);
    this.persist();
  },

  // ---------- mesi: entrate e budget ----------
  async setIncome(month, income) {
    income = r2(income);
    if (this.mode === "cloud") await this.q(this.client.from("months").upsert({ month, income }));
    this.db.months[month] = { ...(this.db.months[month] || {}), income };
    this.persist();
  },

  async setBudgets(month, budgets) {
    const rows = Object.entries(budgets).map(([category, amount]) => ({ month, category, amount: r2(amount) }));
    if (!rows.length) return;
    if (this.mode === "cloud") await this.q(this.client.from("budgets").upsert(rows));
    const b = (this.db.budgets[month] ||= {});
    rows.forEach((r) => (b[r.category] = r.amount));
    this.persist();
  },

  // ---------- importazione ----------
  /** Aggiunge tutto quello che arriva dal file Excel. `replace` = prima cancella i dati che ci sono. */
  async importAll(data, replace) {
    if (this.mode === "cloud") {
      const sb = this.client;
      if (replace) {
        for (const t of ["expenses", "budgets", "months", "categories"]) await this.q(sb.from(t).delete().eq("user_id", this.user.id));
      }
      const cats = data.categories.filter((n) => replace || !this.db.categories.some((c) => sameName(c.name, n)))
        .map((name, i) => ({ name, position: (replace ? 0 : this.db.categories.length) + i }));
      if (cats.length) await this.q(sb.from("categories").upsert(cats));
      const months = data.months.map((m) => ({ month: m.month, income: r2(m.income) }));
      if (months.length) await this.q(sb.from("months").upsert(months));
      const budgets = data.months.flatMap((m) => Object.entries(m.budgets).map(([category, amount]) => ({ month: m.month, category, amount: r2(amount) })));
      if (budgets.length) await this.q(sb.from("budgets").upsert(budgets));
      const rows = data.expenses.map(cleanExpense);
      for (let i = 0; i < rows.length; i += 500) await this.q(sb.from("expenses").insert(rows.slice(i, i + 500)));
      await this.refresh();
      return;
    }
    const db = replace ? emptyDb() : this.db;
    data.categories.forEach((name) => db.categories.some((c) => sameName(c.name, name)) || db.categories.push({ name, position: db.categories.length }));
    data.months.forEach((m) => {
      db.months[m.month] = { income: r2(m.income) };
      Object.assign((db.budgets[m.month] ||= {}), m.budgets);
    });
    data.expenses.forEach((e) => db.expenses.push({ id: newId(), ...cleanExpense(e) }));
    this.db = db;
    this.persist();
  },

  async wipe() {
    if (this.mode === "cloud") {
      for (const t of ["expenses", "budgets", "months", "categories"]) await this.q(this.client.from(t).delete().eq("user_id", this.user.id));
      await this.refresh();
    } else {
      this.db = { ...emptyDb(), categories: STD_CATEGORIES.map((name, position) => ({ name, position })) };
      this.persist();
    }
  },
};

function cleanExpense(e) {
  return {
    date: e.date, description: String(e.description).trim(), amount: r2(e.amount),
    category: e.category || null, note: e.note ? String(e.note).trim() : null, trip: e.trip || null,
  };
}

function rowToExpense(r) {
  return { id: r.id, date: r.date, description: r.description, amount: +r.amount, category: r.category, note: r.note, trip: r.trip };
}

function authMsg(err) {
  const m = String(err.message || err);
  if (/Invalid login/i.test(m)) return "Email o password sbagliate";
  if (/Email not confirmed/i.test(m)) return "Prima conferma l'email: apri il link che ti è arrivato";
  if (/already registered/i.test(m)) return "Questa email ha già un account: premi Entra";
  if (/Password should be/i.test(m)) return "La password deve avere almeno 6 caratteri";
  if (/rate limit/i.test(m)) return "Troppi tentativi: riprova tra qualche minuto";
  return m;
}
