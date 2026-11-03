# 02 · Il file Excel

`Budget_Tracker_Modello.xlsx` (iCloud Drive › excel). Ordine dei fogli:

`Viaggi` · `✈ <nome viaggio>`… · `Riassunto Annuale` · `Settembre` · `Ottobre` · `Novembre` · `Dicembre` … `Luglio` · `_Modello` (nascosto) · `_ModelloViaggio` (nascosto)

## Mesi con il modello VECCHIO (Settembre, Ottobre) — sola lettura
- Scritti a mano dall'utente. L'app li legge ma **non li modifica** (eccetto descrizione/importo/categoria/nota di una spesa; la data no).
- Settembre: intestazioni riga 8, spese da riga 9, budget categorie in G9:H17, totale in riga 91 ("TOTALE SPESO:").
- Ottobre: intestazioni riga 9, spese da riga 10, budget categorie H10:I18.
- Colonna A = numero settimana scritto a mano (settimane lun–dom in Settembre).
- Nel Riassunto i loro valori sono numeri scritti a mano (possono differire di pochi centesimi dalla somma delle spese; esempio in `privato.md`).

## Mesi con il modello NUOVO (Novembre → Luglio) — costruiti da `_Modello`
| Zona | Celle | Note |
|---|---|---|
| Titolo | A1 | `📊 TRACKER SPESE - NOVEMBRE` |
| Entrate | B2 borsa · B3 budget personale · B4 aiuto famiglia · E2 borsa ricevuta | |
| Riporto | A5 "Surplus/deficit riportato:" · **B5** importo | conta solo se B6 lo include |
| Budget totale | **B6** | `=B2+B3+B4` (+`B7` se ci sono altre entrate, +`B5` se il riporto è incluso): l'app la riscrive a ogni salvataggio del Piano |
| Altre entrate | **A7** "Altre entrate:" · **B7** importo | scritte solo nei mesi in cui si usano ("＋ Altro" nel Piano); B7 conta solo se A7 ha quell'etichetta; copiate nei mesi nuovi |
| Entrate **a lista** (solo modello vuoto per gli amici) | **H37** "💶 ENTRATE DEL MESE" · **H38:I47** 10 voci nome/importo · H48/I48 TOTALE `=SUM(I38:I47)` · A2 "Entrate del mese (tabella in H37):" · B2 `=I48` · B6 `=B2` (+`B5`) | riconosciuta da `income_list_mode()` (titolo in H37). Il file dell'utente NON ce l'ha: resta con B2–B4 + A7/B7. Copiate nei mesi nuovi. Creata da `make_income_list()` |
| Transazioni | righe **10–509**: A settimana (formula) · B data · C descrizione · D importo · E categoria · F nota | A = `=IF(B="","","Sett "&MIN(5,INT((DAY(B)-1)/7)+1))` → Sett 1 = giorni 1–7 … **Sett 5 = 29–31** |
| Tabella budget | H9:P9 intestazioni; **H10:H24 = 15 slot categoria** (vuoti = liberi); I budget; J–N Sett1–5 (SUMIFS); O totale; P surplus | formule con `IF($H="","",…)` |
| Totali | riga 25 TOTALE · riga 26 TOTALE (senza affitto) | |
| Abbonamenti programmati | H29 titolo, H30:J34 (nome, importo, casella), I35 totale | valori dell'utente in `privato.md`; nel modello vuoto sono vuoti |
| Regole | menu a tendina E10:E509 → $H$10:$H$24 · formattazione rossa se P < 0 | |

Categorie standard: Affitto, Spesa, Mensa, Lavatrici/Asciugatrice, Abbigliamento, Abbonamenti, Viaggi, Svago, Varie (+ quelle create dall'app, es. Trasporti). Il confronto dei nomi è **senza maiuscole/minuscole**.

### Riga-viaggio nei mesi
Per ogni mese in cui un viaggio ha spese c'è **una** riga: C `✈️ Viaggio: <nome>`, E `Viaggi`, F nota automatica, D formula
`=SUMIFS('✈ Nome'!$C$4:$C$503,'✈ Nome'!$A$4:$A$503,">="&DATE(a,m,1),'✈ Nome'!$A$4:$A$503,"<"&DATE(a2,m2,1))`.
L'app la riconosce (regex `LINK_RE` in `trips.py`) e calcola il valore in Python. Non si modifica dall'app: si modificano le spese del viaggio.

## `Riassunto Annuale`
- A4… mesi, B budget pianificato, C speso, D surplus. Settembre/Ottobre numeri; da Novembre formule `='Mese'!I25` e `='Mese'!O25`. Riga TOTALE subito dopo l'ultimo mese.
- Colonne F–L: tabellina personale dell'utente (non toccarla).
- I mesi futuri hanno budget pianificato ma speso 0: nell'app **non contano** nei totali (flag `future`).

## Viaggi
- `Viaggi` (riepilogo): A3 intestazioni, righe 4–33 = un viaggio per riga (A nome, B `='✈ X'!H12`, C `='✈ X'!I12`, D surplus, E note), riga 34 TOTALE.
- `✈ <nome>` (uno per viaggio, dal template dell'utente): A1 titolo, A2 istruzioni, **A3:E3** Data | Descrizione | Importo | Categoria | Note, spese righe **4–503**; **G4:G11** 8 categorie, H budget (celle gialle), I speso (SUMIFS), J surplus; riga 12 TOTALE. Menu a tendina D → G4:G(TOTALE−1).
- **Categorie aggiunte dall'app**: se non c'è una riga vuota, la riga TOTALE scende di una (max 20 categorie, `trips.MAX_CATS`) e la nuova categoria prende il suo posto con lo stile della riga sopra. La riga TOTALE si trova con `trips.tot_row(ws)` (cerca "TOTALE" in G): **non usare più 12 fisso**. Il riepilogo `Viaggi` punta a H/I della riga TOTALE vera.
- Categorie del template: Trasporto Principale, Trasporto Locale, Alloggio, Cibo Ristorazione, Cibo Spesa, Intrattenimento / Attività, Shopping e Personale, Imprevisti Commissioni. (un viaggio importato può avere categorie proprie)
- Un viaggio importato i cui movimenti sono già scritti uno per uno in un mese vecchio non ha riga-viaggio in quel mese (eviterebbe il doppio conteggio). Caso reale in `privato.md`.
- Nomi foglio: prefisso `✈ ` + nome pulito (max 28 caratteri, senza `[]:*?/\'`).

## Regole d'oro
1. Mai scrivere sul file mentre Excel lo tiene aperto (vedi 05-problemi-noti).
2. Mai toccare `_Modello`, `_ModelloViaggio`, le formule delle tabelle, la posizione delle tabelle.
3. Prima di ogni scrittura il server fa una copia in `backups/`; `wb.calculation.fullCalcOnLoad = True` fa ricalcolare Excel all'apertura (openpyxl non salva i valori delle formule).
4. openpyxl perde le caselle di spunta native di Excel (diventano VERO/FALSO) e il calcChain: accettato.
