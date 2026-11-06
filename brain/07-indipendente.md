# 07 · Versione indipendente (prova Supabase)

Ramo **`prova-supabase`**, cartella **`indipendente/`** (worktree sul Mac: `~/Documents/BudgetApp-supabase`). `main` e `stabile` non la contengono: l'app dell'utente e quella degli amici non cambiano.
Istruzioni per l'utente: `indipendente/LEGGIMI.md`.

## Com'è fatta
- Sito statico (nessun server Python): `index.html` + `app.js` (schermate) + `store.js` (dati) + `suggest.js` + `excel.js`. Librerie da CDN: `@supabase/supabase-js@2.45.4` (UMD) e SheetJS `xlsx-0.20.3` (cdn.sheetjs.com).
- `style.css` è una **copia** di `web/style.css` (stesse classi); le aggiunte stanno in `extra.css`. Anche `keywords.json` è una copia di `server/keywords.json`: se cambi le parole chiave, ricopiale.
- **Store**: modalità `demo` (tutto in `localStorage` "indip-demo-db", senza account) o `cloud` (Supabase con email+password). Tiene in memoria `db = {categories, months{income}, budgets{mese:{cat:€}}, expenses[]}`, scarica tutto con `refresh()` (a pagine da 1000) e dopo ogni scrittura riuscita aggiorna la copia; la copia è salvata in "indip-cache" per aprire subito.
- Tabelle (`supabase/schema.sql`): `categories(user_id,name,position)`, `months(user_id,month 'AAAA-MM',income)`, `budgets(user_id,month,category,amount)`, `expenses(id,user_id,date,description,amount,category,note,trip)`. RLS "solo i miei dati" su tutte (`user_id = auth.uid()`, valore di default `auth.uid()`).
- Login con **password** (non link magico: dall'app sulla schermata Home il link si aprirebbe in Safari).
- Niente `prompt()`/`confirm()`: finestre `namedlg`, `confirm`, `catdlg`.

## Import del vecchio Excel (`readBudgetExcel`)
- Cerca in ogni foglio visibile la riga con "Descrizione" e "Importo"; colonne per nome (Data, Categoria, Note). Tabella budget = seconda colonna "Categoria" con accanto "Budget…" (solo nei mesi, non nei viaggi).
- Entrate = cifre in colonna B sopra le spese, tranne righe con totale/surplus/deficit/riportato. Anno del mese dalle date; mesi vuoti seguono l'ordine dei fogli.
- Righe "✈️ Viaggio:" saltate; spese dei fogli `✈` → categoria Viaggi, `trip` = nome, categoria originale nella nota; **scartate se stessa data e cifra sono già in un mese** (un viaggio importato può essere già scritto spesa per spesa in un mese).
- Spesa con data di un altro mese (es. l'affitto di un mese pagato all'inizio del successivo) → resta nel mese del foglio, "data vera …" nella nota.
- Nomi di categoria uniti senza maiuscole/minuscole ("affitto" → "Affitto").
- Prova sulla copia del 6/11: totali di ogni mese uguali al Riassunto del file (cifre in `privato.md`, se servono).

## Prova locale
`.claude/launch.json` › **spese-indipendente** (porta 8768, `python -m http.server` sulla cartella). Senza `config.js` compilato si prova solo la modalità senza account.
