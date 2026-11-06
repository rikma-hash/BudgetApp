# Spese · versione indipendente

La stessa app delle spese, ma **senza computer acceso**: niente Python, niente Tailscale, niente installazione.
È un sito (cartella `sito/`) e i dati stanno in un database online gratuito (**Supabase**), con login.
Il file Excel non è più l'archivio: lo **scarichi** quando vuoi (Impostazioni ⚙️ › Scarica Excel) e puoi
**importare** il Budget_Tracker della versione con il computer (Impostazioni ⚙️ › Importa dal vecchio Excel).

Senza Supabase funziona lo stesso in modalità **"senza account"**: i dati restano solo nel browser.

## Come è fatta
L'interfaccia è **la stessa della versione con il computer** (`web/`): `costruisci.py` la copia in `sito/`, cambia le
poche scritte che parlano del Mac e aggiunge:

| File (in `src/`) | A cosa serve |
|---|---|
| `server.js` | "server nel telefono": risponde alle stesse chiamate `/api/…` del server Python, con i dati dell'archivio |
| `store.js` | archivio nel telefono, sincronizzato con Supabase; senza rete le modifiche restano in coda e partono dopo |
| `login.js`, `login.html`, `settings.html` | accesso, account, Excel e sincronizzazione nelle Impostazioni |
| `excel.js` | importa il vecchio Excel (mesi, viaggi, entrate, abbonamenti) e crea quello da scaricare |
| `importer.js` | estratto conto CSV/PDF (come `server/importer.py`) |
| `extra.css` | stili in più |

Altri file: `config.js` (indirizzo e chiave pubblica di Supabase), `supabase/schema.sql` (tabelle e regole),
`vendor/` (librerie Supabase e SheetJS, servite dal sito così funzionano anche senza rete).

**Dopo ogni modifica a `web/` o a `src/`**: `~/.local/bin/uv run --no-project python indipendente/costruisci.py`
(rigenera `sito/`). Se una scritta dell'app è cambiata, lo script si ferma e dice quale: va aggiornato `APP_TEXT`.

## Collegarla a Supabase (una volta sola)
1. **supabase.com** → account → **New project** (regione *Central EU (Frankfurt)*; la password del database tienila per te).
   Nella creazione: *Enable Data API* sì, *Automatically expose new tables* no, *Enable automatic RLS* sì.
2. **SQL Editor** → incolla tutto `supabase/schema.sql` → **Run**. Rilancialo quando cambia (non cancella dati).
3. **Authentication › Sign In / Providers › Email**: attivo; togli *Confirm email* se non vuoi l'email di conferma.
4. **Project Settings › API Keys**: *Project URL* e chiave *publishable* (o *anon*) in `config.js`. Mai la chiave *secret*.

## Pubblicarla (gratis) per usarla dall'iPhone
- **Vercel** (piano Hobby): *Add New › Project* → repository GitHub → lascia la cartella principale (*root*),
  Framework *Other*. Il file `vercel.json` nella cartella principale del ramo dice a Vercel di pubblicare **solo**
  `indipendente/sito` come sito statico (senza, Vercel vede `pyproject.toml` e prova ad avviare il server Python).
  La prima pubblicazione (dal ramo `main`) fallisce: è normale.
- **Settings › Environments › Production › Branch Tracking** (o *Git › Production Branch*): `prova-supabase`.
- **Settings › Deployment Protection › Vercel Authentication**: spento. Anche "Standard Protection" chiede il login
  Vercel sull'indirizzo `….vercel.app`; i dati restano protetti dal login di Supabase.
- In Supabase › **Authentication › URL Configuration** metti l'indirizzo di Vercel come *Site URL*.
- Sull'iPhone: apri l'indirizzo in Safari → Condividi → **Aggiungi alla schermata Home**.

## Differenze dalla versione con il computer
- Mancano i consigli scritti da Claude (servirebbe una chiave API a pagamento) e il suggerimento con l'IA.
- Le categorie sono uguali per tutti i mesi (nel file Excel ogni mese poteva averne di diverse).
- Supabase gratuito mette in pausa un progetto che nessuno usa per 7 giorni (si riattiva dal sito).
