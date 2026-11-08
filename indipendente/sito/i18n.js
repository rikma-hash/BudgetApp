"use strict";
/* Lingua dell'interfaccia. Il codice e l'HTML restano in italiano; se la lingua è inglese un traduttore
   cambia i testi mentre vengono disegnati (dizionario esatto + frasi con numeri/nomi). I dati dell'utente
   (categorie, descrizioni, nomi dei fogli Excel) non si traducono, tranne i nomi dei mesi.
   Per un testo nuovo: aggiungilo a EXACT (frase fissa) o a PATTERNS (frase con parti variabili). */

const LANG = (() => { try { return JSON.parse(localStorage.getItem("prefs") || "{}").lang || "it"; } catch { return "it"; } })();
const LOCALE = LANG === "en" ? "en-GB" : "it-IT";
document.documentElement.lang = LANG;

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_IT = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

const EXACT = {
  "Modifica": "Edit", "Note": "Notes", "Chiudi": "Close", "✓ Note salvate": "✓ Notes saved", "Note tolte": "Notes removed", "in attesa del Mac": "waiting for the Mac",
  "Scegli prima la categoria con Modifica": "First choose the category with Edit", "Togli l'avviso": "Dismiss",
  "＋ Mese": "＋ Month", "Per aggiungere un mese serve il Mac acceso": "Adding a month needs the Mac on",
  "Nuovo viaggio": "New trip", "✈️ Nuovo viaggio…": "✈️ New trip…", "Nome del viaggio": "Trip name",
  "Lo creo con le categorie di sempre (trasporto, alloggio, cibo…): il budget lo metti dopo, in Viaggi.": "I'll create it with the usual categories (transport, lodging, food…): set the budget later, in Trips.",
  // navigazione e titoli
  "Spese": "Expenses", "Ciao!": "Hi!", "Impostazioni": "Settings", "Categorie": "Categories", "Tutto →": "All →",
  "Ultime spese": "Latest expenses", "Storico →": "History →", "Storico": "History", "Importa": "Import", "Excel": "Excel",
  "Mese": "Month", "Anno": "Year", "Speso e budget per categoria": "Spent and budget by category",
  "Tocca un mese per vederne le spese.": "Tap a month to see its expenses.", "Budget": "Budget", "Piano": "Plan",
  "Risparmi": "Savings", "Home": "Home", "Viaggi": "Trips", "‹ Storico": "‹ History", "‹ Home": "‹ Home", "‹ Viaggi": "‹ Trips",
  "Caricamento…": "Loading…", "Carico…": "Loading…",
  // piano: colonne, totali, allarme · viaggi: copia budget · rate
  "Il tuo": "Yours", "Il tuo budget (somma)": "Your budget (total)", "✓ Tutto diviso": "✓ All assigned", "Disponibile": "Available",
  "Nelle categorie": "In categories", "Salvo…": "Saving…", "✓ Salvato": "✓ Saved", "✓ Salvato sul telefono": "✓ Saved on the phone", "Non salvato": "Not saved",
  "✨ Usa la proposta per tutte": "✨ Use the proposal for all", "✓ Messa la proposta in tutte le categorie": "✓ Proposal applied to all categories",
  "Scrivi il tuo budget: si salva da solo. Accanto c'è la cifra che ti propongo in base a quanto spendi di solito.":
    "Write your budget: it saves by itself. Next to it is the amount I suggest based on what you usually spend.",
  "📋 Copia il budget del mese in altri mesi": "📋 Copy this month's budget to other months", "📋 Copia questo budget in altri mesi": "📋 Copy this budget to other months",
  "Seleziona tutti": "Select all", "Togli tutti": "Clear all", "Questo mese non esiste ancora: salva prima il suo budget nel Piano.": "This month doesn't exist yet: save its budget in the Plan first.",
  "Aggiornamenti": "Updates", "Automatici": "Automatic", "Spenti": "Off", "Controlla ora": "Check now",
  "Serve il computer acceso per vedere gli aggiornamenti.": "The computer must be on to see updates.",
  "Questa copia è quella da cui pubblichi l'app su GitHub: si aggiorna con le tue modifiche, non in automatico. Gli aggiornamenti automatici valgono per chi l'ha installata dallo ZIP.":
    "This is the copy you publish the app from on GitHub: it updates with your changes, not automatically. Automatic updates are for people who installed it from the ZIP.",
  "Per attivarli rilancia una volta l'installatore (vedi la guida, \"Aggiornare l'app\"). Dopo non serve più.":
    "To turn them on, run the installer once more (see the guide, \"Updating the app\"). After that it's not needed.",
  "Il computer controlla ogni 6 ore se c'è una versione nuova e si aggiorna da solo (file Excel e dati restano).":
    "The computer checks every 6 hours for a new version and updates itself (Excel file and data stay).",
  "Le versioni nuove le installi tu riscaricando lo ZIP.": "You install new versions yourself by downloading the ZIP again.",
  "Versione nuova installata: l'app si riavvia…": "New version installed: the app is restarting…", "Hai già l'ultima versione": "You already have the latest version",
  "Proposto": "Proposed", "Messo": "Set", "Dovresti avere": "You should have", "Proposto (somma)": "Proposed (total)",
  "Messo ora (somma)": "Set now (total)", "Aggiusta": "Adjust", "Ignora": "Ignore", "Salva lo stesso": "Save anyway",
  "Le categorie sono più di quello che puoi spendere. Salvo lo stesso? (Annulla e tocca Aggiusta per farle rientrare.)":
    "The categories add up to more than you can spend. Save anyway? (Cancel and tap Adjust to fit them.)",
  "✓ Categorie aggiustate: rientri in quello che puoi spendere": "✓ Categories adjusted: you're within what you can spend",
  "Copia categorie e budget da": "Copy categories and budget from", "Nessuno": "None",
  "Il budget per categoria lo puoi cambiare dopo, dentro al viaggio.": "You can change the budget per category later, inside the trip.",
  "📋 Copia budget da un altro viaggio": "📋 Copy budget from another trip", "Copia budget": "Copy budget", "Copia": "Copy", "Da": "From",
  "Prendo categorie e budget da un altro viaggio. Quelle che ci sono già cambiano budget, le altre si aggiungono.":
    "I take categories and budgets from another trip. Existing ones get the new budget, the others are added.",
  "Non ci sono altri viaggi da cui copiare": "There are no other trips to copy from",
  // home
  "Imposta il budget": "Set the budget", "Oggi": "Today", "Ieri": "Yesterday", "Questa settimana": "This week",
  "Non hai ancora impostato il budget del mese.": "You haven't set this month's budget yet.",
  "Ancora nessuna spesa.": "No expenses yet.", "Tocca + per aggiungere la prima spesa.": "Tap + to add your first expense.",
  "Questa spesa è ancora in attesa: la puoi modificare quando arriva sul Mac.": "This expense is still waiting: you can edit it once it reaches the Mac.",
  "nessun budget": "no budget", "Totale del viaggio · tocca per aprirlo": "Trip total · tap to open",
  "Senza affitto": "Without rent", "Senza viaggi": "Without trips",
  // storico: mesi nascosti · viaggi: elimina categoria · piano: soldi sul conto
  "Non contare questo mese nei totali": "Don't count this month in the totals", "Conta di nuovo questo mese nei totali": "Count this month in the totals again",
  "non contato nei totali": "not counted in the totals", "Conferma": "Confirm", "— lasciale senza categoria —": "— leave them without category —",
  "Nessuna spesa in questa categoria. Premi Conferma per eliminarla.": "No expenses in this category. Press Confirm to delete it.",
  "🏦 Soldi sul conto": "🏦 Money in the account", "Soldi sul conto": "Money in the account", "＋ Aggiungi": "＋ Add", "Togli": "Remove", "Scrivi un importo": "Write an amount",
  "Il conto è tutto quello che hai; il budget è quanto decidi di spendere nel mese. Tocca per scrivere quanto hai.":
    "The account is everything you have; the budget is what you decide to spend in the month. Tap to write how much you have.",
  "Scrivi quanto hai adesso sul conto (o in totale). Le spese che registri dal giorno dopo le toglie l'app da sola.":
    "Write how much you have in the account now (or in total). Expenses you add from the next day on are subtracted by the app.",
  "Il Mac non è raggiungibile": "The Mac can't be reached",
  "Il Mac non è raggiungibile: le nuove spese restano sul telefono e partono dopo.": "The Mac can't be reached: new expenses stay on the phone and are sent later.",
  "Il Mac non è raggiungibile: spese e modifiche restano sul telefono e partono dopo. Se il Mac è acceso, controlla che Tailscale sia attivo sul telefono.": "The Mac can't be reached: expenses and changes stay on the phone and are sent later. If the Mac is on, check that Tailscale is active on the phone.",
  "Il file è aperto in Excel sul Mac: le spese verranno scritte quando lo chiudi.": "The file is open in Excel on the Mac: expenses will be written when you close it.",
  "Il file Excel sembra tornato a una versione vecchia (manca il foglio _Modello). Di solito succede quando Excel salva una copia rimasta aperta: chiudi Excel e chiedi di ripristinarlo.":
    "The Excel file seems to be back to an old version (the _Modello sheet is missing). This usually happens when Excel saves a copy left open: close Excel and ask to restore it.",
  // schermata +
  "Annulla": "Cancel", "Nuova spesa": "New expense", "Modifica spesa": "Edit expense", "Elimina": "Delete",
  "Dove la registro?": "Where do I record it?", "Spesa del mese": "Monthly expense", "Importo": "Amount",
  "Cosa hai comprato?": "What did you buy?", "Descrizione": "Description", "Frequenti": "Frequent", "Categoria": "Category",
  "Quando": "When", "Altra data": "Other date", "Dividi su più mesi": "Split over several months", "No": "No", "Scegli…": "Choose…",
  "Per quanti mesi": "How many months", "Un mese in meno": "One month less", "Numero di mesi": "Number of months",
  "Un mese in più": "One more month", "Oppure fino a": "Or until", "Ultimo mese": "Last month",
  "Aggiungi una nota": "Add a note", "Nota (facoltativa)": "Note (optional)", "Salva": "Save", "Salva modifiche": "Save changes",
  "Attuale": "Current", "Suggerite": "Suggested", "Tutte le categorie": "All categories", "Nuova categoria…": "New category…",
  "Usa": "Use", "nuova": "new", "consigliata": "recommended", "attuale": "current", "Nome (es. Trasporti)": "Name (e.g. Transport)",
  "· chiedo a Claude…": "· asking Claude…", "· suggerita da Claude": "· suggested by Claude",
  "Modifica salvata": "Changes saved", "Salvata sul telefono: la invio appena il Mac è raggiungibile": "Saved on the phone: I'll send it as soon as the Mac is reachable",
  "Eliminare la spesa?": "Delete the expense?", "Spesa eliminata": "Expense deleted", "Sei sicuro?": "Are you sure?",
  "Nuova categoria": "New category", "Creo": "Create", "Crea": "Create", "La trovi da questo mese in poi, anche in Excel.": "You'll find it from this month on, in Excel too.",
  "Budget al mese (€)": "Budget per month (€)", "Budget per il viaggio (€)": "Budget for the trip (€)", "Importo (€)": "Amount (€)",
  "Nome": "Name", "Sposta le spese in": "Move the expenses to", "Conferma": "Confirm", "— scegli —": "— choose —",
  "Excel è aperto: la scrivo appena lo chiudi": "Excel is open: I'll write it as soon as you close it",
  "Aggiungi spesa": "Add expense",
  // storico
  "Speso": "Spent", "Speso *": "Spent *", "Rimasto": "Left", "Avanzo": "Surplus", "Sforato": "Over", "Nessuna spesa né budget.": "No expenses or budget.",
  "Tutte": "All", "Senza data": "No date", "Nessuna spesa.": "No expenses.", "Nessuna spesa in questa categoria.": "No expenses in this category.",
  "Prossimi mesi": "Coming months", "da iniziare": "not started", "senza budget": "no budget", "Budget non ancora impostato": "Budget not set yet",
  "Surplus": "Surplus", "Deficit": "Deficit", "· in corso": "· in progress", "Apro il file in Excel": "Opening the file in Excel",
  "Apro Excel: il file è tra i recenti. Le modifiche fatte lì arrivano qui da sole.": "Opening Excel: the file is among the recent ones. Changes made there show up here by themselves.",
  // budget › piano
  "Rendi la proposta più tua": "Make the proposal yours", "Quanto ti entra questo mese?": "How much comes in this month?",
  "🎓 Borsa di studio": "🎓 Scholarship", "Borsa di studio": "Scholarship", "Budget personale": "Personal budget", "Aiuto famiglia": "Family help",
  "Altro": "Other", "Surplus/deficit mesi scorsi": "Surplus/deficit from past months", "Aggiungi": "Add", "Sottrai": "Subtract", "Ignora": "Ignore",
  "Deficit mesi scorsi": "Deficit from past months", "Surplus mesi scorsi": "Surplus from past months",
  "Nessun surplus o deficit dai mesi conclusi.": "No surplus or deficit from finished months.",
  "Quanto vuoi mettere da parte?": "How much do you want to set aside?", "Niente": "Nothing", "Oppure scrivi quanto": "Or type how much",
  "Metti da parte": "You set aside", "Inserisci prima le entrate al passo 1.": "Enter your income in step 1 first.",
  "Dividi tra le categorie": "Split among categories",
  "Ti propongo le cifre in base a quanto spendi di solito. Puoi cambiarle tutte.": "I suggest amounts based on what you usually spend. You can change all of them.",
  "＋ Nuova categoria": "＋ New category", "Usa lo stesso budget anche per i mesi dopo": "Use the same budget for the following months too",
  "Usa questo budget": "Use this budget", "Non ci sono ancora mesi conclusi: parto dai budget attuali.": "There are no finished months yet: I'm starting from the current budgets.",
  "nuova · si crea quando salvi": "new · created when you save", "spesa fissa": "fixed expense", "nessuno storico": "no history",
  "✓ Tutto assegnato": "✓ All assigned", "Entrate": "Income", "Da mettere da parte": "To set aside", "Puoi spendere": "You can spend",
  "non contato": "not counted", "Inizia scrivendo le entrate al passo 1.": "Start by entering your income in step 1.",
  "Scrivi il nome e quanto vuoi spendere al mese.": "Write the name and how much you want to spend per month.",
  "＋ Aggiungi entrata": "＋ Add income", "Nuova entrata": "New income", "Scrivi il nome e quanto ti entra al mese.": "Write the name and how much you get per month.",
  "Nessuna entrata ancora: aggiungi borsa, stipendio, aiuto da casa…": "No income yet: add scholarship, salary, help from home…",
  "Per togliere un'entrata scorrila a sinistra, oppure toccane il nome.": "To remove an income swipe it left, or tap its name.",
  "Sparisce dalle entrate di questo mese.": "It disappears from this month's income.",
  "Puoi avere al massimo 10 entrate": "You can have up to 10 incomes", "Premi «Usa questo budget» per salvarla": "Tap «Use this budget» to save it",
  "5 domande veloci": "5 quick questions", "Fatto · la proposta tiene conto delle tue risposte": "Done · the proposal takes your answers into account",
  "Cancella le risposte": "Clear the answers", "Quanto cucini a casa?": "How often do you cook at home?", "Quasi sempre": "Almost always",
  "A volte": "Sometimes", "Raramente": "Rarely", "Quanto esci (bar, serate, svago)?": "How often do you go out (bars, nights out, fun)?",
  "Poco": "Rarely", "Spesso": "Often", "Hai acquisti grandi in vista (vestiti, tecnologia)?": "Any big purchases coming (clothes, tech)?",
  "Qualcosa": "Something", "Sì": "Yes", "Hai viaggi in programma?": "Any trips planned?", "Uno piccolo": "A small one",
  "Sì, importanti": "Yes, big ones", "Cosa conta di più per te?": "What matters most to you?", "Risparmiare": "Saving",
  "Equilibrio": "Balance", "Stare tranquillo": "Peace of mind",
  // budget › categorie
  "Categorie ": "Categories", "Le tue categorie": "Your categories",
  "Tocca una categoria per rinominarla, cambiarne il budget o eliminarla. Nome ed eliminazione valgono per tutti i mesi; il budget per il mese scelto sopra.":
    "Tap a category to rename it, change its budget or delete it. Name and deletion apply to all months; the budget to the month chosen above.",
  "Scrivi il nome e il budget al mese.": "Write the name and the monthly budget.", "Categoria aggiornata": "Category updated",
  "Se ci sono spese in questa categoria (in qualunque mese), scegli dove spostarle. Poi premi Conferma.":
    "If there are expenses in this category (in any month), choose where to move them. Then press Confirm.",
  // budget › risparmi
  "📅 Questo mese": "📅 This month", "Questo mese": "This month", "Consigli sul budget": "Budget advice",
  "Categorie dove il budget non corrisponde a quanto spendi davvero.": "Categories where the budget doesn't match what you really spend.",
  "Dove puoi risparmiare": "Where you can save", "Tocca › per vedere i dettagli.": "Tap › to see the details.",
  "Chiedi un consiglio a Claude": "Ask Claude for advice", "Mese per mese": "Month by month", "Su cosa spendi di più": "What you spend most on",
  "Hai risparmiato finora": "Saved so far", "Finora sei in rosso di": "So far you're in the red by", "Contano solo i mesi conclusi.": "Only finished months count.",
  "Le voci": "The items", "Le spese che pesano di più": "The biggest expenses", "Servono almeno un paio di mesi di spese per i consigli.": "At least a couple of months of expenses are needed for advice.",
  "finora": "so far", "Nessun mese in corso.": "No month in progress.", "Per la vita di tutti i giorni puoi spendere": "For everyday life you can spend",
  "Al giorno, categoria per categoria": "Per day, category by category", "Speso finora": "Spent so far", "Puoi ancora spendere": "You can still spend",
  "A fine mese, a questo ritmo": "End of month, at this pace", "niente": "nothing",
  "Per recuperare, togli la stessa cifra da un'altra categoria nel Piano.": "To make up for it, take the same amount from another category in the Plan.",
  "Rallenta un po' per restare nel budget.": "Slow down a little to stay within budget.",
  "✓ Tutto sotto controllo: nessuna categoria vicina al limite.": "✓ All under control: no category close to the limit.",
  "Dal giorno 7 ti dico anche dove arrivi a fine mese al ritmo attuale.": "From day 7 I'll also tell you where you'll end the month at the current pace.",
  "avanza sempre": "always left over", "La tacca è il budget, la barra quanto hai speso.": "The mark is the budget, the bar is what you spent.",
  "Vedi le spese →": "See the expenses →", "Claude sta guardando le tue spese…": "Claude is looking at your expenses…",
  "Piccole spese (sotto 5 €)": "Small expenses (under €5)", "Abbonamenti ": "Subscriptions",
  "Caffè, snack e bibite: sono quelle che non si notano. Prova a segnarle tutte per un mese.": "Coffee, snacks and drinks: the ones you don't notice. Try writing them all down for a month.",
  "Per ognuno chiediti: l'ho usato questo mese? Se no, sospenderlo è il risparmio più facile.": "For each one ask yourself: did I use it this month? If not, pausing it is the easiest saving.",
  "in un anno": "in a year",
  // import
  "Importa spese": "Import expenses", "Dall'estratto conto della banca o dai movimenti della carta.": "From your bank statement or card transactions.",
  "Nell'app della banca o della carta scarica i movimenti in": "In your bank or card app, download the transactions as",
  "(va meglio) oppure in": "(works best) or as", "Salvalo in File:": "Save it to Files:", "Condividi › Salva su File": "Share › Save to Files",
  "Sceglilo qui sotto: ti mostro le spese con la categoria già proposta, tu controlli e confermi.": "Pick it below: I'll show you the expenses with a suggested category, you check and confirm.",
  "📄 Scegli il file": "📄 Choose the file", "Scegli il file": "Choose the file", "Seleziona tutte": "Select all", "Nessuna": "None", "Altro file": "Another file",
  "Trovate": "Found", "Scelte": "Selected", "Totale": "Total", "Non riesco ad aprire il file": "I can't open the file",
  "Non ho trovato spese in questo file. Prova con il CSV, se la banca lo permette.": "I didn't find any expenses in this file. Try the CSV, if your bank offers it.",
  "Controlla soprattutto le spese fatte in viaggio: vanno aggiunte dal viaggio.": "Check especially expenses made while travelling: add those from the trip.",
  "— categoria —": "— category —", "scegli la categoria ↓": "choose the category ↓", "Nessuna spesa scelta": "No expense selected",
  "Prima dell'inizio del budget": "Before the budget started", "File non leggibile": "File can't be read", "File troppo grande (max 8 MB)": "File too big (max 8 MB)",
  "Formato non riconosciuto: usa un file CSV o PDF": "Format not recognised: use a CSV or PDF file",
  "Non ho trovato movimenti in questo PDF: prova con il file CSV": "I found no transactions in this PDF: try the CSV file",
  "Non trovo le colonne Data e Importo in questo file CSV": "I can't find the Date and Amount columns in this CSV file",
  "Questo PDF non contiene testo (forse è una foto/scansione): scarica il CSV o un PDF dall'app": "This PDF has no text (maybe it's a photo/scan): download the CSV or a PDF from the app",
  // impostazioni
  "Valgono per questo dispositivo (iPhone e Mac si impostano a parte).": "They apply to this device (iPhone and Mac are set separately).",
  "Tema": "Theme", "Automatico": "Automatic", "Chiaro": "Light", "Scuro": "Dark",
  "Automatico segue il telefono (chiaro di giorno, scuro di sera se l'hai impostato così).": "Automatic follows the phone (light by day, dark in the evening if you set it that way).",
  "Colore": "Colour", "Dimensione del testo": "Text size", "Normale": "Normal", "Grande": "Large", "Molto grande": "Very large",
  "Pagina iniziale": "Start page", "La schermata che si apre quando avvii l'app.": "The screen that opens when you start the app.",
  "Lingua": "Language", "Verde": "Green", "Blu": "Blue", "Viola": "Purple", "Rosa": "Pink", "Arancio": "Orange", "Grafite": "Graphite",
  "Le parole dell'app. Categorie, descrizioni e file Excel restano come li hai scritti.": "The app's words. Categories, descriptions and the Excel file stay as you wrote them.",
  // viaggi
  "＋ Nuovo": "＋ New", "Nuovo viaggio": "New trip", "Dove vai? (es. Berlino)": "Where are you going? (e.g. Berlin)",
  "Il budget per categoria lo imposti dopo, dentro al viaggio.": "You set the budget per category later, inside the trip.", "Crea viaggio": "Create trip",
  "Le spese di un viaggio finiscono nel suo foglio Excel; il totale entra da solo nella categoria Viaggi del mese.":
    "A trip's expenses go into its own Excel sheet; the total goes automatically into the month's Viaggi category.",
  "＋ Aggiungi spesa al viaggio": "＋ Add expense to the trip", "Per categoria": "By category",
  "Tocca una categoria per impostarne il budget.": "Tap a category to set its budget.", "Elimina viaggio": "Delete trip",
  "Nessuna spesa ancora": "No expenses yet", "Nessun viaggio. Premi \"＋ Nuovo\" per crearne uno.": "No trips. Press \"＋ New\" to create one.",
  "Speso nel viaggio": "Spent on the trip", "Imposta un budget toccando le categorie qui sotto.": "Set a budget by tapping the categories below.",
  "Ancora nessuna spesa in questo viaggio.": "No expenses on this trip yet.", "Ti restano per il viaggio": "Left for the trip",
  "Hai superato il budget del viaggio di": "You went over the trip budget by", "Viaggio eliminato": "Trip deleted",
  "Spariscono il suo foglio Excel, le sue spese e le righe nei mesi. Non si può annullare.": "Its Excel sheet, its expenses and its rows in the months will disappear. This can't be undone.",
  "Senza categoria": "No category",
  "💳 Abbonamenti": "💳 Subscriptions",
  "Accendi quelli che vuoi inserire in automatico: ogni mese, nel loro giorno, diventano da soli una spesa nella categoria Abbonamenti. Tocca il nome per modificarlo.": "Switch on the ones to add automatically: every month, on their day, they become an expense in the Abbonamenti category by themselves. Tap the name to edit it.",
  "Inserisci in automatico": "Add automatically", "＋ Nuovo abbonamento": "＋ New subscription", "Nuovo abbonamento": "New subscription",
  "Abbonamento": "Subscription", "Giorno del mese": "Day of the month", "Nessun abbonamento.": "No subscriptions.", "Abbonamenti salvati": "Subscriptions saved",
  "Scrivi nome e importo": "Write name and amount", "Abbonamento inserito in automatico": "Subscription added automatically", "🔄 Ripristina l'app": "🔄 Reset the app", "Serve il Mac acceso per riscaricare l'app.": "The Mac must be on to download the app again.",
  "Riscarica l'app dal Mac (serve il Mac acceso). Spese in coda, dati e impostazioni restano.": "Downloads the app again from the Mac (the Mac must be on). Queued expenses, data and settings stay.", "Qualcosa non ha funzionato: riprova": "Something went wrong: try again", "Uso con il Mac spento": "Using it with the Mac off", "Controllo…": "Checking…",
  "✓ Pronta: puoi spegnere il Mac": "✓ Ready: you can switch off the Mac", "✗ Non ancora pronta": "✗ Not ready yet",
  "Indirizzo sicuro (https)": "Secure address (https)", "Copia dell'app attiva": "App copy active", "Protetta dalla pulizia di iOS": "Protected from iOS clean-up",
  "Apri l'app dall'icona con l'indirizzo https.": "Open the app from the icon with the https address.",
  "Con il Mac acceso chiudi e riapri l'app, poi apri Home, Storico e Budget e torna qui.": "With the Mac on, close and reopen the app, then open Home, History and Budget and come back here.",
  "L'app non riesce a partire.": "The app can't start.", "Apro l'app…": "Opening the app…",
  "· suggerita sul telefono": "· suggested on the phone",
  "Per modificare o eliminare una spesa serve il Mac acceso.": "To edit or delete an expense the Mac must be on.",
  // errori del server
  "Il file è aperto in Excel sul Mac: chiudilo e riprova": "The file is open in Excel on the Mac: close it and try again",
  "Il file è cambiato nel frattempo: ricarica e riprova": "The file changed in the meantime: reload and try again",
  "Mese non trovato": "Month not found", "Si apre solo dal Mac": "It only opens from the Mac",
  "Claude non è disponibile (installa Claude Code e fai il login)": "Claude isn't available (install Claude Code and log in)",
  "Il budget assistito funziona dai mesi con il modello nuovo": "The budget assistant works from months with the new template",
  "Foglio del viaggio pieno": "The trip sheet is full", "Questo nome non si può usare": "This name can't be used",
  "Scrivi il nuovo nome": "Write the new name", "Scrivi un nome per il viaggio": "Write a name for the trip", "Scrivi un nome per la categoria": "Write a name for the category",
  "La categoria Viaggi serve per i totali dei viaggi: non si può eliminare": "The Viaggi category holds the trip totals: it can't be deleted",
  "Le entrate si modificano solo nei mesi con il modello nuovo": "Income can only be changed in months with the new template",
  "Nei mesi vecchi (Settembre, Ottobre) la data non si modifica dall'app": "In the old months (September, October) the date can't be changed from the app",
  "Questa riga è il totale di un viaggio: modifica le spese dalla sezione Viaggi": "This row is a trip total: edit the expenses from the Trips section",
};

// frasi con parti variabili: [espressione, sostituzione]
const PATTERNS = [
  [/^✓ Aggiunto (.+): entrate e budget copiati dall'ultimo mese$/, "✓ Added $1: income and budget copied from the last month"],
  [/^✓ Viaggio (.+) creato$/, "✓ Trip $1 created"],
  [/^Senza (.+) · tocca l'occhio per rimetterl[oi]$/, "Without $1 · tap the eye to count again"],
  [/^Budget di (.+)$/, "$1 budget"],
  [/^In questa categoria ci sono (\d+) (spesa|spese): scegli dove spostarle, poi premi Conferma\.$/, "This category has $1 expense(s): choose where to move them, then press Confirm."],
  [/^Aggiornato: (.+) · (.+?)(?: · da allora spese per (.+))?\. Le entrate nuove non le vedo: tocca per aggiornare\.$/, (m, d, a, x) => `Updated: ${d} · ${a}${x ? ` · spent since then ${x}` : ""}. New income isn't tracked: tap to update.`],
  [/^Superi di (.+)$/, "Over by $1"],
  [/^Da dividere (.+)$/, "To assign $1"], [/^⚠️ Sfori di (.+)$/, "⚠️ Over by $1"], [/^Sfori di (.+)$/, "Over by $1"], [/^Restano (.+)$/, "$1 left"],
  [/^📋 Copia il budget di (.+) nei mesi dopo$/, "📋 Copy the $1 budget to the following months"],
  [/^Ti restano (.+) di (.+)$/, "$1 left of $2"], [/^Hai superato il budget di (.+) \((.+)\)$/, "Over budget by $1 ($2)"],
  [/^(\d+) (modifica fatta|modifiche fatte) a Mac spento: (parte|partono) appena il Mac risponde$/, (m, n) => `${n} ${n === "1" ? "change" : "changes"} made with the Mac off: sent as soon as the Mac answers`],
  [/^(\d+) (modifica fatta|modifiche fatte) a Mac spento (inviata|inviate)$/, (m, n) => `${n} ${n === "1" ? "change" : "changes"} made with the Mac off sent`],
  [/^Una modifica fatta a Mac spento non è andata: (.+)$/, "A change made with the Mac off didn't go through: $1"],
  [/^(.+) · sul telefono, arriva al Mac appena si accende$/, (m, a) => `${tr(a)} · on the phone, it reaches the Mac when it's on`],
  [/^Puoi spendere (.+) · nelle categorie (.+) · restano (.+)\.$/, "You can spend $1 · in categories $2 · $3 left."],
  [/^⚠️ Puoi spendere (.+), nelle categorie ci sono (.+): sfori di (.+)\.$/, "⚠️ You can spend $1, categories have $2: over by $3."],
  [/^Puoi spendere (.+) · le altre categorie hanno (.+) · per questa restano (.+)\.$/, "You can spend $1 · other categories have $2 · $3 left for this one."],
  [/^⚠️ Con (.+) sfori di (.+): puoi spendere (.+) e le altre categorie hanno già (.+)\.$/, "⚠️ With $1 you're over by $2: you can spend $3 and the other categories already have $4."],
  [/^(.+) tolta$/, "$1 removed"],
  [/^Copia il budget di (.+)$/, "Copy the budget of $1"], [/^Copia in (\d+) (mese|mesi)$/, (m, n) => `Copy to ${n} ${n === "1" ? "month" : "months"}`],
  [/^Non ci sono mesi dopo (.+)$/, "There are no months after $1"],
  [/^Il budget di tutte le categorie di (.+) va nei mesi che scegli\. Entrate e surplus\/deficit restano come sono\.$/, "The budget of every category in $1 goes to the months you choose. Income and surplus/deficit stay as they are."],
  [/^Il budget di (.+) a (.+) \((.+)\) va nei mesi che scegli\.$/, "The budget of $1 in $2 ($3) goes to the months you choose."],
  [/^✓ Budget (di .+ )?copiato in (\d+) (mese|mesi)$/, (m, c, n) => `✓ Budget ${c ? c.replace(/^di /, "of ") : ""}copied to ${n} ${n === "1" ? "month" : "months"}`],
  [/^Versione (\w+) · ultimo controllo (.+)$/, "Version $1 · last check $2"], [/^ultimo controllo (.+)$/, "last check $1"], [/^Versione ([0-9a-f]{7})$/, "Version $1"],
  [/^⚠️ Le categorie superano di (.+) quello che puoi spendere\.$/, "⚠️ The categories exceed what you can spend by $1."],
  [/^Le categorie superano di (.+) quello che puoi spendere \(hai scelto di ignorarlo\)\.$/, "The categories exceed what you can spend by $1 (you chose to ignore it)."],
  [/^Ho abbassato le variabili, ma le spese fisse superano ancora di (.+)$/, "I lowered the variable ones, but fixed costs still exceed by $1"],
  [/^✓ Copiate (\d+) categorie da (.+)$/, "✓ Copied $1 categories from $2"],
  [/^ per (\d+) mesi · da (.+) a (.+)$/, " for $1 months · from $2 to $3"],
  [/^Una rata al mese per (\d+) mesi, a partire dalla data scelta\. Scrivi l'importo per vedere quanto al mese\.$/, "One instalment a month for $1 months, from the chosen date. Enter the amount to see how much a month."],
  [/^Togliere (.+)\?$/, "Remove $1?"],
  [/^(.+) tolta · premi «Usa questo budget» per salvare$/, "$1 removed · tap «Use this budget» to save"],
  [/^(\d+) (?:spesa|spese) in attesa di essere scritte$/, (m, n) => `${n} ${n === "1" ? "expense" : "expenses"} waiting to be written`],
  [/^(.+) · settimana (\d)$/, "$1 · week $2"],
  [/^Ti restano questo mese(.*)$/, "Left this month$1"], [/^Hai superato il budget di(.*)$/, "Over budget by$1"],
  [/^Hai speso questo mese(.*)$/, "Spent this month$1"], [/^Speso (.+) di (.+)$/, "Spent $1 of $2"],
  [/^(\d+) giorni alla fine del mese$/, "$1 days to the end of the month"],
  [/^sforato di (.+)$/, "over by $1"], [/^sforata in (\d+) mesi su (\d+)$/, "over budget in $1 of $2 months"],
  [/^Salva (.+) in (\d+) rate$/, "Save $1 in $2 instalments"], [/^Salva (.+)$/, "Save $1"],
  [/^Una rata al mese per (\d+) mesi, a partire dalla data scelta\.$/, "One instalment a month for $1 months, from the chosen date."],
  [/^(\d+) rate da (.+) · da (.+) a (.+), una per mese$/, "$1 instalments of $2 · from $3 to $4, one per month"],
  [/^"(.+)" non salvata: (.+)$/, (m, d, e) => `"${d}" not saved: ${tr(e)}`],
  [/^(\d+) (?:spesa inviata|spese inviate) al Mac$/, (m, n) => `${n} ${n === "1" ? "expense" : "expenses"} sent to the Mac`], [/^Spostata in (.+)$/, "Moved to $1"],
  [/^✓ Salvata nel viaggio (.+)$/, "✓ Saved in trip $1"], [/^✓ Divisa in (\d+) rate in (.+)$/, "✓ Split into $1 instalments in $2"],
  [/^✓ Salvata in (.+?)( · nuovo mese creato)?$/, (m, c, n) => `✓ Saved in ${c}${n ? " · new month created" : ""}`],
  [/^La aggiungo al viaggio (.+), anche in Excel\.$/, "I'll add it to the trip $1, in Excel too."],
  [/^Settimana (\d)(.*)$/, "Week $1$2"],
  [/^finora restano (.+)$/, "$1 left so far"], [/^risparmiati (.+)$/, "$1 saved"], [/^in rosso di (.+)$/, "$1 in the red"],
  [/^Speso (.+) su budget non impostato$/, "Spent $1, no budget set"], [/^Speso (.+) su budget (.+)$/, "Spent $1 of a $2 budget"],
  [/^Entrate (.+) · (.+)$/, (m, a, b) => `Income ${a} · ${tr(b)}`], [/^Entrate (.+) − speso (.+)$/, "Income $1 − spent $2"],
  [/^Quanto ti entra a (.+)\?$/, "How much comes in for $1?"], [/^Usa lo stesso budget anche per i mesi dopo (.+)$/, "Use the same budget for the months after $1 too"],
  [/^Sei sotto di (.+): se lo sottrai, questo mese spendi meno per recuperare\. Puoi anche mettere una cifra più piccola\.$/,
    "You're short by $1: if you subtract it, you spend less this month to make up. You can also enter a smaller amount."],
  [/^Ti sono avanzati (.+): puoi aggiungerli a quello che spendi oppure lasciarli da parte\.$/, "You have $1 left over: you can add it to what you spend or keep it aside."],
  [/^(\d+)% delle entrate · in un anno (.+)$/, "$1% of income · $2 in a year"],
  [/^Di solito spendi (.+) al mese, più di quanto puoi spendere \((.+)\)\.$/, "You usually spend $1 a month, more than you can spend ($2)."],
  [/^Per starci dentro, le spese variabili scendono del (\d+)% rispetto al solito\.$/, "To fit, variable expenses go down by $1% compared to usual."],
  [/^Assegnato (.+)$/, "Assigned $1"], [/^Da assegnare (.+)$/, "To assign $1"], [/^Troppo: (.+)$/, "Too much: $1"],
  [/^Piano di (.+)$/, "Plan for $1"],
  [/^✓ Hai diviso tutto tra le categorie\. Risparmi (.+)\.$/, "✓ You've split everything among categories. You save $1."],
  [/^Ti restano (.+) da dividere tra le categorie\. Se li lasci così, risparmi (.+)\.$/, "You have $1 left to split among categories. If you leave it, you save $2."],
  [/^Le categorie superano di (.+) quello che puoi spendere\.$/, "The categories exceed what you can spend by $1."],
  [/^(\d) di (\d) risposte$/, "$1 of $2 answers"], [/^(\d+) domande veloci$/, "$1 quick questions"],
  [/^✓ Budget salvato in (\d+) mesi \(da (.+)\)$/, "✓ Budget saved in $1 months (from $2)"], [/^✓ Budget di (.+) salvato$/, "✓ $1 budget saved"],
  [/^Media (.+) al mese$/, "Average $1 a month"], [/^(-?\d+)% delle entrate$/, "$1% of income"],
  [/^puoi risparmiare (.+)\/mese$/, "you can save $1/month"],
  [/^(.+)\/mese · (.+) spese al mese$/, "$1/month · $2 expenses a month"],
  [/^Con il 30% in meno:$/, "With 30% less:"], [/^, cioè$/, ", that is"],
  [/^(\d+) volte$/, "$1 times"], [/^1 volta$/, "once"],
  [/^Sono circa (.+) spese al mese da (.+) € in media\. Basta farne (\d+) in meno al mese\.$/, "That's about $1 expenses a month of €$2 on average. Just make $3 fewer a month."],
  [/^In media (\d+) €\/mese\. Riducendo del 30% risparmi circa (\d+) €\/mese \((\d+) € in un anno\)\.$/, "On average €$1/month. Cutting 30% saves about €$2/month (€$3 a year)."],
  [/^(.+) €\/mese, cioè (\d+) € l'anno\. Controlla se li usi tutti\.$/, "€$1/month, that's €$2 a year. Check whether you use them all."],
  [/^(\d+) spese per (\d+) € in totale: sembrano poco, ma sono (\d+) €\/mese\.$/, "$1 expenses for €$2 in total: they seem little, but they're €$3/month."],
  [/^📅 (.+) · giorno (\d+) di (\d+)$/, "📅 $1 · day $2 of $3"], 
  [/^(.+) rimasti in (\d+) giorni \((?:senza affitto|without rent), abbonamenti e viaggi\)$/, "$1 left in $2 days (without rent, subscriptions and trips)"],
  [/^(\d+) categorie$/, "$1 categories"], [/^al ritmo attuale arrivi a (.+)$/, "at this pace you'll reach $1"], [/^usato il (\d+)%$/, "$1% used"],
  [/^(.+)\/g$/, "$1/day"], [/^consiglio (.+)$/, "suggested $1"], [/^basta (.+)$/, "$1 is enough"],
  [/^In media hai messo (.+) ma ne spendi (.+)\. Un budget di (.+) è più realistico: toglili da una categoria che avanza\.$/,
    "On average you budgeted $1 but you spend $2. A budget of $3 is more realistic: take it from a category with money left over."],
  [/^In media hai messo (.+) ma ne spendi (.+)\. Con (.+) liberi (.+) per altro o per il risparmio\.$/,
    "On average you budgeted $1 but you spend $2. With $3 you free up $4 for other things or savings."],
  [/^✓ A (.+) hai già messo (.+)$/, "✓ You already set $2 for $1"], [/^Usa (.+) a (.+?)( \(ora (.+)\))?$/, (m, a, b, c, d) => `Use ${a} for ${b}${c ? ` (now ${d})` : ""}`],
  [/^✓ (.+): (.+) a (.+)\. Controlla il Piano per il totale\.$/, "✓ $1: $2 for $3. Check the Plan for the total."],
  [/^Leggo (.+)…$/, "Reading $1…"], [/^(.+) · giorno (\d+)( · a mano)?( · ✓ inserito)?( · arriva il (\d+))?$/, (m, eu, d, man, ok, a, d2) => `${eu} · day ${d}${man ? " · manual" : ""}${ok ? " · ✓ added" : ""}${a ? ` · due on the ${d2}` : ""}`],
  [/^✓ Inseriti (\d+) abbonamenti: (.+)$/, "✓ Added $1 subscriptions: $2"], [/^✓ Inserito (.+)$/, "✓ Added $1"], [/^usato il (\d+)% · restano (.+)$/, "$1% used · $2 left"], [/^Versione (.+)$/, "Version $1"], [/^File salvati nel telefono \((\d+)\)$/, "Files saved on the phone ($1)"], [/^Dati salvati \((\d+) pagine\)$/, "Data saved ($1 pages)"],
  [/^Stai vedendo i dati del (.+): quello che cambi parte appena il Mac risponde\.$/, "You're seeing the data from $1: what you change is sent as soon as the Mac answers."],
  [/^(\d+) (?:spesa sembra già registrata|spese sembrano già registrate) \(stessa cifra, data vicina\): (?:l'ho lasciata|le ho lasciate) fuori\.$/,
    (m, n) => `${n} ${n === "1" ? "expense seems" : "expenses seem"} already recorded (same amount, nearby date): left out.`],
  [/^(\d+) (?:spesa è di un mese|spese sono di mesi) che non posso modificare\.$/, (m, n) => `${n} ${n === "1" ? "expense is from a month" : "expenses are from months"} I can't change.`],
  [/^(\d+) (?:entrata|entrate) \(accrediti, bonifici ricevuti\) non (?:la|le) importo\.$/, (m, n) => `${n} income ${n === "1" ? "item" : "items"} (credits, transfers received) not imported.`],
  [/^(\d+) spese$/, "$1 expenses"], [/^(\d+) spesa$/, "$1 expense"],
  [/^già presente: (.+)$/, "already recorded: $1"], [/^(.+) è un mese vecchio: si modifica solo in Excel$/, "$1 is an old month: change it only in Excel"],
  [/^Scegli la categoria di (\d+) (?:spesa|spese)$/, (m, n) => `Choose the category of ${n} ${n === "1" ? "expense" : "expenses"}`],
  [/^Aggiungi (\d+) (?:spesa|spese) \((.+)\)$/, (m, n, t) => `Add ${n} ${n === "1" ? "expense" : "expenses"} (${t})`],
  [/^✓ (\d+) spese aggiunte \((.+)\)$/, "✓ $1 expenses added ($2)"], [/^All'avvio si aprirà (.+)$/, "$1 will open at start"],
  [/^Categoria eliminata(?: · (\d+) spese spostate in (.+))?$/, (m, n, c) => `Category deleted${n ? ` · ${n} expenses moved to ${c}` : ""}`],
  [/^Categoria (.+) creata$/, "Category $1 created"], [/^Categoria (.+) aggiunta al viaggio$/, "Category $1 added to the trip"],
  [/^✓ Viaggio (.+) creato \(anche in Excel\)$/, "✓ Trip $1 created (in Excel too)"],
  [/^Quanto vuoi spendere per (.+) in questo viaggio\?$/, "How much do you want to spend on $1 on this trip?"],
  [/^Nome e budget per il viaggio (.+) \(il budget puoi lasciarlo a 0\)\.$/, "Name and budget for the trip $1 (you can leave the budget at 0)."],
  [/^Eliminare il viaggio (.+)\?$/, "Delete the trip $1?"], [/^Budget · (.+)$/, "Budget · $1"],
  [/^Categoria '(.+)' inesistente$/, "Category '$1' doesn't exist"], [/^Categoria del viaggio '(.+)' non trovata$/, "Trip category '$1' not found"],
  [/^Viaggio '(.+)' non trovato$/, "Trip '$1' not found"], [/^Esiste già un viaggio chiamato '(.+)'$/, "There's already a trip called '$1'"],
  [/^Esiste già una categoria '(.+)'$/, "There's already a category '$1'"], [/^La categoria '(.+)' esiste già$/, "The category '$1' already exists"],
  [/^La categoria '(.+)' c'è già in questo viaggio$/, "The category '$1' is already in this trip"],
  [/^Un viaggio può avere al massimo (\d+) categorie$/, "A trip can have at most $1 categories"],
  [/^Non riesco a leggere il file \((.+)\)$/, "I can't read the file ($1)"], [/^Foglio '(.+)' pieno$/, "Sheet '$1' is full"],
  [/^'(.+)' ha delle spese in (.+): scegli in quale categoria spostarle$/, "'$1' has expenses in $2: choose which category to move them to"],
  [/^Rata (\d+) di (\d+) · totale (.+)$/, "Instalment $1 of $2 · total $3"],
  [/^Da estratto conto(.*)$/, "From bank statement$1"],
  // generici: per ultimi, così non "rubano" le frasi più specifiche qui sopra
  [/^restano (.+)$/, "$1 left"], [/^di solito (.+)$/, "usually $1"], [/^di (.+)$/, "of $1"], [/^Budget (.+)$/, "Budget $1"],
  [/^(.+)\/mese ·$/, "$1/month ·"], [/^(.+)\/mese$/, "$1/month"], [/^(.+) al mese$/, "$1 a month"], [/^(.+) al giorno$/, "$1 a day"],
  [/^(.+) in un anno$/, "$1 in a year"],
  [/^(.+) · (\d+) (spesa|spese)$/, (m, a, n) => `${tr(a)} · ${n} ${n === "1" ? "expense" : "expenses"}`],
  [new RegExp(`^(${MONTHS_IT.join("|")})( \\d{4})?$`), (m, mo, y) => MONTHS_EN[MONTHS_IT.indexOf(mo)] + (y || "")],
  [/^(.+) al mese$/, "$1 a month"],  // generica: in fondo, dopo le frasi più precise
];

// pezzi che compaiono dentro frasi più lunghe (dati inclusi), sostituiti ovunque
const FRAGMENTS = [[" · in attesa", " · waiting"], [" · spesso sforata", " · often over"], ["(senza affitto", "(without rent"],
  ["(senza viaggi", "(without trips"], [", senza viaggi", ", without trips"], [" (nuova)", " (new)"]];

const monthsToEn = (s) => s.replace(new RegExp(`\\b(${MONTHS_IT.join("|")})\\b`, "g"), (mo) => MONTHS_EN[MONTHS_IT.indexOf(mo)]);

/** Traduce un testo (in italiano restituisce lo stesso testo). */
function tr(s) {
  if (LANG !== "en" || !s) return s;
  if (EXACT[s]) return EXACT[s];
  // emoji/simboli all'inizio e spazi ai lati restano dove sono
  const m = /^([\s\p{Extended_Pictographic}\uFE0F\u200D＋✓⏳·]*)([\s\S]*?)(\s*)$/u.exec(s);
  const [pre, core, post] = m ? [m[1], m[2], m[3]] : ["", s, ""];
  const frag = (x) => FRAGMENTS.reduce((acc, [a, b]) => acc.split(a).join(b), x);
  const full = frag(s.trim()), bare = frag(core);
  if (EXACT[full]) return EXACT[full];
  if (EXACT[bare]) return pre + EXACT[bare] + post;
  for (const [re, rep] of PATTERNS) {
    if (re.test(full)) return s.match(/^\s*/)[0] + monthsToEn(full.replace(re, rep)) + post;
    if (re.test(bare)) return pre + monthsToEn(bare.replace(re, rep)) + post;
  }
  return bare === core ? s : pre + bare + post;
}

// ---------- traduzione della pagina mentre viene disegnata ----------
const ATTRS = ["placeholder", "aria-label", "title"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);

function trNode(n) {
  if (n.nodeType === 3) {
    if (!n.parentNode || SKIP.has(n.parentNode.nodeName) || !/[A-Za-zÀ-ú]/.test(n.data)) return;
    const t = tr(n.data);
    if (t !== n.data) n.data = t;
  } else if (n.nodeType === 1) {
    if (SKIP.has(n.nodeName)) return;
    for (const a of ATTRS) {
      const v = n.getAttribute(a);
      if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); }
    }
    for (const c of n.childNodes) trNode(c);
  }
}

if (LANG === "en") {
  const start = () => {
    trNode(document.body);
    document.title = tr(document.title);
    new MutationObserver((list) => {
      for (const mu of list) {
        if (mu.type === "characterData") trNode(mu.target);
        else if (mu.type === "attributes") trNode(mu.target);
        else mu.addedNodes.forEach(trNode);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}
