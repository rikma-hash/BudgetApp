"""Crea il modello vuoto (stessa struttura, nessun dato personale) da un file del budget già migrato.

Uso:  uv run python scripts/make_blank.py <file.xlsx> modello/Budget_Tracker_vuoto.xlsx
Tiene solo _Modello, _ModelloViaggio, Riassunto Annuale e Viaggi; i mesi li crea l'app alla prima spesa.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server import excel as X  # noqa: E402
from server import trips as T  # noqa: E402

STANDARD = ["Affitto", "Spesa", "Mensa", "Lavatrici/Asciugatrice", "Abbigliamento", "Abbonamenti", "Viaggi", "Svago", "Varie"]
KEEP = [X.TEMPLATE, T.TEMPLATE, X.SUMMARY, T.SUMMARY]


def main(src: Path, dst: Path) -> None:
    wb = X.load(src)
    for name in list(wb.sheetnames):
        if name not in KEEP:
            del wb[name]

    m = wb[X.TEMPLATE]
    m["A1"] = "📊 TRACKER SPESE - MODELLO"
    for coord in ("B2", "C2", "E2", "B3", "B4", "B5", "A7", "B7"):
        m[coord] = None
    X.make_income_list(m)  # entrate libere (＋ nel Piano) al posto di borsa/budget personale/aiuto famiglia
    for i, r in enumerate(range(X.CAT_FIRST, X.CAT_LAST + 1)):
        m.cell(r, 8).value = STANDARD[i] if i < len(STANDARD) else None
        m.cell(r, 9).value = None
    for r in range(X.SUB_FIRST, X.SUB_LAST + 1):  # abbonamenti programmati
        for col in (8, 9, 10):
            m.cell(r, col).value = None

    s = wb[X.SUMMARY]
    tot = next(r for r in range(4, 200) if s.cell(r, 1).value == "TOTALE")
    style = [s.cell(tot, c)._style for c in range(1, 5)]
    for r in range(4, tot + 1):
        for c in range(1, 5):
            s.cell(r, c).value = None
    for c, v in zip(range(1, 5), ("TOTALE", 0, 0, "=B4-C4")):
        s.cell(4, c).value = v
        s.cell(4, c)._style = style[c - 1]
    for r in range(1, 80):  # tabellina personale a destra (borsa di studio)
        for c in range(6, 13):
            s.cell(r, c).value = None

    v = wb[T.SUMMARY]
    for r in range(T.SUM_FIRST, T.SUM_LAST + 1):
        for c in (1, 2, 3, 5):
            v.cell(r, c).value = None
        v.cell(r, 4).value = f"=B{r}-C{r}"

    # proprietà del documento: niente nome dell'autore
    for k in ("title", "subject", "description", "keywords", "category", "identifier"):
        setattr(wb.properties, k, None)
    wb.properties.creator = wb.properties.lastModifiedBy = "BudgetApp"
    wb.active = wb.sheetnames.index(X.SUMMARY)
    wb.calculation.fullCalcOnLoad = True
    dst.parent.mkdir(parents=True, exist_ok=True)
    wb.save(dst)
    print("Creato", dst, "· fogli:", wb.sheetnames)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
