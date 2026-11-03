# BudgetApp

Mini-app delle spese (iPhone + Mac) collegata a `Budget_Tracker_Modello.xlsx` su iCloud.

**Prima di fare qualunque cosa leggi `brain/README.md`** e i file che servono per il compito: lì ci sono struttura del file Excel, funzioni, decisioni, preferenze dell'utente, problemi noti e comandi.

Regole essenziali (dettagli nel brain):
- Rispondi in **italiano semplice**: l'utente non è uno sviluppatore e usa soprattutto l'iPhone.
- Prova sempre su una **copia** in `test/` (server di prova su porta 8766) prima di toccare il file vero; controlla l'interfaccia a 390 px.
- Prima di scrivere sul file vero: server fermo ed **Excel chiuso ovunque** (Excel può sovrascrivere il file, vedi `brain/05-problemi-noti.md`).
- Python solo via `~/.local/bin/uv run`. Dopo modifiche a `server/` riavvia (`launchctl kickstart -k gui/$(id -u)/com.budgetapp.server`); dopo modifiche a `web/` aumenta la versione cache.
- **Aggiorna il brain** (file pertinente + `brain/registro.md`) alla fine di ogni modifica.
- Il progetto va su **GitHub (repository privato)**: i dati personali dell'utente stanno **solo** in `brain/privato.md`, `data/` e nei file Excel (tutti in `.gitignore`). Negli altri file del brain e nel codice usa segnaposto `<…>`; prima di ogni commit controlla `git status`.
