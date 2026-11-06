# Spese · versione indipendente (prova)

L'app delle spese che **non ha bisogno del Mac**: niente Python, niente Tailscale, niente installazione.
È una pagina web (questa cartella) e i dati stanno in un database online gratuito (**Supabase**), con login.
Il file Excel non è più l'archivio: lo **scarichi** quando vuoi (Altro › Scarica Excel) e puoi **importare** il vecchio Budget_Tracker.

Senza Supabase collegato funziona lo stesso in modalità **"senza account"**: i dati restano solo nel browser.

## Cosa c'è
| File | A cosa serve |
|---|---|
| `index.html`, `style.css`, `extra.css` | schermate (stesso aspetto dell'app con il Mac) |
| `app.js` | Home, Storico, Budget, Altro, finestra per aggiungere/modificare le spese |
| `store.js` | dove stanno i dati: Supabase (`cloud`) o solo nel browser (`demo`) |
| `suggest.js` + `keywords.json` | categoria suggerita (spese passate + parole chiave), tutto nel telefono |
| `excel.js` | importa il vecchio Excel e crea quello da scaricare (libreria SheetJS) |
| `config.js` | indirizzo e chiave pubblica di Supabase |
| `supabase/schema.sql` | le tabelle del database e le regole "ognuno vede solo i suoi dati" |
| `sw.js`, `manifest.webmanifest` | aggiunta alla schermata Home e apertura anche senza rete |

## Collegarla a Supabase (una volta sola, ~10 minuti)
1. Vai su **supabase.com** → crea un account → **New project**. Regione: *Central EU (Frankfurt)*. La password del database tienila per te: all'app non serve.
2. Nel progetto: **SQL Editor** → *New query* → incolla tutto `supabase/schema.sql` → **Run**.
3. **Authentication › Sign In / Providers › Email**: deve essere attivo. Se vuoi evitare l'email di conferma alla registrazione, togli *Confirm email*.
4. **Project Settings › API Keys**: copia il *Project URL* e la chiave pubblica (*anon* o *publishable*) in `config.js`.
   La chiave **service_role / secret** non va mai messa qui.
5. Apri l'app → **Crea un account nuovo** → poi **Altro › Importa dal vecchio Excel**.

## Pubblicarla (gratis) per usarla dall'iPhone
- **Vercel** (vercel.com, piano Hobby): *Add New › Project* → importa il repository GitHub → **Root Directory: `indipendente`**, Framework *Other*, nessun comando di build. Ramo: `prova-supabase`.
- Poi in Supabase › **Authentication › URL Configuration** metti l'indirizzo che ti dà Vercel come *Site URL* (serve per i link delle email).
- Sull'iPhone: apri l'indirizzo in Safari → Condividi → **Aggiungi alla schermata Home**.

## Limiti di questa prova
- Mancano rispetto all'app con il Mac: viaggi come cartelle separate (le spese dei viaggi importati finiscono in *Viaggi*), rate, piano con proposta, risparmi e consigli, abbonamenti automatici, import dell'estratto conto, consigli di Claude.
- A rete assente si possono **guardare** i dati salvati nel telefono, ma non aggiungere spese (non c'è ancora la coda).
- Supabase gratuito **mette in pausa** un progetto che nessuno usa per 7 giorni (si riattiva dal sito); usandola ogni giorno non succede.
