# 01 · Panoramica

## Chi la usa e per cosa
Chi è l'utente, le sue entrate e il periodo del budget: vedi `privato.md`. Le entrate del suo file sono tre voci fisse più "Altro" (vedi 02-file-excel). Il budget va da **Settembre a Luglio**. Registra ogni spesa (supermercato, mensa, lavatrice, trasporti, viaggi…) e vuole capire dove risparmiare.

## Architettura
```
iPhone (web app sulla Home, Safari) ─┐   Tailscale (rete privata)
Mac (browser)  ──────────────────────┼─► Server Python sul Mac ──► Budget_Tracker_Modello.xlsx (iCloud)
                                     │   FastAPI + openpyxl            + backups/ (copia prima di ogni scrittura)
                                     │   avvio automatico (launchd)
                                     └─► Claude (facoltativo) per suggerire categorie mai viste
```

## Dove stanno le cose
| Cosa | Percorso |
|---|---|
| File Excel (unica fonte dei dati) | `~/Library/Mobile Documents/com~apple~CloudDocs/excel/Budget_Tracker_Modello.xlsx` |
| Progetto | `~/Documents/BudgetApp` |
| Server | `server/main.py` (API), `excel.py` (lettura/scrittura fogli mese), `trips.py` (viaggi), `suggest.py` (categorie), `advisor.py` (budget e risparmi), `keywords.json` (negozi → categoria) |
| Interfaccia | `web/index.html`, `web/app.js`, `web/style.css`, `web/sw.js` (offline), icone |
| Dati dell'app (mai su GitHub) | `data/learned.json` (correzioni imparate), `data/keywords_local.json` (parole chiave personali), `data/profile.json` (quiz), `data/contesto.txt` (contesto per Claude), `data/pending.json` (coda se Excel è aperto), `data/done_ids.json` (anti-doppioni) |
| Backup automatici | `backups/` (ultime 50 copie, una prima di ogni scrittura) · `backups/giornalieri/` (60 giorni) · `backups/mensili/` (tutti) · `backups/originale/` (copie storiche da non cancellare) |
| Script una tantum | `scripts/migrate_template.py`, `scripts/add_months.py`, `scripts/setup_trips.py` |
| Avvio automatico | `launchd/com.budgetapp.server.plist` (locale, non su GitHub; modello: `launchd/com.budgetapp.server.plist.example`), copiato in `~/Library/LaunchAgents/` |
| Aggiornamenti automatici (amici) | `avvia.py` (avviatore) + `server/updater.py` (ramo GitHub `stabile`), stato in `data/update.json`; spenti sul Mac dell'utente (vedi 06) |
| Log | `logs/server.log` |
| Copie di prova | `test/` (mai il file vero) |

## Strumenti installati
- **uv** in `~/.local/bin/uv` (porta con sé Python 3.12+). Il `/usr/bin/python3` di sistema NON funziona (è solo l'installer degli strumenti Xcode).
- **Tailscale** su Mac e iPhone, stesso account. Mac `<IP Tailscale del Mac>`, iPhone `<IP Tailscale dell'iPhone>` (valori in `privato.md`). MagicDNS e HTTPS attivi nella `<tailnet>`. `tailscale serve` pubblica https → 127.0.0.1:8765 (comando: `/Applications/Tailscale.app/Contents/MacOS/Tailscale`).
- **Claude Code CLI: NON installato** (l'installazione automatica è stata bloccata). Finché manca, i suggerimenti usano solo storico + parole chiave e il pulsante "Chiedi un consiglio a Claude" non compare. L'utente lo installa con `curl -fsSL https://claude.ai/install.sh | bash`, poi `claude` → login → `/exit`.

## Sicurezza
- Il server ascolta su `0.0.0.0:8765` ma un middleware accetta solo 127.0.0.1 e la rete Tailscale (100.64.0.0/10): chi è sul Wi‑Fi ma fuori da Tailscale riceve 403.
- Nessuna password nell'app: la protezione è Tailscale.
