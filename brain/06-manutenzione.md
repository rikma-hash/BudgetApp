# 06 · Manutenzione

Tutti i comandi si lanciano da `~/Documents/BudgetApp`. `R` = file vero:
```bash
R="$HOME/Library/Mobile Documents/com~apple~CloudDocs/excel/Budget_Tracker_Modello.xlsx"
```

## Server
```bash
launchctl kickstart -k gui/$(id -u)/com.budgetapp.server     # riavvio (serve dopo ogni modifica a server/*.py)
launchctl bootout gui/$(id -u)/com.budgetapp.server          # stop (prima di script che scrivono sul file vero)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.budgetapp.server.plist   # start
tail -50 logs/server.log                                     # log
curl -s localhost:8765/api/state | head -c 300               # controllo veloce
```
I file in `web/` sono letti dal disco: non serve riavviare, ma **aumenta la versione** (`?v=N` in index.html **e** in SHELL di sw.js, più `CACHE = "spese-vN"`).
Variabili nel plist: `PYTHONUNBUFFERED=1` (registro in tempo reale), `BUDGET_XLSX` (file), `BUDGET_AI=cli` (Claude via abbonamento; `api` usa `ANTHROPIC_API_KEY`; `off`).

## Prove su una copia (sempre prima del file vero)
```bash
cp "$R" test/Budget_prova.xlsx
BUDGET_XLSX=test/Budget_prova.xlsx BUDGET_DATA=test/data BUDGET_BACKUPS=test/backups BUDGET_AI=off \
  ~/.local/bin/uv run uvicorn server.main:app --host 127.0.0.1 --port 8766
```
Poi aprire `http://127.0.0.1:8766` nel browser con viewport 390×844 e controllare che `document.documentElement.scrollWidth` sia 390.

## Script
| Script | Quando | Comando |
|---|---|---|
| `migrate_template.py` | file tornato alla versione originale | `uv run python scripts/migrate_template.py "$R"` (rifiuta se `_Modello` esiste già) |
| `add_months.py` | creare i mesi in anticipo | `uv run python scripts/add_months.py "$R" 2027-07` |
| `setup_trips.py` | (ri)creare `_ModelloViaggio` e importare viaggi da Viaggi.xlsx | `uv run python scripts/setup_trips.py "$R" ".../excel/Viaggi.xlsx"` |

Sequenza di ripristino completo (server fermo, Excel chiuso ovunque): migrate → add_months → setup_trips → riavvio.

## Backup
- `backups/Budget_Tracker_Modello-AAAAMMGG-HHMMSS.xlsx`: stato **prima** di ogni scrittura (ultime 50).
- `backups/giornalieri/…-AAAA-MM-GG.xlsx` (ultimi 60) e `backups/mensili/…-AAAA-MM.xlsx` (tutti): `excel.snapshot()`, chiamata dal worker ogni 20 s; copia solo se quella del giorno/mese manca e se il file è uno zip valido. Coprono anche i danni fatti da **Excel** (che non passano da `save`).
- `backups/originale/`: `…PRIMA-DELLA-MIGRAZIONE.xlsx` (file originale dell'utente), `…ripristinato-1553.xlsx` (versione rimessa da Excel il 1/11).
- Per tornare indietro: fermare il server, chiudere Excel, copiare il backup sopra `$R`, riavviare.

## Rete
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status    # https → 127.0.0.1:8765
```

## Dopo ogni modifica
1. Prova su copia (390 px, chiaro/scuro). 2. Aggiorna versione cache se hai toccato `web/`. 3. Riavvia se hai toccato `server/`. 4. **Aggiorna questo brain** (file pertinente + `registro.md`).

## GitHub (repository privato)
- Remoto `origin` = `git@github.com:<utente GitHub>/BudgetApp.git` (valore in `privato.md`), ramo `main`.
- Accesso con una **deploy key** valida solo per questo repository: `~/.ssh/budgetapp_deploy` (scrittura abilitata su GitHub › Settings › Deploy keys). Il repo usa `git config core.sshCommand "ssh -i ~/.ssh/budgetapp_deploy -o IdentitiesOnly=yes"`. `gh` NON è installato apposta (darebbe accesso a tutto l'account). Per revocare: cancellare la chiave su GitHub.
- Autore dei commit: `BudgetApp <budgetapp@localhost>` (config del repo), niente email personale. Messaggi in italiano, con la riga Co-Authored-By.
- Dopo ogni modifica: `git add -A && git status` (controllo) → `git commit` → `git push`.
- `.gitignore` esclude: tutti gli `.xlsx` tranne `modello/Budget_Tracker_vuoto.xlsx`, `test/`, `backups/`, `data/`, `logs/`, `brain/privato.md`, `launchd/com.budgetapp.server.plist` (c'è il `.example` con `__HOME__`), `.claude/`.
- Prima di ogni commit: `git status` e un controllo veloce che non ci siano dati personali:
  `git grep -n -i -e "<IP>" -e "<nome>" …` (valori in `privato.md`).
- **Modello vuoto**: `uv run python scripts/make_blank.py test/Budget_prova.xlsx modello/Budget_Tracker_vuoto.xlsx` (da una copia del file vero): tiene solo `_Modello`, `_ModelloViaggio`, Riassunto e Viaggi, svuota entrate (trasformate in lista libera con `make_income_list`)/budget/abbonamenti, tabellina borsa e riepilogo viaggi, rimette le 9 categorie standard e pulisce l'autore nelle proprietà. Rigeneralo se cambia la struttura del file.
- Dati personali per l'app (non su GitHub): `data/keywords_local.json` (parole chiave tue, unite a `server/keywords.json`), `data/contesto.txt` (frase sull'utente per i consigli di Claude).

## Installare l'app per altre persone (amici)
- `GUIDA.md` (italiano semplice, immagini in `docs/immagini/` fatte con il modello vuoto e spese inventate).
- `installa-mac.sh`: uv → copia del modello (mai sovrascrive) → plist launchd generato con i percorsi giusti → avvio → `tailscale serve --bg 8765` se c'è Tailscale. Variabili per le prove: `BUDGETAPP_PORT`, `BUDGETAPP_LABEL`, `BUDGETAPP_XLSX`. **Provarlo solo su una copia pulita** (`git archive HEAD | tar -x` in scratchpad) con label/porta diverse: nella cartella vera userebbe `data/` dell'utente.
- `installa-windows.ps1` (UTF-8 con BOM per PowerShell 5.1): uv → modello → `avvia-budgetapp.cmd` (UTF-8 senza BOM) lanciato nascosto da `avvia-budgetapp.vbs` → attività pianificata "BudgetApp" all'accesso → `tailscale serve`. Server su 127.0.0.1 (niente firewall), iPhone solo via https. **Non provato su un Windows vero.**
- Server compatibile Windows: "Apri Excel" usa `os.startfile`; se Excel tiene bloccato il file il salvataggio diventa `ExcelLocked` (coda) invece di un errore.
