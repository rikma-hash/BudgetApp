# 07 · Versione indipendente (Supabase)

Ramo **`prova-supabase`**, cartella **`indipendente/`** (worktree sul Mac: `~/Documents/BudgetApp-supabase`). `main` e `stabile` non la contengono: l'app dell'utente e quella degli amici non cambiano.
Istruzioni complete: `indipendente/LEGGIMI.md`. Progetto Supabase dell'utente: indirizzo in `indipendente/config.js` (chiave publishable, pubblica per natura).

## Architettura (dal 6/11)
- **Stessa interfaccia della versione con il Mac**: `costruisci.py` copia `web/index.html`, `app.js`, `style.css`, `i18n.js`, icone e `server/keywords.json` in `sito/`, cambia le scritte sul Mac (`APP_TEXT`, `HTML_TEXT`: se non le trova si ferma), sostituisce i riquadri "Uso con il Mac spento"/"Aggiornamenti" delle Impostazioni con `src/settings.html` (account, Excel, cancella dati), aggiunge `src/login.html` e carica `app.js` solo dopo l'accesso (`login.js`). `sw.js` è quello di `web/` con l'elenco dei file di questa versione. **Rilanciarlo dopo ogni modifica a `web/` o `src/`** e committare anche `sito/` (è quello che va su Vercel).
- **`src/server.js` = server nel telefono**: sostituisce `window.fetch` per gli indirizzi `/api/…` e risponde come `server/main.py` (stessi JSON). Ricalca `excel.py` (summary, income, year, carry_before), `advisor.py` (propose, insights, current_pace), `trips.py`, `importer.py`, `suggest.py` (storico + parole chiave + `settings.learned`). Le spese hanno un `row` numerico assegnato in memoria (l'app identifica le spese con sheet+row). Ogni scrittura riuscita → `Store.commit()`; un errore annulla le modifiche a metà.
- **Mesi**: chiave `AAAA-MM`; il "foglio" mostrato è il nome del mese (con l'anno solo se lo stesso mese compare due volte). Esistono tutti i mesi dal primo all'ultimo con dati, più quello in corso. Un mese nuovo copia entrate e budget dall'ultimo che li ha (come `ensure_month`). Entrate sempre "a lista" (`months.incomes`), surplus/deficit in `carry` + `carry_on`.
- **Categorie uguali per tutti i mesi** (tabella `categories`), budget per mese in `budgets`.
- **Viaggi**: `trips`, `trip_categories`; le spese del viaggio sono `expenses` con `trip` = nome. Nel mese compare una riga calcolata "✈️ Viaggio: nome" (categoria Viaggi) con il totale del viaggio in quel mese.
- **Abbonamenti**: tabella `subscriptions` (auto = inserito da solo nel suo giorno, controllato all'avvio e ogni 30 min); "fatto" = nel mese c'è una spesa con quel nome e importo.
- **`settings.data`** (jsonb): profilo del piano (quiz, plan, plan_rate), hidden_months, balance, learned, subs_log.
- **`src/store.js`**: `db` = tabelle come elenchi; `commit()` confronta con `snap` (ultima versione nota del database) e mette upsert/delete in `outbox` (localStorage), che parte subito o quando torna la rete. `refresh()` scarica tutto solo se la coda è vuota. Upsert: `onConflict` = `user_id` + chiave, **tranne `expenses` (chiave = solo `id`)**: sbagliarlo fa rifiutare tutte le spese (errore 42P10, successo il 6/11).
- Librerie in `vendor/` (supabase-js 2.45.4, SheetJS 0.20.3), servite dal sito; pdf.js si carica da cdnjs solo per i PDF.

## Import del vecchio Excel (`src/excel.js`)
- Per ogni foglio visibile: riga con "Descrizione" e "Importo"; tabella budget = seconda colonna "Categoria" con accanto "Budget…".
- Entrate: tabella "💶 ENTRATE DEL MESE" se c'è, altrimenti le cifre in colonna B sopra le spese (nome = etichetta senza "da ricevere:"). Surplus/deficit dalla riga "riportato/surplus/deficit"; contato se la formula del BUDGET TOTALE lo include (le formule senza valore salvato si leggono solo con `sheetStubs: true`, seconda lettura `wbF`).
- Abbonamenti dalla tabella "💳 ABBONAMENTI" dell'ultimo mese che li ha (giorno tra parentesi).
- Fogli `✈`: viaggio vero con le sue categorie e spese. Le spese di un mese con stessa data e cifra di una del viaggio vengono tolte dal mese (stanno nel viaggio; nel mese c'è la riga ✈️, il totale non cambia).
- Spesa con data di un altro mese → resta nel mese del foglio, "data vera …" nella nota. Nomi di categoria uniti senza maiuscole/minuscole.
- I viaggi sono dentro il Budget_Tracker: non c'è un file viaggi da importare a parte.
- Il profilo del piano (`data/profile.json`) **non** è nell'Excel: non viene importato (l'utente rifà le 5 domande).

## Prova locale
`.claude/launch.json` › **spese-indipendente** (porta 8768, `python -m http.server` su `indipendente/sito`). Prima di ricaricare dopo una ricostruzione: togliere il service worker e le cache (altrimenti "prima la copia" mostra la versione vecchia).
