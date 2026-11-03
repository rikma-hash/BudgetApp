"""Prepara i viaggi nel file del budget a partire dal file Viaggi.xlsx dell'utente.

- il foglio 'viaggio template' diventa il modello nascosto _ModelloViaggio
- gli altri fogli (viaggi già compilati) vengono importati come fogli '✈ Nome'

Uso:  uv run python scripts/setup_trips.py <budget.xlsx> <Viaggi.xlsx>
"""

import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server import excel as X, trips as T  # noqa: E402


def main(budget: Path, viaggi: Path) -> None:
    wb = X.load(budget)
    src = openpyxl.load_workbook(viaggi)
    template = next(ws for ws in src.worksheets if "template" in ws.title.lower())
    T.build_template(wb, template)
    for ws in src.worksheets:
        if ws is template:
            continue
        if T.sheet_name(ws.title) in wb.sheetnames:
            print("Già presente:", ws.title)
            continue
        T.import_trip(wb, ws)
        print("Importato:", ws.title, "-", len(T.transactions(wb[T.sheet_name(ws.title)])), "spese")
    X.save(wb, budget, Path(__file__).resolve().parent.parent / "backups")
    print("Fogli:", wb.sheetnames)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
