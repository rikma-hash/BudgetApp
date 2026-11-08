# Registro delle modifiche

## 2026-11-01
- **Analisi** del file `Budget_Tracker_Modello.xlsx` (13 fogli; Novembre era il modello più recente ma con titolo "DICEMBRE"; categorie scritte in modi diversi; Riassunto con valori a mano).
- **Installato uv**; progetto in `~/Documents/BudgetApp`.
- **Migrazione** del file: `_Modello` nascosto (Sett 1–5, 15 slot categoria, abbonamenti spostati in basso), Novembre convertito, mesi futuri vuoti eliminati, Riassunto collegato con formule da Novembre.
- **App v1**: server FastAPI + web app per iPhone; suggerimento categoria (storico + parole chiave + Claude); code offline e "Excel aperto"; avvio automatico con launchd.
- **Tailscale** + `tailscale serve` https. Il nome `…ts.net` non si risolve sull'iPhone → accesso via `http://<IP Tailscale del Mac>:8765` (server su 0.0.0.0 con filtro Tailscale).
- **v2**: 5 schede (Nuova, Mese, Anno, Budget, Risparmi), modifica/eliminazione spese, assistente budget, analisi risparmi, spese frequenti.
- **v3 (layout semplice)**: Home con numero grande, pulsante + centrale, categorie con icone, Storico Mese/Anno, Budget in 3 passi.
- **v4–v6**: elenco categorie al posto della griglia; correzione pagina rimpicciolita (Set/Ott); riga Surplus/Deficit nel Budget; mesi fino a Luglio; schermata + a pagina intera; niente `prompt/confirm`; anti-cache.
- **15:53 incidente**: Excel ha rimesso la versione originale. Ripristinato tutto (nessun dato utente perso). Aggiunto avviso `problem` nell'app.
- **v7**: scheda **Viaggi** (fogli `✈ Nome` dal template dell'utente, riepilogo `Viaggi`, riga per mese), importato il primo viaggio dal vecchio file; **gestione categorie** (rinomina/elimina/budget/nuova); pulsanti **Senza affitto / Senza viaggi**; Risparmi dentro Budget.
- Creato questo **brain** e `CLAUDE.md`.

## 2026-11-01 · Confronto speso/budget per categoria nei mesi passati
- Storico › Mese: nuova card "Speso e budget per categoria" (stesso `catRow` della Home) per qualunque mese, anche Settembre/Ottobre. Tocco su una riga = filtra le spese per quella categoria.
- Solo `web/` (app.js, index.html); versione cache 7 → 8. Nessuna modifica al server né al file Excel. Provato su copia a 390 px.

## 2026-11-02 · Piano budget rifatto (blocco 1 della lista dell'utente)
- Scala "Puoi spendere" in cima, risparmio in € (anche importo libero) con proiezione annuale, quiz di 5 domande (`data/profile.json`), ＋ Altro / ＋ Nuova categoria dal piano, "anche i mesi dopo" (`apply_following`), cifre manuali mantenute, arrotondamento esatto.
- Server: `PUT /api/budgets` crea categorie mancanti e accetta `apply_following`; nuovi `GET/PUT /api/profile`. Web v9. Provato su copia (390 px, chiaro/scuro, salvataggio Dicembre→Luglio verificato nel file). Server vero riavviato; file Excel vero non toccato.

## 2026-11-02 · Risparmi e consigli rifatti (blocco 2)
- `advisor.insights` ora restituisce anche `pace` (mese in corso), `budget_tips`, e per temi/consigli `items`, `months`, `how`, `saving`, `avg_ticket`. Righe viaggio escluse dall'analisi.
- Web v10: schede apribili con freccia, "X € al giorno", consigli budget con pulsante "Usa X €", mese per mese apribile. Corretto anche `sw.js` (SHELL era rimasto a ?v=8). Provato su copia 390 px chiaro/scuro; server vero riavviato; file Excel vero non toccato.
- Attenzione: per aumentare la versione in `sw.js` cambiare sia `spese-vN` sia `?v=N` (un replace di "vN" non tocca "?v=N").

## 2026-11-02 · Ritocchi dopo la prova dell'utente
- "＋ Altro" spostato dal passo ③ (categorie) al passo ① (entrate): nuova voce **Altre entrate** in A7/B7, inclusa in B6 e nella base (`X.other_income`, `income()["altro"]`, `set_income(altro=…)`).
- Risparmi › Mese per mese: barra speso vs entrate con parte rossa oltre le entrate e tacca. Web v11. Provato su copia (Dicembre: B6 `=B2+B3+B4+B7`, A7/B7 scritti). Server vero riavviato; file vero non toccato.

## 2026-11-02 · Blocco 3: categorie nei viaggi (+ "Altro" sempre visibile)
- Piano: riga "💶 Altro" nelle entrate sempre visibile (tolto il pulsante). Web v13.
- Viaggi: `trips.add_category` (riga vuota oppure TOTALE che scende, max 20), `tot_row()` dinamico usato da categorie/budget/menu/riepilogo `Viaggi`; `POST /api/trips/category`; nuova categoria anche dalla schermata ＋ e in modifica; riga virtuale rinominata "Senza categoria".
- Provato su copia: viaggio importato → Musei + Souvenir, TOTALE in riga 14, DV G4:G13, Viaggi!B4 = H14. 390 px chiaro/scuro. Server vero riavviato; file vero non toccato.

## 2026-11-02 · Blocco 4: rate e import estratto conto
- Spesa divisa su più mesi (`Expense.split`, `installments()` in main.py) con pillole nella schermata ＋.
- Nuovo `server/importer.py` + `POST /api/import/parse|save`, vista "Importa spese" (Storico › 📥 Importa). Aggiunta dipendenza **pypdf** (`uv add pypdf`). Parole chiave ampliate (supermercati NL/DE/IT, drogherie, delivery, trasporti).
- Provato su copia con CSV stile Intesa, Revolut, Sparkasse, carta e un PDF di prova; duplicati e mesi vecchi riconosciuti; salvataggio e rate verificati nel file. Web v15. Server vero riavviato; file vero non toccato.
- Da verificare con un file vero dell'utente (formato della sua banca).

## 2026-11-02 · Rate personalizzabili
- Pillola "Scegli…" al posto di 12: numero di mesi libero (stepper) oppure "fino a <mese>" (fino a 24 mesi). Web v16. Provato su copia: 700 € in 10 rate nov 2026 → ago 2027 (foglio Agosto creato da solo).

## 2026-11-02 · Blocco 5: interfaccia Mac e Impostazioni
- Impostazioni per dispositivo (tema, 6 colori, dimensione testo, pagina iniziale). Layout ≥ 900 px con barra laterale e due colonne (`.cols/.col` = `display: contents` sul telefono). Schermata ＋ come finestra sul Mac.
- Web v17. Provato a 1280 px e a 390 px (tutte le viste, anche testo "molto grande": scrollWidth 390). Nessuna modifica al server né al file.

## 2026-11-02 · Inglese
- Nuovo `web/i18n.js` (traduttore a schermo con dizionario EXACT/FRAGMENTS/PATTERNS, LOCALE per numeri e date), scelta lingua nelle Impostazioni, `/api/advice?lang=`. Web v18 (anche SHELL di sw.js include i18n.js).
- Provato su copia in inglese: tutte le viste senza testi italiani tranne i dati dell'utente; spesa "12.50" salvata come 12,5; ritorno all'italiano invariato. Server vero riavviato; file vero non toccato.

## 2026-11-02 · Preparazione GitHub (repository privato, senza dati personali)
- Brain diviso: dati personali in `brain/privato.md` (solo locale), segnaposto `<…>` negli altri file. `CLAUDE.md` aggiornato.
- Parole chiave personali → `data/keywords_local.json` (unite in `suggest.py`); contesto dei consigli → `data/contesto.txt` (`advisor.ADVICE_CONTEXT` generico).
- `launchd/…plist.example`, `.gitignore`, README con installazione da zero, `scripts/make_blank.py` + `modello/Budget_Tracker_vuoto.xlsx` (verificato: nessun dato/nome dell'utente, anche nelle proprietà). `_summary_add` gestisce il primo mese di un file nuovo.
- Provato il modello vuoto con l'app (spesa, budget, viaggio, consigli). `git init` fatto e file aggiunti; **commit e push in attesa del login GitHub dell'utente**.
- Repository privato creato dall'utente, deploy key aggiunta, primo commit caricato (`main`). Verificato che da fuori risulti 404 (privato).

## 2026-11-02 · Uso con il Mac spento
- Copie offline delle letture in `api()` con avviso "dati del …", `/api/offline-pack` + `localSuggest`, modifiche bloccate offline, coda che ricarica la vista dopo l'invio. Web v19.
- Provato su copia spegnendo il server: viste visibili dalla copia, "Lidl" → Spesa suggerita sul telefono, spesa in coda arrivata nel file alla riaccensione. Server vero riavviato; file vero non toccato.
- Per aprire l'app a Mac spento sull'iPhone serve l'indirizzo https (istruzioni date all'utente).
- iPhone passato all'indirizzo https (Tailscale era scollegato sul telefono): service worker e pacchetto offline scaricati dall'iPhone.

## 2026-11-02 · Schermo nero/bianco a Mac spento
- Causa: con Tailscale acceso e Mac spento le richieste restano appese (nessun errore) → pagina vuota. Ora `sw.js` (v20) usa la copia dopo 2,5 s e `api()` ha tempi massimi (8 s / 1,5 s offline). Provato con un server finto che non risponde: Home subito dalla copia, Storico e Piano dalla copia in pochi secondi.
- Ancora schermo vuoto sull'iPhone a Mac spento: sw v21 (riserva con qualunque versione dei file), schermata "Apro l'app…" e scatola nera (`logs/diag.log`) per vedere cosa succede sul telefono. Web v21.
- Scatola nera: a Mac spento la pagina non è nemmeno partita e dopo il service worker risultava "assente" → iOS l'aveva cancellato. Aggiunti `navigator.storage.persist()`, riquadro **Impostazioni › Uso con il Mac spento** (https, copia attiva, file, dati, protezione) e stato offline nel diag a ogni avvio. Web v22.
- Diag: in Safari l'avvio offline funzionava (copia dopo 2,5 s), dall'icona della Home no (sw sempre "assente"). sw v23 "prima la copia" + ricarica automatica alle versioni nuove. Web v23.
- Falso "Mac non raggiungibile" a Mac acceso: `failMsg` e gli altri `catch` trattavano qualunque errore senza `status` (anche bug JS) come rete assente. Ora solo `err.network` (impostato in `api()` quando `fetch` fallisce) segna offline; gli errori interni vanno nella scatola nera con lo stack. Web v24.
- Icona della Home: a Mac spento ancora schermo vuoto (in Safari invece funziona). Proposta all'utente: icona che apre in Safari ("Apri come app web" spento) mentre si indaga.
- Scoperto che il registro era in ritardo (buffer) e che il telefono era fermo alla v19: aggiunti `PYTHONUNBUFFERED`, `/api/version` + `checkVersion()`, `no-store` su `/` e sw.js, install sw con `cache: "reload"`, pulsante 🔄 Ripristina l'app. Web v26.

## 2026-11-03 · Mac spento: verificato sul telefono
- Dopo Ripristina + riapertura (v26) l'app si apre a Mac spento sia da Safari sia dall'icona della Home; spesa di prova aggiunta offline e arrivata nel file. La scatola nera resta attiva (`logs/diag.log`).

## 2026-11-03 · Avvisi 80% in Home, abbonamenti automatici, scorri per eliminare
- Controllata la lista dell'utente: tutto fatto tranne la prova dell'import con un estratto conto vero.
- Home: avvisi categorie ≥ 80%/sforate. Budget › Categorie: card 💳 Abbonamenti con interruttore (spento di base) + `apply_subscriptions` nel worker. Swipe a sinistra per eliminare su Home/Storico/viaggio. Web v27.
- Provato su copia: avvisi Spesa 91% e Svago 87%; swipe → Elimina → conferma → spesa tolta, tocco normale apre ancora la modifica, scorrimento verticale non apre niente; interruttore → 3 abbonamenti inseriti al 1/11, uno con giorno più avanti "arriva il <giorno>". Server vero riavviato, interruttore spento sul file vero.
- Abbonamenti: interruttore per ogni abbonamento al posto di quello unico (`auto_subs` lista di nomi); riaccendendone uno eliminato nel mese viene reinserito. Web v28. Provato su copia dalla situazione reale (3 inseriti ed eliminati): acceso un abbonamento → reinserito solo quello; spegni/riaccendi senza doppioni; quello con il giorno più avanti aspetta.
- Swipe: il rosso "Elimina" compare e segue il dito durante lo scorrimento (si allunga oltre 92 px). Web v29.
- Verificata la storia git: nessun file o dato personale in nessun commit (solo il modello vuoto tra gli xlsx).
- Compatibilità altri sistemi (per amici): il server è Python/uv e gira anche su Windows/Linux; da adattare solo l'avvio automatico (launchd è solo Mac) e "Apri Excel" (`open`, main.py). L'iPhone da solo non basta: serve un computer acceso come "cervello".

## 2026-11-03 · Guida e installatori per gli amici
- `GUIDA.md` + 3 immagini (modello vuoto, spese inventate), `installa-mac.sh` (provato su copia pulita con label/porta di prova, poi rimosso tutto; rilanciato non tocca il file), `installa-windows.ps1` (non provato: niente Windows qui). Server: `os.startfile` su Windows, `PermissionError` al salvataggio → coda. README rimanda alla guida.

## 2026-11-03 · Entrate libere nel modello per gli amici
- Modello vuoto senza Borsa/Budget personale/Aiuto famiglia/Altro: tabellina entrate H37:I48 (`excel.make_income_list`, `income_list_mode`, `income_items`); resta Surplus/deficit (B5). Nel Piano: "＋ Aggiungi entrata", importo a destra, scorri a sinistra per eliminare. Il file dell'utente è invariato (campi fissi).
- Corretto: con un file nuovo il Piano proponeva il mese dopo invece di quello in corso.
- Provato su copia (`test/amico/`) a 390 px: aggiunta, eliminazione, salvataggio, copia nel mese successivo. Versione cache 31.
- Corretto: Invio nelle finestre (nuova entrata/categoria, importo, abbonamento, categoria) valeva come Annulla o Elimina; ora vale come Salva/Crea (vedi 05-problemi-noti). Versione cache 32.
- Entrate a lista: sul Mac (niente scorrimento col mouse) un clic sul nome chiede "Togliere X?". Versione cache 33.

## 2026-11-03 · Pulizia prima di rendere pubblico GitHub
- Dettagli personali (profilo, spese e abbonamenti delle prove) spostati dal brain a `privato.md`; i prompt per Claude (categoria, import) leggono `data/contesto.txt` (`suggest.context()`) invece di una frase fissa sull'utente; immagine `docs/immagini/3-piano.jpg` rifatta con le entrate a lista e cifre inventate.
- Storia di GitHub sostituita da un unico commit pulito (force push). La vecchia storia resta **solo sul Mac** nel ramo locale `vecchia-storia-privata`: **mai fare push di quel ramo** (né `git push --all`).

## 2026-11-03 · Copie di sicurezza giornaliere/mensili e licenza (app dell'utente + GitHub)
- Parere "da veterano": i punti deboli principali erano le copie solo prima delle scritture dell'app (niente protezione dai danni di Excel, niente storia lunga) e la mancanza di licenza.
- `excel.snapshot()` nel worker: `backups/giornalieri/` (60 giorni) e `backups/mensili/` (tutti); salta i file non validi. Provato su copia (ritenzione 60, mesi, file rotto ignorato) e nel server di prova.
- `LICENSE` MIT (titolare `rikma-hash`, il nome utente GitHub già pubblico). README e GUIDA aggiornati (cartella `backups` da non toccare negli aggiornamenti, come ripristinare).
- Licenza cambiata subito dopo: l'utente vuole che gli altri **usino** l'app ma **non la modifichino**. `LICENSE` ora è "uso personale" (IT+EN): uso e aggiornamento gratis; vietati modifiche, opere derivate, ridistribuzione modificata e uso commerciale; le impostazioni in `data/` non contano come modifiche.

## 2026-11-03 · Mac spento: Storico e Budget sempre disponibili (app dell'utente + GitHub)
- `warmOffline()`: con il Mac raggiungibile l'app salva in sottofondo tutte le pagine principali per l'uso a Mac spento (dettagli in 05-problemi-noti). Web v35.

## 2026-11-03 · Piano: risparmio e deficit non tornano più al 10% (app dell'utente + GitHub)
- La % di risparmio non era salvata da nessuna parte e il deficit solo con Salva: ora le scelte del piano si ricordano per ogni mese in `profile.json` (vedi 03). Web v36. Provato su copia a 390 px: Nov 20% + deficit ignorato, Dic 123 € + deficit sottratto → dopo la riapertura uguali, Gennaio (mai toccato) prende il 20%, Salva le lascia com'erano.

## 2026-11-04 · 5 richieste dell'utente (app dell'utente + GitHub)
- ＋: nome facoltativo (si usa la categoria) e la categoria toccata a mano non cambia più scrivendo il nome. Anteprima rate più chiara (cifra al mese + elenco mesi).
- Piano: colonne Proposto | Messo, totali Dovresti avere / Proposto / Messo ora; allarme sforamento con Aggiusta / Ignora e conferma al Salva.
- Viaggi: copia di categorie e budget da un altro viaggio, alla creazione e con un pulsante nel viaggio.
- Provato su copia del file vero a 390 px (tutto quanto sopra, nomi lunghi che vanno a capo). Web v38.

## 2026-11-04 · Aggiornamenti automatici per gli amici (app dell'utente + GitHub)
- `avvia.py` + `server/updater.py` + Impostazioni › Aggiornamenti; installatori e GUIDA aggiornati (ZIP dal ramo `stabile`). Il Mac dell'utente è escluso (cartella git). Dettagli e prove in 06-manutenzione. Web v39.
- Chi aveva già installato deve rilanciare l'installatore una volta.

## 2026-11-04 · Copia del budget in altri mesi (app dell'utente + GitHub)
- Budget › Categorie: copia del budget di tutto il mese o di una categoria nei mesi dopo, scelti con caselle (vedi 03). Provato su copia del file vero a 390 px: Novembre → Dicembre+Gennaio (tutte), Svago → Febbraio (solo quella, il resto invariato). Web v40.

## 2026-11-05 · Mac spento, Piano automatico, disponibile, Home (app dell'utente + GitHub)
- **Modifiche a Mac spento di tutto** (coda `ops` + copie corrette subito, `find_row` nel server per le righe spostate); **letture subito dalla copia** a Mac spento. Provato spegnendo davvero il server di prova: budget, modifica ed eliminazione spesa, rinomina categoria, budget viaggio → visibili anche riaprendo l'app, Storico/Budget in ~0,15 s; riacceso il server → tutto arrivato nel file, coda vuota.
- **Piano**: salvataggio automatico (niente più "Usa questo budget"), colonne Proposto | Il tuo, "Usa la proposta per tutte", "Copia nei mesi dopo", **barra fissa** con disponibile e "Sfori di X" mentre scrivi. Categorie: disponibile in cima e nella finestra della categoria.
- **Home**: in grande quanto hai speso, sotto "Ti restano X di <budget totale>".
- Provato su copia del file vero e sul modello vuoto a 390 px. Web v43.

## 2026-11-06 · Occhio nello Storico, elimina categorie viaggio, parole chiave, soldi sul conto
- Richieste dell'utente (per la sua app **e** per il modello GitHub).
- **Storico › Anno**: occhio su ogni mese iniziato per toglierlo dai totali in alto (mese più chiaro); salvato in `profile.json` › `hidden_months`, uguale su tutti i dispositivi.
- **Viaggi**: tocco su una categoria → budget oppure **Elimina** (le spese si spostano in un'altra categoria o restano "Senza categoria"). Nuovo `POST /api/trips/delete-category`, `trips.delete_category`; funziona anche a Mac spento (`patchOffline`).
- **Parole chiave** (`server/keywords.json`): da 164 a 680 (supermercati, negozi, app di consegna, trasporti e abbonamenti di Italia, Germania, Olanda e altri). Tolte parole ambigue (es. "dott", "bonifico", "amazon").
- **Piano**: riquadro **🏦 Soldi sul conto** separato da "Budget di <mese>"; `GET /api/balance` (stima = importo − spese registrate dopo).
- Versione cache 43 → 44. Provato su copia (`test/rete`) a 390 px, chiaro e scuro; server vero riavviato.

## 2026-11-06 · Pagina GitHub (README) con le due strade
- Dopo il feedback esterno: README riscritto in breve con immagini e tabella **📱 Solo app** (link + account, dati su Supabase) / **💻 Con il tuo computer** (GUIDA.md, file Excel). Avviso onesto: con la versione solo app i dati stanno nel database di chi gestisce il link.
- Struttura del progetto, variabili e `brain/` spostati in un riquadro chiuso "Per chi sviluppa" (GitHub non permette di nascondere una cartella). Il link all'app online **non** è nel README (è in `privato.md`): gli amici lo chiedono all'utente.
- Licenza "uso personale" **tenuta** (scelta dell'utente del 3/11), ridotta a una riga in fondo.

## 2026-11-08 · Note, spese a Mac spento nei totali, mesi dopo luglio, avvisi da scorrere, budget con la virgola
- Richieste dell'utente per **tutte e tre le versioni** (sua app, amici, online).
- **Scheda della spesa**: tocco → note (colonna F) con Modifica a sinistra ed Elimina a destra; le note si salvano chiudendo.
- **Mac spento**: le spese in coda contano subito in totali, categorie, settimana, Storico mese/anno e viaggio (`queuedIn`/`withQueued`).
- **＋ Mese** nelle pillole di Storico e Piano (`POST /api/months/add`, `X.next_month_day`): provato su copia, Luglio → Agosto → "Settembre 2027".
- **Avvisi della Home**: scorri a sinistra e spariscono (× sul Mac); tornano solo se peggiorano.
- **Budget con la virgola**: già salvati giusti, ora si vedono con i centesimi (`eurB` al posto di `eur0` per i budget).
- **＋**: "Dove la registro?" sempre visibile con **✈️ Nuovo viaggio…**.
- **Parole chiave**: da 680 a ~2.050, nuove categorie Affitto, Università, Animali; tolte parole ambigue (es. "max", "now", "tua", "poco", "amazon" in Casa); **a parità vince la parola più lunga** (`suggest.py` e `localSuggest`: "carnet" non va più in Spesa per "carne").
- Versione cache 44 → 45. Provato su copia (`test/rete`) a 390 px.
- Pubblicato per gli amici (`main` → `stabile`, dddd28a): si aggiornano da soli entro 6 ore.
- Correzione: "✈️ Nuovo viaggio…" nel ＋ risultava scelto (verde) insieme a "Spesa del mese". Web v46.

## 2026-11-08 · Pagamenti che si ripetono (v47, tutte e tre le versioni)
- Richiesta: segnare un pagamento che si ripete con personalizzazione tipo calendario (es. una tassa ogni 3 mesi da una data, con fine). Scelta dell'utente: **entra da solo nel giorno giusto** (come gli abbonamenti), nei mesi futuri si vede come "previsto".
- ＋ › **Si ripete** (pillole + Personalizza…), regole in `data/recurring.json` (`server/recurring.py`), inserimento automatico nel worker, previsti nello Storico, elenco in Budget › Categorie con modifica/Ferma. Inglese in `i18n.js`.
- Online: stesse API in `indipendente/src/server.js` (`settings.recurring`, `applyRecurring` all'avvio e ogni 30 min con gli abbonamenti).
- Provato su copia (8766) e in demo (8768) a 390 px: date passate inserite subito, previsti, modifica, Ferma, inglese.
- In attesa: l'esempio di Excel "letto in altri modi" (l'utente lo manda dopo) e l'import di altri formati (CSV, Numbers, ODS/Google Fogli, OFX/QIF).

## 2026-11-08 · Import da Excel, Numbers, Google Fogli, OFX, QIF (v48, tutte e tre le versioni)
- Richiesta: importare altri formati oltre Excel e leggere anche Excel fatti in altri modi; esempio dell'utente: un file Numbers "a matrice" senza date (dettagli in `privato.md`).
- Scelte dell'utente: senza date → **1° del mese** (mese dal nome della tabella, modificabile); le celle fuori tabella (un'entrata) non si importano.
- Mac: `importer.parse_any` + `parse_table`, dipendenza nuova `numbers-parser` (pyproject/uv.lock), `_import_category` + `SHEET_SYNONYMS` in main.py. Web: campo file senza `accept`, menu del mese, nota con nome file. Online: stessa logica in `indipendente/src/importer.js` con SheetJS (legge anche .xls); con SheetJS il nome della tabella di Numbers non arriva (solo il nome del foglio) → mese da scegliere.
- Provato su copia (8766) e demo (8768) a 390 px col file dell'utente e con file di prova xlsx, CSV a matrice, ODS, OFX, QIF.


- Pubblicato per gli amici (`stabile` = a67f732): pagamenti che si ripetono (v47) e import da fogli/altri formati (v48).
