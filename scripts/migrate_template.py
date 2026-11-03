"""Migrazione una tantum del Budget Tracker al modello nuovo.

- crea il foglio nascosto _Modello (Sett 1-5, 15 slot categoria) dal layout di Novembre
- converte Novembre al modello nuovo mantenendo le spese già inserite
- elimina i fogli dei mesi futuri SOLO se non contengono spese
- pulisce il Riassunto Annuale (righe dei mesi futuri) e collega Novembre con formule

Uso:  uv run python scripts/migrate_template.py <file.xlsx> [--dry-run]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import excel as X  # noqa: E402

SOURCE = "Novembre"
FUTURE = ["Dicembre", "Gennaio", "Febbraio", "Marzo", "Aprile", "Aprile (2)", "Maggio", "Giugno"]


def has_expenses(ws) -> bool:
    return bool(X.transactions(ws))


def main(path: Path, dry_run: bool) -> None:
    wb = X.load(path)
    if X.TEMPLATE in wb.sheetnames:
        sys.exit("Il file è già migrato (_Modello esiste).")
    old = wb[SOURCE]
    old_tx = X.transactions(old)
    old_budgets = {str(old.cell(r, 8).value): old.cell(r, 9).value for r in range(10, 19)}
    old_head = {c: old[c].value for c in ("B2", "C2", "D2", "E2", "B3", "B4", "B5")}
    old_subs = [(old.cell(r, 8).value, old.cell(r, 9).value, old.cell(r, 10).value) for r in range(25, 30)]

    tpl = X.build_template(wb, old)

    # Novembre nel modello nuovo, nella stessa posizione
    idx = wb.sheetnames.index(SOURCE)
    new = wb.copy_worksheet(tpl)
    new.sheet_state = "visible"
    wb.remove(old)
    new.title = SOURCE
    wb.move_sheet(new, offset=idx - wb.sheetnames.index(SOURCE))
    new.freeze_panes = "A10"
    new["A1"] = "📊 TRACKER SPESE - NOVEMBRE"
    for c, v in old_head.items():
        new[c] = v
    for r in range(X.CAT_FIRST, X.CAT_LAST + 1):
        name = new.cell(r, 8).value
        if name in old_budgets:
            new.cell(r, 9).value = old_budgets[name]
    for i, (h, a, j) in enumerate(old_subs):
        r = X.SUB_FIRST + i
        new.cell(r, 8).value, new.cell(r, 9).value, new.cell(r, 10).value = h, a, j
    for i, t in enumerate(old_tx):
        r = X.TX_FIRST + i
        src = t["row"]
        new.cell(r, 2).value = X.dt.datetime.fromisoformat(t["date"]) if t["date"] else None
        new.cell(r, 2).number_format = X.DATE_FMT
        new.cell(r, 3).value = t["description"]
        new.cell(r, 4).value = t["amount"]
        new.cell(r, 4).number_format = X.EUR_FMT
        new.cell(r, 5).value = t["category"]
        new.cell(r, 6).value = t["note"]
        assert src >= X.TX_FIRST
    X.apply_rules(new)

    # mesi futuri: elimina solo se vuoti
    removed, kept = [], []
    for name in FUTURE:
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        if has_expenses(ws):
            kept.append(name)
        else:
            wb.remove(ws)
            removed.append(name)

    # Riassunto Annuale: tieni Settembre/Ottobre, collega Novembre, togli i mesi futuri
    s = wb[X.SUMMARY]
    rows = {s.cell(r, 1).value: r for r in range(4, 20) if s.cell(r, 1).value}
    nov = rows["Novembre"]
    s.cell(nov, 2).value = f"='{SOURCE}'!I{X.TOT_ROW}"
    s.cell(nov, 3).value = f"='{SOURCE}'!O{X.TOT_ROW}"
    old_tot = rows["TOTALE"]
    tot = nov + 1
    tot_styles = [X.copy(s.cell(old_tot, c)._style) for c in range(1, 5)]
    blank = X.copy(s.cell(old_tot + 2, 1)._style)
    for r in range(tot, old_tot + 1):
        for c in range(1, 5):
            s.cell(r, c).value = None
            s.cell(r, c)._style = X.copy(blank)
    for c in range(1, 5):
        s.cell(tot, c)._style = tot_styles[c - 1]
    s.cell(tot, 1).value = "TOTALE"
    s.cell(tot, 2).value = f"=SUM(B4:B{nov})"
    s.cell(tot, 3).value = f"=SUM(C4:C{nov})"
    s.cell(tot, 4).value = f"=B{tot}-C{tot}"

    print("Fogli eliminati (vuoti):", removed)
    print("Fogli mantenuti perché contengono spese:", kept)
    print("Fogli finali:", wb.sheetnames)
    print("Novembre: spese copiate", len(old_tx))
    if dry_run:
        print("--dry-run: nessun salvataggio")
        return
    X.save(wb, path, Path(__file__).resolve().parent.parent / "backups")
    print("Salvato:", path)


if __name__ == "__main__":
    main(Path(sys.argv[1]), "--dry-run" in sys.argv)
