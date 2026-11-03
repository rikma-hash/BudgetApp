"""Crea in anticipo i fogli dei mesi (e le righe del Riassunto) fino al mese indicato.

Uso:  uv run python scripts/add_months.py <file.xlsx> 2027-07
"""

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server import excel as X  # noqa: E402


def main(path: Path, until: dt.date) -> None:
    wb = X.load(path)
    day = dt.date.today().replace(day=1)
    created = []
    while day <= until:
        ws, new = X.ensure_month(wb, day)
        if new:
            created.append(ws.title)
        day = (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    if not created:
        print("Nessun mese da creare.")
        return
    X.save(wb, path, Path(__file__).resolve().parent.parent / "backups")
    print("Creati:", ", ".join(created))
    print("Fogli:", wb.sheetnames)


if __name__ == "__main__":
    y, m = map(int, sys.argv[2].split("-"))
    main(Path(sys.argv[1]), dt.date(y, m, 1))
