# BudgetApp

👉 **Per installarla passo passo: [GUIDA.md](GUIDA.md)** (Mac: `bash installa-mac.sh` · Windows: `installa-windows.ps1`).

Mini-app delle spese (iPhone + Mac) che scrive in un file Excel del budget su iCloud: registrazione rapida con
categoria suggerita, piano del budget, risparmi e consigli, viaggi, rate su più mesi, import dell'estratto conto
(CSV/PDF), italiano/inglese.

Il file Excel è l'unica fonte dei dati e **non è in questo repository** (vedi `.gitignore`): qui c'è solo il codice
e un modello vuoto.

## Installazione da zero (Mac)
1. Installa [uv](https://docs.astral.sh/uv/) (porta con sé Python).
2. Copia il modello vuoto dove vuoi tenere il budget, per esempio su iCloud Drive:
   `cp modello/Budget_Tracker_vuoto.xlsx ~/Library/Mobile\ Documents/com~apple~CloudDocs/Budget.xlsx`
3. Prova l'app:
   `BUDGET_XLSX=<percorso del file> ~/.local/bin/uv run uvicorn server.main:app --host 127.0.0.1 --port 8765`
   e apri http://127.0.0.1:8765 (alla prima spesa l'app crea il foglio del mese).
4. Avvio automatico: copia `launchd/com.budgetapp.server.plist.example` in `~/Library/LaunchAgents/com.budgetapp.server.plist`,
   sostituisci `__HOME__` e il percorso del file, poi `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.budgetapp.server.plist`.
5. iPhone: installa Tailscale su Mac e iPhone, apri `http://<IP Tailscale del Mac>:8765` in Safari → Condividi → Aggiungi alla schermata Home.

## Variabili
- `BUDGET_XLSX`: percorso del file Excel
- `BUDGET_DATA`, `BUDGET_BACKUPS`: cartelle dei dati dell'app e dei backup (default `data/`, `backups/`)
- `BUDGET_AI`: `cli` (Claude Code con l'abbonamento, default), `api` (serve `ANTHROPIC_API_KEY`), `off`

## File personali facoltativi (in `data/`, mai su GitHub)
- `data/keywords_local.json`: parole chiave tue, es. `{"Mensa": ["nome della tua mensa"]}`
- `data/contesto.txt`: una frase su di te per i consigli di Claude (es. "una persona che vive da sola in affitto")

## Cartelle
- `server/` – API (FastAPI), lettura/scrittura Excel, suggerimenti, consigli, import estratti conto
- `web/` – l'app (installabile su iPhone), `i18n.js` per l'inglese
- `scripts/` – manutenzione: `migrate_template.py`, `add_months.py`, `setup_trips.py`, `make_blank.py` (rigenera il modello vuoto)
- `modello/` – file Excel vuoto da cui partire
- `brain/` – documentazione completa del progetto (per chi ci lavora, anche Claude)
