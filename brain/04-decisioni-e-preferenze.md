# 04 · Decisioni e preferenze dell'utente

## Come lavorare con l'utente
- Scrive in **italiano**, spesso di fretta (refusi, frasi a metà): se una frase si interrompe, chiedi cosa intendeva.
- Non è uno sviluppatore: spiegazioni semplici, niente gergo, passi numerati quando deve fare qualcosa lui.
- Usa soprattutto l'**iPhone** (app sulla schermata Home). Ogni modifica all'interfaccia va provata a **390 px di larghezza**, chiaro e scuro.
- Vuole un'interfaccia **facile e intuitiva** ("non mi piace il layout, fammelo facile"): numeri grandi, pochi testi, pulsanti grandi, niente menu nascosti.
- È aperto a suggerimenti, ma le decisioni sui suoi dati le prende lui: chiedi prima di cancellare/spostare fogli o cambiare il file vero.
- Prova sempre su una **copia** (`test/`) prima del file vero.

## Decisioni prese (e perché)
| Tema | Decisione | Perché |
|---|---|---|
| Dispositivi | iPhone + Mac, server sul Mac, accesso con Tailscale | Il file è su iCloud e Excel non accetta scritture da telefono |
| IA | Claude tramite **abbonamento** (Claude Code CLI), non API a pagamento | Richiesta esplicita dell'utente |
| Suggerimento | Storico + parole chiave + IA solo se incerto | "Fammi un incrocio di entrambe" |
| Categorie nuove | Le propone l'app, l'utente conferma | "Lascia decidere all'app" |
| Settimane | Giorni del mese 1–7, 8–14, 15–21, 22–28, **29–31 = Sett 5** | Scelta dell'utente |
| Mesi | Inizialmente creati al bisogno; poi l'utente ha chiesto **tutti fino a Luglio** | Il suo budget va fino a Luglio (dettagli in privato.md) |
| Settembre/Ottobre | Non si modificano (struttura vecchia, settimane scritte a mano) | Sono storico |
| Surplus/deficit | Riga nel Budget: l'utente sceglie se aggiungerlo/sottrarlo e quanto | "Posso decidere di aggiungerlo o sottrarlo" |
| Categorie | Rinominare, eliminare, cambiare budget, cambiare categoria di una spesa | Tutte richieste |
| Totali | Pulsanti "senza affitto" e "senza viaggi" | Richiesta |
| Viaggi | Un foglio per viaggio **nel file del budget** (template dell'utente), riepilogo nel foglio `Viaggi`, **una riga per viaggio per mese** in categoria Viaggi | Scelte dell'utente |
| Schermata + | **Elenco** di categorie (la griglia "si buggava"), pagina intera, Salva fisso | Problemi reali sull'iPhone |
| Piano budget | Scala Entrate → Da parte → Mesi scorsi → **Puoi spendere**; risparmio mostrato in €/mese e €/anno; quiz che regola la proposta | "Distinzione chiara tra budget e quanto voglio spendere" (2/11) |
| Altre voci budget | "＋ Nuova categoria" nel passo ③; **"💶 Altro" è un'entrata**, riga sempre visibile nel passo ① (non una categoria, non dietro un pulsante) | Richieste 2/11 |
| Estratto conto | Per ora solo **file CSV/PDF scaricati dall'app della banca** (niente collegamento diretto alla banca) | Scelta dell'utente 2/11 |
| Lingua | Italiano (principale) + inglese tradotto a schermo; i dati restano come scritti | Richiesta 2/11 |
| Abbonamenti automatici | **Scelta per singolo abbonamento** (interruttore su ognuno), tutti spenti di base | "Vorrei scegliere quali" (3/11) |
| Navigazione | Home · Storico · ＋ · Viaggi · Budget (Piano/Categorie/Risparmi) | Max 5 voci in basso |

## Lista dell'utente del 2/11 (da fare, in ordine)
Fatto: blocco 1 Budget (2/11), blocco 2 Consigli con frecce (2/11), blocco 3 categorie nei viaggi (2/11), blocco 4 rate + import estratto conto CSV/PDF (2/11), blocco 5 Mac + impostazioni + inglese (2/11). Fatto anche il blocco 6 (3/11): GitHub privato con deploy key, uso con il Mac spento. Restano solo le idee qui sotto e la prova dell'import con un estratto conto vero.

## Idee proposte non ancora fatte
- Usare le categorie "suggerite" anche per le spese di viaggio.

## Modifiche: per chi? (3/11)
- **Prima di ogni modifica chiedere**: solo l'app dell'utente, solo il modello GitHub (amici) o entrambi. Il codice è unico: le differenze si legano al file Excel (es. `income_list_mode`: entrate fisse per l'utente, a lista nel modello vuoto) o a `data/` (mai su GitHub).
- Dopo ogni modifica: commit + push su `main`. **Gli amici però si aggiornano da soli solo dal ramo `stabile`** (dal 4/11): dopo il push chiedere all'utente **"Pubblico anche per gli amici?"** e solo con il suo sì fare `git push origin main:stabile` (entro 6 ore arriva a tutti). Mai pubblicare su `stabile` qualcosa non provato.

## Licenza (3/11)
- Gli altri possono **usare** l'app (gratis, uso personale) ma **non modificarla** né ridistribuirla modificata: `LICENSE` "uso personale", non open source. Le modifiche al codice le fa solo l'utente (è l'unico che può scrivere nel repository GitHub).
