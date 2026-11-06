# 🧠 Brain di BudgetApp

Tutto quello che serve per capire, usare e mantenere la mini-app delle spese senza doverlo rispiegare.
**Claude: leggi questa cartella prima di toccare qualunque cosa, e aggiornala dopo ogni modifica.**

| File | Cosa contiene |
|---|---|
| [01-panoramica.md](01-panoramica.md) | Cos'è l'app, come è fatta, dove stanno le cose, come ci si collega |
| [02-file-excel.md](02-file-excel.md) | Struttura esatta del file Excel: fogli, celle, formule, regole |
| [03-funzioni-app.md](03-funzioni-app.md) | Le schermate dell'app e le API del server |
| [04-decisioni-e-preferenze.md](04-decisioni-e-preferenze.md) | Cosa vuole l'utente, scelte fatte e perché |
| [05-problemi-noti.md](05-problemi-noti.md) | Incidenti passati, trappole di iPhone/Excel/iCloud e come evitarle |
| [06-manutenzione.md](06-manutenzione.md) | Comandi: riavvio, log, test su copia, script, ripristino da backup |
| [07-indipendente.md](07-indipendente.md) | Prova della versione senza Mac (Supabase), solo nel ramo `prova-supabase` |
| [registro.md](registro.md) | Cronologia delle modifiche, con date |
| `privato.md` | 🔒 **Solo su questo Mac** (non su GitHub): dati dell'utente e valori dei `<segnaposto>`. Leggilo se esiste |

## In 30 secondi
- **Cosa**: web app (iPhone dalla schermata Home + Mac) per registrare le spese nel file Excel del budget, con suggerimento della categoria, budget assistito, risparmi e viaggi.
- **File Excel**: `~/Library/Mobile Documents/com~apple~CloudDocs/excel/Budget_Tracker_Modello.xlsx` (iCloud Drive › excel). È l'unica fonte dei dati.
- **Codice**: `~/Documents/BudgetApp` (server Python FastAPI in `server/`, interfaccia in `web/`).
- **Server**: gira sul Mac in automatico (launchd `com.budgetapp.server`) su porta 8765.
- **Indirizzi**: Mac `http://127.0.0.1:8765` · iPhone **`https://<nome del Mac>.<tailnet>`** (dal 2/11, si apre anche a Mac spento; serve Tailscale acceso sul telefono) · vecchio `http://<IP Tailscale del Mac>:8765` (funziona ma non offline).
- **Lingua**: l'utente scrive in italiano; rispondi in italiano, in modo semplice (non è uno sviluppatore).
