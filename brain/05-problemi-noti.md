# 05 · Problemi noti e trappole

## ⚠️ Excel che sovrascrive il file (successo il 1/11/2026 alle 15:53)
- **Cosa**: Excel aveva ancora aperta la versione di stamattina; salvando ha rimesso il file vecchio sopra quello dell'app (spariti `_Modello`, Novembre nuovo, mesi fino a Luglio; ricomparso "Aprile (2)"). Nessun dato dell'utente perso.
- **Perché il server non se n'è accorto**: con i file su iCloud, Excel per Mac (AutoSave) spesso **non crea il file `~$…`**, quindi `is_locked()` non vede che è aperto.
- **Difesa attuale**: se manca `_Modello`, `/api/state` restituisce `problem` e l'app mostra un avviso invece di andare in errore.
- **Ripristino**: `scripts/migrate_template.py` + `scripts/add_months.py <file> 2027-07` + `scripts/setup_trips.py <file> Viaggi.xlsx` (vedi 06), oppure copia da `backups/`. Le spese inserite dall'app dopo l'ultimo backup vanno recuperate dai backup.
- **Consiglio all'utente**: chiudere Excel (Cmd+Q) dopo l'uso; mai tenerlo aperto per ore mentre usa l'app.

## iPhone / Safari
| Problema | Causa | Soluzione adottata |
|---|---|---|
| Pagina "rimpicciolita" in Settembre/Ottobre | riga di pillole scorrevoli dentro una griglia CSS allargava la pagina a ~1400 px | `.view { grid-template-columns: minmax(0,1fr) }` e `min-width: 0` sui figli. **Ogni nuova riga scorrevole va dentro un contenitore con min-width 0** |
| Schermata + tagliata/buggata | stessa causa (Frequenti) + `<dialog>` a schermo intero instabile su iOS | Schermata + = `div` fisso a pagina intera; controllare `scrollWidth == 390` |
| Zoom automatico | input < 16 px | tutti gli input 16 px + `maximum-scale=1` |
| Pulsanti che non rispondono | `prompt()`/`confirm()` non affidabili nelle web app sulla Home | finestrelle dell'app (`askConfirm`, `askNumber`, campo nell'elenco) |
| Versione vecchia mischiata alla nuova | cache del telefono | header `Cache-Control: no-cache`, `?v=N` su app.js/style.css e `CACHE = "spese-vN"` in sw.js: **aumentare N a ogni rilascio** |
| `https://…ts.net` non si apre sull'iPhone | il DNS di Tailscale sull'iPhone non risolve il nome (ping via IP funziona) | si usa `http://<IP Tailscale del Mac>:8765`. Senza https il service worker non parte: con il Mac spento l'app non si apre (la coda funziona solo con l'app già aperta). **Risolto il 2/11**: la causa era Tailscale **scollegato sull'iPhone** (in `tailscale status` l'iPhone risultava offline). Con Tailscale acceso + Use Tailscale DNS l'indirizzo https funziona e il service worker parte. Se ricapita: controllare `tailscale status`, poi Relay privato di iCloud / "Limita monitoraggio indirizzo IP". Procedura: nell'app Tailscale dell'iPhone attivare **Use Tailscale DNS**, aprire `https://<nome del Mac>.<tailnet>` e rimettere l'app sulla Home da lì. Attenzione: http e https sono "siti" diversi per Safari, quindi coda, impostazioni e copie offline non passano da uno all'altro: prima di cambiare, svuotare la coda con il Mac acceso. |

## Altro
- `/usr/bin/python3` non esiste davvero: usare sempre `~/.local/bin/uv run python`.
- L'installazione automatica di Claude Code è stata bloccata dai permessi: la fa l'utente a mano.
- openpyxl: non salva i valori calcolati delle formule → l'app calcola i totali in Python (`excel.summary`, `trips.eval_link`); Excel ricalcola all'apertura.
- Nel browser di anteprima di Claude `prompt()` non esiste e i click con coordinate sono inaffidabili: usare `find`/ref o JavaScript per i test.
- Le schede dello Storico/Budget caricano dati al cambio di hash: dopo un rilascio ricaricare la pagina, non solo cambiare `#`.

## App della Home (iPhone) a Mac spento
- L'icona sulla Home è un'**app separata da Safari**: memoria, service worker e copie offline sono suoi. Il riquadro Impostazioni › Uso con il Mac spento va guardato **dentro l'icona**, non in Safari.
- Con il service worker "rete prima, copia dopo 2,5 s" Safari partiva offline, l'icona no (schermo vuoto, sw "assente" agli avvii successivi). Dal 2/11 sw "prima la copia". Non togliere/rimettere l'icona: riparte da zero.
- Diagnosi: `logs/diag.log` (campo `standalone=True` = icona della Home).
- Se l'icona "app web" non parte offline: aggiungerla alla Home con **"Apri come app web" spento** (iOS 26), così apre Safari, dove l'avvio offline funziona (verificato 2/11).
- Gli errori dell'app non devono mai far comparire "Mac non raggiungibile": usare `err.network` (non `!err.status`).
- **Registro del server in ritardo**: senza `PYTHONUNBUFFERED=1` (ora nel plist) uvicorn scriveva `logs/server.log` a blocchi → sembrava che il telefono non chiamasse il Mac. Con il plist aggiornato il registro è in tempo reale.
- **Telefono bloccato su una versione vecchia** (2/11: v19 mentre il Mac era a v25): la copia "prima la copia" + la cache HTTP di Safari rimettevano un index vecchio. Ora controllo di versione all'avvio, `no-store` su `/` e sw.js, install con `cache: "reload"`, pulsante Ripristina.
- ✅ **3/11: funziona** (Safari e icona della Home, iPhone iOS 26) dopo "🔄 Ripristina l'app" + chiudere e riaprire: a Mac spento l'app si apre dalla copia e una spesa aggiunta offline è arrivata nel file alla riaccensione. Se ricapita lo schermo vuoto o una versione vecchia: Impostazioni › Uso con il Mac spento → controllare Versione → Ripristina → chiudere e riaprire.

## Invio nelle finestre (3/11)
In un `<form method="dialog">` Invio preme il **primo** pulsante: era "Annulla" (o "Elimina" in categorie/abbonamenti), quindi Invio/"Vai" annullava il salvataggio. Ora Annulla/Elimina sono `type="button"` con `data-close="…"` (chiude con quel valore, gestore unico in app.js); `cd-delete` non ha `data-close` per la sua doppia conferma. La finestra "Vuoi eliminare?" (`confirm`) resta con Invio = Annulla, apposta. Nuove finestre: stessa regola.

## Mac spento: Storico vuoto e Budget "azzerato" (3/11)
- **Cosa**: le copie per il Mac spento si facevano solo delle pagine aperte con il Mac acceso, **in quella stessa app** (icona Home e Safari hanno memorie separate). Aprendo solo la Home, a Mac spento lo Storico diceva "irraggiungibile" e il Piano mostrava i campi vuoti (i dati nel file erano intatti).
- **Soluzione** (web v35): `warmOffline()` in app.js, 3 s dopo l'avvio e al rientro nell'app (al massimo ogni 10 min), scarica in sottofondo ultimi 6 mesi, anno, risparmi, profilo, piano/categorie/abbonamenti del primo mese pianificabile e fino a 10 viaggi, con gli **stessi percorsi** delle pagine (se cambia un percorso in una pagina, aggiornarlo anche qui). `OFF_MAX` 40 → 60.
- Provato su copia del file vero a 390 px: memoria vuota, solo Home aperta, poi Mac "spento" → Storico (Novembre, Ottobre, Anno) e Piano con i numeri e l'avviso "si possono solo guardare".
- Consiglio all'utente: usare sempre l'icona della Home, non Safari.
